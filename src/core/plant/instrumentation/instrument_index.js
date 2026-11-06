'use strict';

/**
 * ISA-5.1 Instrument Index & DCS/SIS I/O Schedule Generator.
 *
 * Implements:
 * 1. ISA-5.1 Instrument Tag identification and functional classification
 * 2. Complete engineering index attributes: Tag, Service, P&ID Ref, Line/Vessel, Signal Type,
 *    Protocol, System (BPCS vs SIS), SIL Rating, Hazardous Area Protection, JB, Marshalling, Rack/Slot/Channel
 * 3. Automated DCS/SIS I/O Schedule generation with strict 20% installed spare capacity rule
 * 4. P&ID model ingestion and comprehensive LNG complex sample generation
 * 5. Export to CSV, JSON, and summary tables
 */

const SIGNAL_TYPES = Object.freeze({
  AI: 'AI', // 4-20mA HART Analog Input
  AO: 'AO', // 4-20mA HART Analog Output
  DI: 'DI', // Discrete/Digital Input (volt-free contact, NAMUR)
  DO: 'DO', // Discrete/Digital Output (24VDC solenoid / trip relay)
  RTD: 'RTD', // Direct Pt100 3/4-wire temperature input
  TC: 'TC', // Thermocouple mV input
  BUS: 'BUS' // Fieldbus / Profibus / Modbus digital link
});

const SYSTEM_DOMAINS = Object.freeze({
  BPCS: 'BPCS', // Basic Process Control System (DCS)
  SIS: 'SIS', // Safety Instrumented System (ESD/SIL)
  FGS: 'FGS', // Fire & Gas System
  MMS: 'MMS' // Machinery Protection System (API 670)
});

const HAZARDOUS_PROTECTION = Object.freeze({
  EX_IA: 'Ex ia', // Intrinsically Safe (Zone 0/1)
  EX_D: 'Ex d', // Flameproof / Explosion-proof (Zone 1)
  EX_E: 'Ex e', // Increased Safety (Zone 1/2)
  EX_EC: 'Ex ec', // Non-sparking (Zone 2)
  GENERAL_PURPOSE: 'GP' // Safe area / Control room
});

const CARD_CAPACITIES = Object.freeze({
  AI: 16, // 16 channels per analog input card
  AO: 8, // 8 channels per analog output card
  DI: 32, // 32 channels per digital input card
  DO: 16, // 16 channels per digital output card
  RTD: 8, // 8 channels per direct RTD card
  TC: 8 // 8 channels per direct TC card
});

/**
 * Parse an ISA-5.1 instrument tag string into components.
 * e.g., "10-FT-1001A" -> area: 10, variable: F, function: T, loopNumber: 1001, suffix: A
 */
function parseIsaTag(tag) {
  if (!tag || typeof tag !== 'string') {
    throw new TypeError(`Invalid instrument tag: ${tag}`);
  }

  const trimmed = tag.trim().toUpperCase();
  const match = /^([0-9A-Z]+-)?([A-Z]+)-([0-9]+)([A-Z])?$/.exec(trimmed);

  if (!match) {
    return {
      rawTag: trimmed,
      area: '00',
      letters: trimmed,
      loopNumber: '0000',
      suffix: ''
    };
  }

  const area = match[1] ? match[1].replace('-', '') : '00';
  const letters = match[2];
  const loopNumber = match[3];
  const suffix = match[4] || '';

  const variable = letters.charAt(0);
  const functionCode = letters.slice(1);

  return {
    rawTag: trimmed,
    area,
    letters,
    variable,
    functionCode,
    loopNumber,
    suffix
  };
}

/**
 * Determine default signal type and system domain from ISA-5.1 letters.
 */
function classifyTagLetters(letters) {
  const code = letters.toUpperCase();

  // Safety valves and shutdown elements -> SIS
  if (code.includes('XV') || code.includes('ESDV') || code.includes('BDV') || code.includes('SDV')) {
    return { signalType: SIGNAL_TYPES.DO, system: SYSTEM_DOMAINS.SIS, protection: HAZARDOUS_PROTECTION.EX_D };
  }
  if (code.includes('PSV') || code.includes('PRV')) {
    // Mechanical relief valve - passive, no I/O unless equipped with acoustic/limit switch
    return { signalType: null, system: SYSTEM_DOMAINS.SIS, protection: HAZARDOUS_PROTECTION.GENERAL_PURPOSE };
  }

  // Switches
  if (code.endsWith('S') || code.endsWith('SH') || code.endsWith('SL') || code.endsWith('SHH') || code.endsWith('SLL')) {
    const isSafety = code.endsWith('HH') || code.endsWith('LL') || code.startsWith('X');
    return {
      signalType: SIGNAL_TYPES.DI,
      system: isSafety ? SYSTEM_DOMAINS.SIS : SYSTEM_DOMAINS.BPCS,
      protection: HAZARDOUS_PROTECTION.EX_IA
    };
  }

  // Valve limit switches
  if (code.startsWith('ZS') || code.startsWith('LSO') || code.startsWith('LSC')) {
    return { signalType: SIGNAL_TYPES.DI, system: SYSTEM_DOMAINS.BPCS, protection: HAZARDOUS_PROTECTION.EX_IA };
  }

  // Control valves
  if (code.endsWith('V') || code.endsWith('CV')) {
    return { signalType: SIGNAL_TYPES.AO, system: SYSTEM_DOMAINS.BPCS, protection: HAZARDOUS_PROTECTION.EX_IA };
  }

  // Transmitters
  if (code.endsWith('T') || code.endsWith('IT') || code.endsWith('DT')) {
    const isSafety = code.startsWith('X') || code.startsWith('SZ');
    return {
      signalType: SIGNAL_TYPES.AI,
      system: isSafety ? SYSTEM_DOMAINS.SIS : SYSTEM_DOMAINS.BPCS,
      protection: HAZARDOUS_PROTECTION.EX_IA
    };
  }

  // Default analog input
  return { signalType: SIGNAL_TYPES.AI, system: SYSTEM_DOMAINS.BPCS, protection: HAZARDOUS_PROTECTION.EX_IA };
}

/**
 * Master Instrument Index class.
 */
class InstrumentIndex {
  constructor(options = {}) {
    this.projectName = options.projectName || 'LNG Liquefaction Complex';
    this.plantName = options.plantName || 'World-Scale LNG Train & Utilities';
    this.revision = options.revision || 'Rev 0';
    this.items = [];
  }

  /**
   * Add a single instrument record.
   */
  addInstrument(spec) {
    if (!spec.tag) {
      throw new Error('Instrument record must include a tag');
    }

    const parsed = parseIsaTag(spec.tag);
    const classification = classifyTagLetters(parsed.letters);

    const item = {
      tag: spec.tag.trim().toUpperCase(),
      loopTag: spec.loopTag || `${parsed.area}-${parsed.variable}L-${parsed.loopNumber}`,
      area: spec.area || parsed.area,
      serviceDescription: spec.serviceDescription || 'Process Instrumentation',
      pandidNumber: spec.pandidNumber || `PID-${parsed.area}-01`,
      lineOrEquipment: spec.lineOrEquipment || `${parsed.area}-PL-01`,
      signalType: spec.signalType || classification.signalType,
      protocol: spec.protocol || (classification.signalType === SIGNAL_TYPES.AI || classification.signalType === SIGNAL_TYPES.AO ? '4-20mA HART' : '24VDC Dry Contact'),
      system: spec.system || classification.system,
      silRating: spec.silRating || (spec.system === SYSTEM_DOMAINS.SIS ? 'SIL 2' : 'None'),
      failAction: spec.failAction || (spec.tag.includes('V') ? 'FC' : 'NA'),
      hazardousProtection: spec.hazardousProtection || classification.protection,
      junctionBox: spec.junctionBox || `${parsed.area}-JB-${classification.system === SYSTEM_DOMAINS.SIS ? 'SIS-' : ''}01`,
      marshallingCabinet: spec.marshallingCabinet || `MARSH-${parsed.area}-${classification.system}`,
      calibrationRange: spec.calibrationRange || '0 - 100 %',
      engineeringUnits: spec.engineeringUnits || '%',
      powerSupply: spec.powerSupply || '24VDC Loop Powered',
      // Will be allocated during schedule generation
      rackSlotChannel: spec.rackSlotChannel || null
    };

    this.items.push(item);
    return item;
  }

  /**
   * Auto-allocate I/O channels to cards, racks, and cabinets with 20% installed spare rule.
   */
  allocateIoChannels() {
    // Separate by System (BPCS vs SIS) and Signal Type
    const groups = {};

    for (const item of this.items) {
      if (!item.signalType) continue; // Skip unpowered mechanical items like manual valves
      const key = `${item.system}_${item.signalType}`;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(item);
    }

    const schedule = {};

    for (const [key, itemList] of Object.entries(groups)) {
      const [sys, sig] = key.split('_');
      const capacity = CARD_CAPACITIES[sig] || 16;
      const countUsed = itemList.length;

      // 20% installed spare capacity rule per industrial engineering specification
      const requiredWithSpares = Math.ceil(countUsed * 1.20);
      const totalCards = Math.ceil(requiredWithSpares / capacity);
      const totalInstalledChannels = totalCards * capacity;
      const actualSpares = totalInstalledChannels - countUsed;
      const sparePercentage = countUsed > 0 ? (actualSpares / countUsed) * 100.0 : 0;

      schedule[key] = {
        system: sys,
        signalType: sig,
        usedChannels: countUsed,
        requiredWith20PercentSpare: requiredWithSpares,
        cardCapacity: capacity,
        cardsInstalled: totalCards,
        totalInstalledChannels,
        installedSpareChannels: actualSpares,
        sparePercentageAchieved: sparePercentage
      };

      // Assign Rack, Slot, Channel to each used instrument
      itemList.forEach((item, index) => {
        const cardIndex = Math.floor(index / capacity) + 1;
        const channelIndex = (index % capacity) + 1;
        const rackIndex = Math.floor((cardIndex - 1) / 8) + 1;
        const slotInRack = ((cardIndex - 1) % 8) + 1;

        item.rackSlotChannel = `RACK-${rackIndex.toString().padStart(2, '0')}/SLOT-${slotInRack.toString().padStart(2, '0')}/CH-${channelIndex.toString().padStart(2, '0')}`;
      });
    }

    this.ioSchedule = schedule;
    return schedule;
  }

  /**
   * Return complete summary table of I/O breakdown across DCS and SIS.
   */
  getIoSummary() {
    if (!this.ioSchedule) {
      this.allocateIoChannels();
    }

    let totalUsed = 0;
    let totalInstalled = 0;
    let totalSpares = 0;

    const breakdown = Object.values(this.ioSchedule).map((s) => {
      totalUsed += s.usedChannels;
      totalInstalled += s.totalInstalledChannels;
      totalSpares += s.installedSpareChannels;
      return {
        system: s.system,
        signalType: s.signalType,
        activeSignals: s.usedChannels,
        cardsNeeded: s.cardsInstalled,
        installedChannels: s.totalInstalledChannels,
        spareChannels: s.installedSpareChannels,
        sparePercent: s.sparePercentageAchieved.toFixed(1) + '%'
      };
    });

    return {
      projectName: this.projectName,
      plantName: this.plantName,
      totalActiveInstruments: this.items.length,
      totalActiveIoChannels: totalUsed,
      totalInstalledChannels: totalInstalled,
      totalSpareChannels: totalSpares,
      overallSparePercentage: totalUsed > 0 ? ((totalSpares / totalUsed) * 100.0).toFixed(1) + '%' : '0%',
      breakdown
    };
  }

  /**
   * Generate standard CSV file format for engineering deliverables.
   */
  toCsv() {
    if (!this.ioSchedule) {
      this.allocateIoChannels();
    }

    const headers = [
      'Tag',
      'Loop Tag',
      'Area',
      'Service Description',
      'P&ID Number',
      'Line/Equipment',
      'Signal Type',
      'Protocol',
      'System',
      'SIL Rating',
      'Fail Action',
      'Hazardous Protection',
      'Junction Box',
      'Marshalling Cabinet',
      'I/O Allocation (Rack/Slot/Ch)',
      'Calibrated Range',
      'Units',
      'Power Supply'
    ];

    const rows = this.items.map((item) => [
      `"${item.tag}"`,
      `"${item.loopTag}"`,
      `"${item.area}"`,
      `"${item.serviceDescription}"`,
      `"${item.pandidNumber}"`,
      `"${item.lineOrEquipment}"`,
      `"${item.signalType || 'NA'}"`,
      `"${item.protocol}"`,
      `"${item.system}"`,
      `"${item.silRating}"`,
      `"${item.failAction}"`,
      `"${item.hazardousProtection}"`,
      `"${item.junctionBox}"`,
      `"${item.marshallingCabinet}"`,
      `"${item.rackSlotChannel || 'UNALLOCATED'}"`,
      `"${item.calibrationRange}"`,
      `"${item.engineeringUnits}"`,
      `"${item.powerSupply}"`
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  /**
   * Export complete structured JSON.
   */
  toJson() {
    if (!this.ioSchedule) {
      this.allocateIoChannels();
    }
    return {
      projectName: this.projectName,
      plantName: this.plantName,
      revision: this.revision,
      instrumentCount: this.items.length,
      ioSummary: this.getIoSummary(),
      instruments: this.items
    };
  }

  /**
   * Auto-generate instruments from a P&ID specification.
   * Synthesizes ISA-5.1 tags for equipment, lines, and safety loops.
   *
   * @param {Object} pidSpec
   * @param {string} pidSpec.pandidNumber - e.g. 'PID-10-001'
   * @param {string} [pidSpec.area='10']
   * @param {string} [pidSpec.unitName]
   * @param {Array<Object>} [pidSpec.equipment]
   * @param {Array<Object>} [pidSpec.lines]
   * @param {Array<Object>} [pidSpec.instruments]
   * @returns {InstrumentIndex} this
   */
  generateFromPid(pidSpec) {
    if (!pidSpec) throw new TypeError('P&ID specification is required');
    const area = pidSpec.area || '10';
    const pandidNumber = pidSpec.pandidNumber || `PID-${area}-01`;

    if (Array.isArray(pidSpec.equipment)) {
      pidSpec.equipment.forEach((eq, eqIdx) => {
        const eqTag = eq.tag || `${area}-EQ-${100 + eqIdx}`;
        const eqNum = eqTag.replace(/[^0-9]/g, '').slice(-3) || `${100 + eqIdx}`;
        const type = (eq.type || '').toLowerCase();

        if (type.includes('separator') || type.includes('vessel') || type.includes('drum')) {
          this.addInstrument({
            tag: `${area}-LIT-${eqNum}1`,
            serviceDescription: `${eq.name || eqTag} Level Guided Wave Radar`,
            pandidNumber,
            lineOrEquipment: eqTag,
            signalType: SIGNAL_TYPES.AI,
            system: SYSTEM_DOMAINS.BPCS,
            calibrationRange: '0 - 3000 mm',
            engineeringUnits: 'mm'
          });
          this.addInstrument({
            tag: `${area}-LSHH-${eqNum}1`,
            serviceDescription: `${eq.name || eqTag} High-High Level Safety Trip`,
            pandidNumber,
            lineOrEquipment: eqTag,
            signalType: SIGNAL_TYPES.DI,
            system: SYSTEM_DOMAINS.SIS,
            silRating: 'SIL 3'
          });
          this.addInstrument({
            tag: `${area}-LV-${eqNum}1`,
            serviceDescription: `${eq.name || eqTag} Level Control Valve`,
            pandidNumber,
            lineOrEquipment: eqTag,
            signalType: SIGNAL_TYPES.AO,
            system: SYSTEM_DOMAINS.BPCS,
            failAction: 'FC'
          });
          this.addInstrument({
            tag: `${area}-PT-${eqNum}2`,
            serviceDescription: `${eq.name || eqTag} Operating Pressure`,
            pandidNumber,
            lineOrEquipment: eqTag,
            signalType: SIGNAL_TYPES.AI,
            system: SYSTEM_DOMAINS.BPCS,
            calibrationRange: '0 - 50 barg',
            engineeringUnits: 'barg'
          });
          this.addInstrument({
            tag: `${area}-BDV-${eqNum}5`,
            serviceDescription: `${eq.name || eqTag} Depressuring Blowdown Valve SOV`,
            pandidNumber,
            lineOrEquipment: eqTag,
            signalType: SIGNAL_TYPES.DO,
            system: SYSTEM_DOMAINS.SIS,
            silRating: 'SIL 3',
            failAction: 'FO',
            hazardousProtection: HAZARDOUS_PROTECTION.EX_D
          });
        } else if (type.includes('pump')) {
          this.addInstrument({
            tag: `${area}-PT-${eqNum}1`,
            serviceDescription: `${eq.name || eqTag} Suction Pressure`,
            pandidNumber,
            lineOrEquipment: eqTag,
            signalType: SIGNAL_TYPES.AI,
            system: SYSTEM_DOMAINS.BPCS,
            calibrationRange: '0 - 10 barg',
            engineeringUnits: 'barg'
          });
          this.addInstrument({
            tag: `${area}-PT-${eqNum}2`,
            serviceDescription: `${eq.name || eqTag} Discharge Pressure`,
            pandidNumber,
            lineOrEquipment: eqTag,
            signalType: SIGNAL_TYPES.AI,
            system: SYSTEM_DOMAINS.BPCS,
            calibrationRange: '0 - 80 barg',
            engineeringUnits: 'barg'
          });
          this.addInstrument({
            tag: `${area}-FT-${eqNum}3`,
            serviceDescription: `${eq.name || eqTag} Discharge Flowmeter`,
            pandidNumber,
            lineOrEquipment: eqTag,
            signalType: SIGNAL_TYPES.AI,
            system: SYSTEM_DOMAINS.BPCS,
            calibrationRange: '0 - 500 m3/h',
            engineeringUnits: 'm3/h'
          });
          this.addInstrument({
            tag: `${area}-FV-${eqNum}3`,
            serviceDescription: `${eq.name || eqTag} Minimum Flow Spillback Valve`,
            pandidNumber,
            lineOrEquipment: eqTag,
            signalType: SIGNAL_TYPES.AO,
            system: SYSTEM_DOMAINS.BPCS,
            failAction: 'FO'
          });
          this.addInstrument({
            tag: `${area}-ZI-${eqNum}9`,
            serviceDescription: `${eq.name || eqTag} Motor Running Feedback`,
            pandidNumber,
            lineOrEquipment: eqTag,
            signalType: SIGNAL_TYPES.DI,
            system: SYSTEM_DOMAINS.BPCS
          });
        } else if (type.includes('compressor')) {
          this.addInstrument({
            tag: `${area}-PT-${eqNum}1`,
            serviceDescription: `${eq.name || eqTag} Suction Header Pressure`,
            pandidNumber,
            lineOrEquipment: eqTag,
            signalType: SIGNAL_TYPES.AI,
            system: SYSTEM_DOMAINS.BPCS,
            calibrationRange: '0 - 30 barg',
            engineeringUnits: 'barg'
          });
          this.addInstrument({
            tag: `${area}-PT-${eqNum}2`,
            serviceDescription: `${eq.name || eqTag} Discharge Header Pressure`,
            pandidNumber,
            lineOrEquipment: eqTag,
            signalType: SIGNAL_TYPES.AI,
            system: SYSTEM_DOMAINS.BPCS,
            calibrationRange: '0 - 90 barg',
            engineeringUnits: 'barg'
          });
          this.addInstrument({
            tag: `${area}-FT-${eqNum}1`,
            serviceDescription: `${eq.name || eqTag} Suction Orifice Flowmeter`,
            pandidNumber,
            lineOrEquipment: eqTag,
            signalType: SIGNAL_TYPES.AI,
            system: SYSTEM_DOMAINS.BPCS,
            calibrationRange: '0 - 800000 kg/h',
            engineeringUnits: 'kg/h'
          });
          this.addInstrument({
            tag: `${area}-FV-${eqNum}1`,
            serviceDescription: `${eq.name || eqTag} Fast-Opening Anti-Surge Recycle Valve`,
            pandidNumber,
            lineOrEquipment: eqTag,
            signalType: SIGNAL_TYPES.AO,
            system: SYSTEM_DOMAINS.BPCS,
            failAction: 'FO'
          });
          this.addInstrument({
            tag: `${area}-XY-${eqNum}9`,
            serviceDescription: `${eq.name || eqTag} Emergency Trip Solenoid`,
            pandidNumber,
            lineOrEquipment: eqTag,
            signalType: SIGNAL_TYPES.DO,
            system: SYSTEM_DOMAINS.SIS,
            silRating: 'SIL 3'
          });
        } else if (type.includes('column') || type.includes('tower')) {
          this.addInstrument({
            tag: `${area}-PT-${eqNum}1`,
            serviceDescription: `${eq.name || eqTag} Overhead Vapor Pressure`,
            pandidNumber,
            lineOrEquipment: eqTag,
            signalType: SIGNAL_TYPES.AI,
            system: SYSTEM_DOMAINS.BPCS,
            calibrationRange: '0 - 40 barg',
            engineeringUnits: 'barg'
          });
          this.addInstrument({
            tag: `${area}-PV-${eqNum}1`,
            serviceDescription: `${eq.name || eqTag} Overhead Pressure Control Valve`,
            pandidNumber,
            lineOrEquipment: eqTag,
            signalType: SIGNAL_TYPES.AO,
            system: SYSTEM_DOMAINS.BPCS,
            failAction: 'FO'
          });
          this.addInstrument({
            tag: `${area}-TT-${eqNum}5`,
            serviceDescription: `${eq.name || eqTag} Stripping Tray Temperature (Pt100)`,
            pandidNumber,
            lineOrEquipment: eqTag,
            signalType: SIGNAL_TYPES.AI,
            system: SYSTEM_DOMAINS.BPCS,
            calibrationRange: '0 - 250 degC',
            engineeringUnits: 'degC'
          });
          this.addInstrument({
            tag: `${area}-LIT-${eqNum}8`,
            serviceDescription: `${eq.name || eqTag} Bottom Sump Level DP Transmitter`,
            pandidNumber,
            lineOrEquipment: eqTag,
            signalType: SIGNAL_TYPES.AI,
            system: SYSTEM_DOMAINS.BPCS,
            calibrationRange: '0 - 2500 mmH2O',
            engineeringUnits: 'mmH2O'
          });
          this.addInstrument({
            tag: `${area}-LV-${eqNum}8`,
            serviceDescription: `${eq.name || eqTag} Bottoms Level Control Valve`,
            pandidNumber,
            lineOrEquipment: eqTag,
            signalType: SIGNAL_TYPES.AO,
            system: SYSTEM_DOMAINS.BPCS,
            failAction: 'FC'
          });
        } else if (type.includes('exchanger') || type.includes('cooler')) {
          this.addInstrument({
            tag: `${area}-TT-${eqNum}1`,
            serviceDescription: `${eq.name || eqTag} Process Outlet Temperature`,
            pandidNumber,
            lineOrEquipment: eqTag,
            signalType: SIGNAL_TYPES.AI,
            system: SYSTEM_DOMAINS.BPCS,
            calibrationRange: '-50 - 200 degC',
            engineeringUnits: 'degC'
          });
          this.addInstrument({
            tag: `${area}-TV-${eqNum}1`,
            serviceDescription: `${eq.name || eqTag} Coolant / Utility Valve`,
            pandidNumber,
            lineOrEquipment: eqTag,
            signalType: SIGNAL_TYPES.AO,
            system: SYSTEM_DOMAINS.BPCS,
            failAction: 'FC'
          });
        }
      });
    }

    if (Array.isArray(pidSpec.lines)) {
      pidSpec.lines.forEach((line, lineIdx) => {
        const lineTag = line.lineTag || `${area}-PL-${100 + lineIdx}`;
        const num = lineTag.replace(/[^0-9]/g, '').slice(-3) || `${100 + lineIdx}`;
        if (line.isSafety || line.hasEsdv) {
          this.addInstrument({
            tag: `${area}-ESDV-${num}1`,
            serviceDescription: `${line.service || lineTag} Emergency Shutdown Valve SOV`,
            pandidNumber,
            lineOrEquipment: lineTag,
            signalType: SIGNAL_TYPES.DO,
            system: SYSTEM_DOMAINS.SIS,
            silRating: 'SIL 3',
            failAction: 'FC',
            hazardousProtection: HAZARDOUS_PROTECTION.EX_D
          });
          this.addInstrument({
            tag: `${area}-ZSO-${num}1`,
            serviceDescription: `ESDV-${num}1 Full Open Limit Switch`,
            pandidNumber,
            lineOrEquipment: lineTag,
            signalType: SIGNAL_TYPES.DI,
            system: SYSTEM_DOMAINS.BPCS
          });
          this.addInstrument({
            tag: `${area}-ZSC-${num}1`,
            serviceDescription: `ESDV-${num}1 Full Closed Limit Switch`,
            pandidNumber,
            lineOrEquipment: lineTag,
            signalType: SIGNAL_TYPES.DI,
            system: SYSTEM_DOMAINS.BPCS
          });
        }
      });
    }

    if (Array.isArray(pidSpec.instruments)) {
      pidSpec.instruments.forEach((inst) => this.addInstrument(inst));
    }

    this.allocateIoChannels();
    return this;
  }

  /**
   * Auto-generate instrument index from a plant unit specification.
   *
   * @param {Object} unitSpec
   * @returns {InstrumentIndex} this
   */
  generateFromPlantUnit(unitSpec) {
    if (!unitSpec) throw new TypeError('Plant unit specification is required');
    if (unitSpec.projectName) this.projectName = unitSpec.projectName;
    if (unitSpec.plantName) this.plantName = unitSpec.plantName;

    if (Array.isArray(unitSpec.pids)) {
      unitSpec.pids.forEach((p) => this.generateFromPid(p));
    } else {
      this.generateFromPid(unitSpec);
    }
    return this;
  }
}

/**
 * Factory that populates a complete FEED-level instrument index for a world-scale LNG complex.
 * Covers:
 * - Unit 10: Feed Gas Metering & Acid Gas Removal (Amine)
 * - Unit 20: Molecular Sieve Dehydration & Mercury Removal
 * - Unit 30: NGL Fractionation (Demethanizer, Deethanizer)
 * - Unit 40: Main Cryogenic Heat Exchanger (MCHE) & Refrigerant Loops
 * - Unit 50: LNG Storage, Boil-Off Gas (BOG) Compression & Flare
 * - Unit 60: Marine Loading Arms & Transfer
 */
function createWorldScaleLngInstrumentIndex() {
  const index = new InstrumentIndex({
    projectName: 'World-Scale LNG Engineering Complex',
    plantName: '5.0 MTPA Baseload LNG Liquefaction Train & Acid Gas Unit'
  });

  const instruments = [
    // UNIT 10: FEED GAS & AMINE TREATING
    { tag: '10-FT-1001A', area: '10', serviceDescription: 'Feed Gas Custody Transfer Ultrasonic Flow Path A', pandidNumber: 'PID-10-001', lineOrEquipment: '10-PG-1001-A1A', signalType: SIGNAL_TYPES.AI, system: SYSTEM_DOMAINS.BPCS, calibrationRange: '0 - 1500000 Nm3/h', engineeringUnits: 'Nm3/h' },
    { tag: '10-FT-1001B', area: '10', serviceDescription: 'Feed Gas Custody Transfer Ultrasonic Flow Path B', pandidNumber: 'PID-10-001', lineOrEquipment: '10-PG-1001-A1A', signalType: SIGNAL_TYPES.AI, system: SYSTEM_DOMAINS.BPCS, calibrationRange: '0 - 1500000 Nm3/h', engineeringUnits: 'Nm3/h' },
    { tag: '10-PT-1001', area: '10', serviceDescription: 'Feed Gas Pipeline Header Pressure', pandidNumber: 'PID-10-001', lineOrEquipment: '10-PG-1001-A1A', signalType: SIGNAL_TYPES.AI, system: SYSTEM_DOMAINS.BPCS, calibrationRange: '0 - 100 barg', engineeringUnits: 'barg' },
    { tag: '10-PT-1002A', area: '10', serviceDescription: 'Feed Gas ESD High Pressure Trip Sensor A (2oo3)', pandidNumber: 'PID-10-001', lineOrEquipment: '10-PG-1001-A1A', signalType: SIGNAL_TYPES.AI, system: SYSTEM_DOMAINS.SIS, silRating: 'SIL 3', calibrationRange: '0 - 100 barg', engineeringUnits: 'barg' },
    { tag: '10-PT-1002B', area: '10', serviceDescription: 'Feed Gas ESD High Pressure Trip Sensor B (2oo3)', pandidNumber: 'PID-10-001', lineOrEquipment: '10-PG-1001-A1A', signalType: SIGNAL_TYPES.AI, system: SYSTEM_DOMAINS.SIS, silRating: 'SIL 3', calibrationRange: '0 - 100 barg', engineeringUnits: 'barg' },
    { tag: '10-PT-1002C', area: '10', serviceDescription: 'Feed Gas ESD High Pressure Trip Sensor C (2oo3)', pandidNumber: 'PID-10-001', lineOrEquipment: '10-PG-1001-A1A', signalType: SIGNAL_TYPES.AI, system: SYSTEM_DOMAINS.SIS, silRating: 'SIL 3', calibrationRange: '0 - 100 barg', engineeringUnits: 'barg' },
    { tag: '10-ESDV-1001', area: '10', serviceDescription: 'Feed Gas Emergency Shutdown Isolation Valve SOV', pandidNumber: 'PID-10-001', lineOrEquipment: '10-PG-1001-A1A', signalType: SIGNAL_TYPES.DO, system: SYSTEM_DOMAINS.SIS, silRating: 'SIL 3', failAction: 'FC' },
    { tag: '10-ZSO-1001', area: '10', serviceDescription: 'Feed Gas ESDV-1001 Full Open Limit Switch', pandidNumber: 'PID-10-001', lineOrEquipment: '10-PG-1001-A1A', signalType: SIGNAL_TYPES.DI, system: SYSTEM_DOMAINS.BPCS },
    { tag: '10-ZSC-1001', area: '10', serviceDescription: 'Feed Gas ESDV-1001 Full Closed Limit Switch', pandidNumber: 'PID-10-001', lineOrEquipment: '10-PG-1001-A1A', signalType: SIGNAL_TYPES.DI, system: SYSTEM_DOMAINS.BPCS },
    { tag: '10-LIT-1101', area: '10', serviceDescription: 'Feed Slug Catcher Level Guided Wave Radar', pandidNumber: 'PID-10-002', lineOrEquipment: '10-V-101', signalType: SIGNAL_TYPES.AI, system: SYSTEM_DOMAINS.BPCS, calibrationRange: '0 - 3500 mm', engineeringUnits: 'mm' },
    { tag: '10-LV-1101', area: '10', serviceDescription: 'Slug Catcher Hydrocarbon Condensate Level Valve', pandidNumber: 'PID-10-002', lineOrEquipment: '10-CL-1101-A1A', signalType: SIGNAL_TYPES.AO, system: SYSTEM_DOMAINS.BPCS, failAction: 'FC' },
    { tag: '10-FT-1201', area: '10', serviceDescription: 'Lean aMDEA Amine Solution to Absorber Flow', pandidNumber: 'PID-10-003', lineOrEquipment: '10-AL-1201-B1A', signalType: SIGNAL_TYPES.AI, system: SYSTEM_DOMAINS.BPCS, calibrationRange: '0 - 850 m3/h', engineeringUnits: 'm3/h' },
    { tag: '10-FV-1201', area: '10', serviceDescription: 'Lean Amine Flow Control Valve', pandidNumber: 'PID-10-003', lineOrEquipment: '10-AL-1201-B1A', signalType: SIGNAL_TYPES.AO, system: SYSTEM_DOMAINS.BPCS, failAction: 'FC' },
    { tag: '10-PDT-1205', area: '10', serviceDescription: 'Acid Gas Absorber Packing Differential Pressure', pandidNumber: 'PID-10-003', lineOrEquipment: '10-C-101', signalType: SIGNAL_TYPES.AI, system: SYSTEM_DOMAINS.BPCS, calibrationRange: '0 - 250 mbar', engineeringUnits: 'mbar' },
    { tag: '10-TT-1210', area: '10', serviceDescription: 'Acid Gas Stripper Reboiler Vapor Outlet Temp (Pt100)', pandidNumber: 'PID-10-004', lineOrEquipment: '10-E-105', signalType: SIGNAL_TYPES.AI, system: SYSTEM_DOMAINS.BPCS, calibrationRange: '0 - 200 degC', engineeringUnits: 'degC' },
    { tag: '10-TV-1210', area: '10', serviceDescription: 'Stripper Reboiler LP Steam Control Valve', pandidNumber: 'PID-10-004', lineOrEquipment: '10-SL-1210-C1A', signalType: SIGNAL_TYPES.AO, system: SYSTEM_DOMAINS.BPCS, failAction: 'FC' },

    // UNIT 20: DEHYDRATION & MERCURY REMOVAL
    { tag: '20-PDT-2001', area: '20', serviceDescription: 'Mol Sieve Bed A Differential Pressure', pandidNumber: 'PID-20-001', lineOrEquipment: '20-V-201A', signalType: SIGNAL_TYPES.AI, system: SYSTEM_DOMAINS.BPCS, calibrationRange: '0 - 50 kPa', engineeringUnits: 'kPa' },
    { tag: '20-AT-2005', area: '20', serviceDescription: 'Dry Gas Moisture Analyzer (H2O Dewpoint)', pandidNumber: 'PID-20-002', lineOrEquipment: '20-DG-2005-A1A', signalType: SIGNAL_TYPES.AI, system: SYSTEM_DOMAINS.BPCS, calibrationRange: '0 - 10 ppmv', engineeringUnits: 'ppmv' },
    { tag: '20-XV-2010', area: '20', serviceDescription: 'Mol Sieve Regeneration Gas Switching Valve A', pandidNumber: 'PID-20-002', lineOrEquipment: '20-RG-2010-A1A', signalType: SIGNAL_TYPES.DO, system: SYSTEM_DOMAINS.BPCS },

    // UNIT 30: NGL RECOVERY & FRACTIONATION
    { tag: '30-PT-3001', area: '30', serviceDescription: 'Demethanizer Column Overhead Pressure', pandidNumber: 'PID-30-001', lineOrEquipment: '30-C-301', signalType: SIGNAL_TYPES.AI, system: SYSTEM_DOMAINS.BPCS, calibrationRange: '0 - 40 barg', engineeringUnits: 'barg' },
    { tag: '30-PV-3001', area: '30', serviceDescription: 'Demethanizer Overhead Gas Pressure Control Valve', pandidNumber: 'PID-30-001', lineOrEquipment: '30-OV-3001-A1A', signalType: SIGNAL_TYPES.AO, system: SYSTEM_DOMAINS.BPCS, failAction: 'FO' },
    { tag: '30-LIT-3005', area: '30', serviceDescription: 'Demethanizer Bottom Level DP Wet-Leg Transmitter', pandidNumber: 'PID-30-001', lineOrEquipment: '30-C-301', signalType: SIGNAL_TYPES.AI, system: SYSTEM_DOMAINS.BPCS, calibrationRange: '0 - 2500 mmH2O', engineeringUnits: 'mmH2O' },
    { tag: '30-LV-3005', area: '30', serviceDescription: 'Demethanizer Bottoms to Deethanizer Level Valve', pandidNumber: 'PID-30-001', lineOrEquipment: '30-BL-3005-A1A', signalType: SIGNAL_TYPES.AO, system: SYSTEM_DOMAINS.BPCS, failAction: 'FC' },

    // UNIT 40: MCHE LIQUEFACTION & REFRIGERATION
    { tag: '40-FT-4001', area: '40', serviceDescription: 'LNG Product Coriolis Mass Flowmeter', pandidNumber: 'PID-40-001', lineOrEquipment: '40-LNG-4001-SS316', signalType: SIGNAL_TYPES.AI, system: SYSTEM_DOMAINS.BPCS, calibrationRange: '0 - 750000 kg/h', engineeringUnits: 'kg/h' },
    { tag: '40-TT-4001', area: '40', serviceDescription: 'LNG Subcooler Run-Down Temp (RTD Pt100 Class A)', pandidNumber: 'PID-40-001', lineOrEquipment: '40-LNG-4001-SS316', signalType: SIGNAL_TYPES.AI, system: SYSTEM_DOMAINS.BPCS, calibrationRange: '-200 - 50 degC', engineeringUnits: 'degC' },
    { tag: '40-FV-4001', area: '40', serviceDescription: 'LNG Train Rundown Control Valve', pandidNumber: 'PID-40-001', lineOrEquipment: '40-LNG-4001-SS316', signalType: SIGNAL_TYPES.AO, system: SYSTEM_DOMAINS.BPCS, failAction: 'FC' },
    { tag: '40-FT-4101', area: '40', serviceDescription: 'Mixed Refrigerant (MR) LP Suction Orifice Flowmeter', pandidNumber: 'PID-40-002', lineOrEquipment: '40-MR-4101-B1A', signalType: SIGNAL_TYPES.AI, system: SYSTEM_DOMAINS.BPCS, calibrationRange: '0 - 1200000 kg/h', engineeringUnits: 'kg/h' },
    { tag: '40-FV-4101', area: '40', serviceDescription: 'MR Compressor Fast-Opening Anti-Surge Recycle Valve', pandidNumber: 'PID-40-002', lineOrEquipment: '40-MR-4105-B1A', signalType: SIGNAL_TYPES.AO, system: SYSTEM_DOMAINS.BPCS, failAction: 'FO' },
    { tag: '40-BDV-4001', area: '40', serviceDescription: 'MCHE Cryogenic Depressuring Blowdown Valve SOV', pandidNumber: 'PID-40-003', lineOrEquipment: '40-FL-4001-SS316', signalType: SIGNAL_TYPES.DO, system: SYSTEM_DOMAINS.SIS, silRating: 'SIL 3', failAction: 'FO' },

    // UNIT 50: LNG STORAGE & BOG COMPRESSION
    { tag: '50-LIT-5001A', area: '50', serviceDescription: 'Full Containment LNG Tank A Servo/Radar Level A', pandidNumber: 'PID-50-001', lineOrEquipment: '50-TK-01A', signalType: SIGNAL_TYPES.AI, system: SYSTEM_DOMAINS.BPCS, calibrationRange: '0 - 38000 mm', engineeringUnits: 'mm' },
    { tag: '50-LSHH-5001A', area: '50', serviceDescription: 'LNG Tank A Overfill Protection Level Switch HH (2oo3)', pandidNumber: 'PID-50-001', lineOrEquipment: '50-TK-01A', signalType: SIGNAL_TYPES.DI, system: SYSTEM_DOMAINS.SIS, silRating: 'SIL 3' },
    { tag: '50-PT-5002', area: '50', serviceDescription: 'LNG Tank A Vapor Space Pressure (High Sensitivity)', pandidNumber: 'PID-50-001', lineOrEquipment: '50-TK-01A', signalType: SIGNAL_TYPES.AI, system: SYSTEM_DOMAINS.BPCS, calibrationRange: '0 - 250 mbarg', engineeringUnits: 'mbarg' },
    { tag: '50-PV-5002', area: '50', serviceDescription: 'LNG Tank Vapor to BOG Compressor Suction Valve', pandidNumber: 'PID-50-001', lineOrEquipment: '50-VG-5002-A1A', signalType: SIGNAL_TYPES.AO, system: SYSTEM_DOMAINS.BPCS, failAction: 'FC' },

    // UNIT 60: MARINE LOADING ARMS
    { tag: '60-FT-6001', area: '60', serviceDescription: 'Jetty Marine Loading Berth Coriolis Custody Transfer', pandidNumber: 'PID-60-001', lineOrEquipment: '60-MLA-01', signalType: SIGNAL_TYPES.AI, system: SYSTEM_DOMAINS.BPCS, calibrationRange: '0 - 2500000 kg/h', engineeringUnits: 'kg/h' },
    { tag: '60-ESDV-6001', area: '60', serviceDescription: 'Jetty Berth Emergency Release Coupling (PERC) SOV', pandidNumber: 'PID-60-001', lineOrEquipment: '60-MLA-01', signalType: SIGNAL_TYPES.DO, system: SYSTEM_DOMAINS.SIS, silRating: 'SIL 3', failAction: 'FC' }
  ];

  for (const inst of instruments) {
    index.addInstrument(inst);
  }

  index.allocateIoChannels();
  return index;
}

/**
 * Factory creating an instrument index from a P&ID specification.
 */
function generateInstrumentIndexFromPid(pidSpec) {
  const index = new InstrumentIndex({
    projectName: pidSpec.projectName || 'LNG Plant Facility',
    plantName: pidSpec.unitName || 'Plant Unit'
  });
  return index.generateFromPid(pidSpec);
}

/**
 * Factory creating an instrument index from a plant unit specification.
 */
function generateInstrumentIndexFromPlantUnit(unitSpec) {
  const index = new InstrumentIndex({
    projectName: unitSpec.projectName || 'LNG Complex',
    plantName: unitSpec.unitName || 'Process Train'
  });
  return index.generateFromPlantUnit(unitSpec);
}

module.exports = {
  SIGNAL_TYPES,
  SYSTEM_DOMAINS,
  HAZARDOUS_PROTECTION,
  CARD_CAPACITIES,
  parseIsaTag,
  classifyTagLetters,
  InstrumentIndex,
  createWorldScaleLngInstrumentIndex,
  generateInstrumentIndexFromPid,
  generateInstrumentIndexFromPlantUnit
};
