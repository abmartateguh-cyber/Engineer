'use strict';

/**
 * API / TEMA / ISA Equipment Datasheet Generator (Multi-Discipline FEED Deliverable).
 *
 * Generates engineering datasheets across 6 disciplines:
 * 1. API 610 Centrifugal Pumps & Cryogenic VS6 Submerged LNG Pumps
 * 2. API 617 Centrifugal Compressors (C3 Chilling, MR Liquefaction, BOG)
 * 3. TEMA Shell & Tube Heat Exchangers & Brazed Aluminum Plate-Fin MCHE
 * 4. ASME Section VIII Div 1/2 Pressure Vessels, Columns & Cryogenic Tanks
 * 5. API 526 Pressure Safety Relief Valves (with API 520 sizing & dual flare routing)
 * 6. ISA-75.25 Control Valves (with ISA-75.01 Cv calculation & IEC 60534 noise)
 */

class EquipmentDatasheetGenerator {
  constructor() {}

  /**
   * Generates complete set of standardized FEED equipment datasheets for the LNG complex.
   * @returns {Array<object>} List of structured datasheets.
   */
  generateAllDatasheets() {
    return [
      this.generatePumpDatasheet({
        tag: 'P-1001A/B',
        service: 'Inlet Condensate Booster Pumps (1 Duty + 1 Standby)',
        unitId: 'U-10',
        unitName: 'Feed Gas Reception & Slug Catcher',
        pumpType: 'API 610 Type OH2 (Foot-mounted End-suction Overhung)',
        liquid: 'Hydrocarbon Condensate (C5+)',
        ratedCapacityM3H: 18.5,
        normalCapacityM3H: 15.0,
        differentialHeadM: 145.0,
        suctionPressureBarg: 25.0,
        dischargePressureBarg: 35.5,
        pumpingTempC: 32.0,
        specificGravity: 0.68,
        viscosityCp: 0.45,
        vaporPressureBara: 24.5,
        npshaM: 4.8,
        npshrM: 2.2,
        speedRpm: 2950,
        efficiencyPercent: 68.5,
        absorbedPowerKW: 10.2,
        driverPowerKW: 15.0,
        driverVoltage: '400 V / 3-Ph / 50 Hz',
        casingMaterial: 'ASTM A216 Gr WCB Carbon Steel',
        impellerMaterial: 'ASTM A743 Gr CA15 (12% Cr)',
        shaftMaterial: 'AISI 4140 Alloy Steel',
        casingDesignPressureBarg: 45.0,
        casingDesignTempC: 85.0,
        hydrotestPressureBarg: 67.5,
        sealPlan: 'API 682 Plan 53A (Dual pressurized liquid barrier system)'
      }),

      this.generatePumpDatasheet({
        tag: 'P-7001A-C',
        service: 'Cryogenic In-Tank LNG Sendout Pumps (2 Duty + 1 Standby)',
        unitId: 'U-70',
        unitName: 'LNG Storage & BOG Recondensation',
        pumpType: 'API 610 Type VS6 Cryogenic Vertically Suspended Submerged Motor',
        liquid: 'Liquefied Natural Gas (LNG)',
        ratedCapacityM3H: 420.0,
        normalCapacityM3H: 380.0,
        differentialHeadM: 1250.0,
        suctionPressureBarg: 0.35,
        dischargePressureBarg: 45.0,
        pumpingTempC: -161.5,
        specificGravity: 0.45,
        viscosityCp: 0.12,
        vaporPressureBara: 1.15,
        npshaM: 8.5,
        npshrM: 1.8,
        speedRpm: 2980,
        efficiencyPercent: 81.0,
        absorbedPowerKW: 680.0,
        driverPowerKW: 800.0,
        driverVoltage: '6.6 kV / 3-Ph / 50 Hz Submerged Flameproof',
        casingMaterial: 'ASTM A351 Gr CF8M (SS316) Retractable Column',
        impellerMaterial: 'Alloy Aluminum 356.0-T6 / SS316L',
        shaftMaterial: 'Nitronic 50 (XM-19) Stainless Steel',
        casingDesignPressureBarg: 65.0,
        casingDesignTempC: -196.0,
        hydrotestPressureBarg: 97.5,
        sealPlan: 'Seal-less Submerged Electric Induction Motor (LNG cooled & lubricated)'
      }),

      this.generateCompressorDatasheet({
        tag: 'K-6001',
        service: 'C3 Propane Chilling Refrigeration Compressor',
        unitId: 'U-60',
        unitName: 'C3MR Liquefaction & Refrigeration',
        compressorType: 'API 617 Horizontally Split Multi-Stage Centrifugal',
        stagesCount: 3,
        gasName: 'High-Purity Propane (R-290)',
        molecularWeight: 44.097,
        kRatio: 1.13,
        suctionPressureBarg: 0.25,
        suctionTempC: -35.0,
        dischargePressureBarg: 15.5,
        dischargeTempC: 62.0,
        massFlowKgH: 320000.0,
        inletVolumeM3H: 48500.0,
        polytropicHeadKJoulePerKg: 112.5,
        polytropicEfficiencyPercent: 83.5,
        shaftPowerMW: 12.8,
        shaftSpeedRpm: 4650,
        firstCriticalSpeedRpm: 2450,
        casingMaterial: 'ASTM A352 Gr LCC Low-Temp Carbon Steel',
        impellerMaterial: '17-4PH Stainless Steel (Custom 450)',
        shaftMaterial: 'ASTM A470 Class 7 Alloy Forging',
        dryGasSealPlan: 'API 614 Tandem Dry Gas Seals with Intermediate N2 Buffer',
        driverType: 'Industrial Gas Turbine (GE Frame 6B) + Helper Motor'
      }),

      this.generateCompressorDatasheet({
        tag: 'K-6002',
        service: 'Mixed Refrigerant (MR) Liquefaction Compressor',
        unitId: 'U-60',
        unitName: 'C3MR Liquefaction & Refrigeration',
        compressorType: 'API 617 Barrel Type (Vertically Split) Centrifugal Two-Casing Train',
        stagesCount: 6,
        gasName: 'Mixed Refrigerant (N2 5%, C1 45%, C2 40%, C3 10%)',
        molecularWeight: 26.8,
        kRatio: 1.28,
        suctionPressureBarg: 2.8,
        suctionTempC: -30.0,
        dischargePressureBarg: 52.0,
        dischargeTempC: 75.0,
        massFlowKgH: 580000.0,
        inletVolumeM3H: 82000.0,
        polytropicHeadKJoulePerKg: 285.0,
        polytropicEfficiencyPercent: 85.0,
        shaftPowerMW: 48.5,
        shaftSpeedRpm: 4200,
        firstCriticalSpeedRpm: 2100,
        casingMaterial: 'ASTM A352 Gr LCC / ASTM A182 F316L Cryogenic Barrel',
        impellerMaterial: 'Titanium Grade 5 (Ti-6Al-4V) for High-Stress Impellers',
        shaftMaterial: 'Forged Ni-Cr-Mo High-Strength Rotor',
        dryGasSealPlan: 'API 614 Triple-Barrier Cryogenic Dry Gas Seals',
        driverType: 'GE Frame 7EA Heavy-Duty Industrial Gas Turbine (85 MW ISO)'
      }),

      this.generateCompressorDatasheet({
        tag: 'K-7001',
        service: 'Boil-Off Gas (BOG) Reliquefaction Compressor',
        unitId: 'U-70',
        unitName: 'LNG Storage & BOG Recondensation',
        compressorType: 'API 617 / API 618 Multi-Stage Cryogenic Centrifugal / Reciprocating',
        stagesCount: 2,
        gasName: 'Boil-Off Gas (Methane 92%, Nitrogen 8%)',
        molecularWeight: 16.9,
        kRatio: 1.31,
        suctionPressureBarg: 0.15,
        suctionTempC: -140.0,
        dischargePressureBarg: 28.0,
        dischargeTempC: 35.0,
        massFlowKgH: 18500.0,
        inletVolumeM3H: 14200.0,
        polytropicHeadKJoulePerKg: 420.0,
        polytropicEfficiencyPercent: 79.0,
        shaftPowerMW: 2.7,
        shaftSpeedRpm: 11200,
        firstCriticalSpeedRpm: 5600,
        casingMaterial: 'ASTM A351 Gr CF8M Stainless Steel Cryogenic Casing',
        impellerMaterial: 'Custom 450 Precipitation-Hardened SS',
        shaftMaterial: 'AISI 4340 Forged Steel',
        dryGasSealPlan: 'Cryogenic Tandem Dry Gas Seals with Heated N2 Buffer',
        driverType: 'Electric Motor 3.0 MW with Variable Frequency Drive (VFD)'
      }),

      this.generateExchangerDatasheet({
        tag: 'E-2001',
        service: 'Rich / Lean Amine Lean-Rich Exchanger',
        unitId: 'U-20',
        unitName: 'Acid Gas Removal Unit (AGRU)',
        exchangerType: 'TEMA Class R Type AES (Floating Head with Backing Device)',
        dutyMW: 42.5,
        heatTransferAreaM2: 2450.0,
        overallUWPerM2K: 850.0,
        lmtdC: 22.4,
        shellSide: {
          fluid: 'Lean Amine Solution (50 wt% aMDEA)',
          flowRateKgH: 950000.0,
          inletTempC: 122.0,
          outletTempC: 65.0,
          operatingPressureBarg: 6.5,
          designPressureBarg: 12.0,
          pressureDropKPa: 65.0,
          material: 'ASTM A516 Gr 70 Carbon Steel (+ 3.0 mm CA, PWHT)'
        },
        tubeSide: {
          fluid: 'Rich Amine Solution (with dissolved CO2 / H2S)',
          flowRateKgH: 985000.0,
          inletTempC: 58.0,
          outletTempC: 104.0,
          operatingPressureBarg: 65.0,
          designPressureBarg: 80.0,
          pressureDropKPa: 80.0,
          material: 'ASTM A213 TP316L Stainless Steel Seamless Tubes'
        },
        construction: {
          shellDiameterMm: 1600,
          tubeLengthMm: 6000,
          tubeOdMm: 19.05,
          tubeWallMm: 1.65,
          tubeCount: 1850,
          tubePitchMm: 25.4,
          layoutAngleDeg: 45,
          baffleCutPercent: 25,
          baffleSpacingMm: 350
        },
        designCode: 'ASME Section VIII Div 1 + TEMA Class R'
      }),

      this.generateExchangerDatasheet({
        tag: 'E-6001',
        service: 'Main Cryogenic Heat Exchanger (MCHE Liquefier)',
        unitId: 'U-60',
        unitName: 'C3MR Liquefaction & Refrigeration',
        exchangerType: 'Multi-Stream Brazed Aluminum Plate-Fin (BAHX) / Coil-Wound Cryogenic',
        dutyMW: 185.0,
        heatTransferAreaM2: 68000.0,
        overallUWPerM2K: 620.0,
        lmtdC: 4.8,
        shellSide: {
          fluid: 'Low-Pressure Mixed Refrigerant (Shell / Low Pressure Stream)',
          flowRateKgH: 580000.0,
          inletTempC: -162.0,
          outletTempC: -35.0,
          operatingPressureBarg: 3.2,
          designPressureBarg: 10.0,
          pressureDropKPa: 35.0,
          material: 'Cryogenic Aluminum Alloy 3003 / 5083'
        },
        tubeSide: {
          fluid: 'Natural Gas Feed -> Subcooled LNG Product',
          flowRateKgH: 565000.0,
          inletTempC: -32.0,
          outletTempC: -161.5,
          operatingPressureBarg: 58.0,
          designPressureBarg: 75.0,
          pressureDropKPa: 120.0,
          material: 'Cryogenic Aluminum Alloy 3003 / 5083 Plates & Corrugated Fins'
        },
        construction: {
          shellDiameterMm: 4200,
          tubeLengthMm: 48000,
          tubeOdMm: null,
          tubeWallMm: null,
          tubeCount: null,
          plateFinsPerInch: 18,
          finType: 'Serrated / Perforated Cryogenic Fins',
          coreBlocksCount: 16
        },
        designCode: 'ASME Section VIII Div 1 Appendix 31 / ALPEMA Standards'
      }),

      this.generateVesselDatasheet({
        tag: 'V-1001',
        service: 'HP 3-Phase Inlet Production Separator',
        unitId: 'U-10',
        unitName: 'Feed Gas Reception & Slug Catcher',
        orientation: 'Vertical Cylindrical on Support Skirt',
        internalDiameterMm: 2800,
        tanToTanHeightMm: 7500,
        totalVolumeM3: 46.2,
        operatingPressureBarg: 74.5,
        designPressureBarg: 85.0,
        operatingTempC: 34.5,
        designTempMaxC: 65.0,
        designTempMinC: -29.0,
        corrosionAllowanceMm: 3.0,
        jointEfficiency: 1.0,
        nominalShellThicknessMm: 68.0,
        minRequiredThicknessMm: 62.4,
        headType: '2:1 Semi-Ellipsoidal Formed Heads',
        nominalHeadThicknessMm: 65.0,
        shellMaterial: 'ASTM A516 Gr 70 HIC-Tested Carbon Steel (NACE MR0175)',
        headMaterial: 'ASTM A516 Gr 70 Carbon Steel',
        pwhtRequired: true,
        mdmtC: -29.0,
        internals: [
          'Vane-type Cyclonic Inlet Diffuser (N1)',
          'High-Efficiency SS316 Demister Wire Mesh Pad (150 mm thick)',
          'Perforated Wave Breaker Baffles',
          'Bottom Vortex Breakers on Liquid Outlets (N2, N4)'
        ],
        designCode: 'ASME Section VIII Div 1 (NACE MR0175 / ISO 15156)'
      }),

      this.generateVesselDatasheet({
        tag: 'C-2001',
        service: 'High-Pressure Amine Contactor Absorber Column',
        unitId: 'U-20',
        unitName: 'Acid Gas Removal Unit (AGRU)',
        orientation: 'Vertical Column on Cylindrical Skirt',
        internalDiameterMm: 3600,
        tanToTanHeightMm: 32000,
        totalVolumeM3: 325.0,
        operatingPressureBarg: 72.0,
        designPressureBarg: 82.0,
        operatingTempC: 48.0,
        designTempMaxC: 85.0,
        designTempMinC: 0.0,
        corrosionAllowanceMm: 3.0,
        jointEfficiency: 1.0,
        nominalShellThicknessMm: 85.0,
        minRequiredThicknessMm: 78.5,
        headType: '2:1 Semi-Ellipsoidal Heads',
        nominalHeadThicknessMm: 82.0,
        shellMaterial: 'ASTM A516 Gr 70 (PWHT for Sour Amine Service)',
        headMaterial: 'ASTM A516 Gr 70',
        pwhtRequired: true,
        mdmtC: -20.0,
        internals: [
          '4 Packed Beds of Koch-Glitsch Mellapak 250X Structured Packing (SS316L)',
          'High-Performance Multi-Orifice Liquid Distributors (SS316L)',
          'Liquid Collector Trays & Chimney Trays',
          'Top Demister Pad (SS316L wire mesh, 200 mm)'
        ],
        designCode: 'ASME Section VIII Div 1 + Div 2 Fatigue Analysis'
      }),

      this.generateVesselDatasheet({
        tag: 'TK-7001A/B',
        service: 'Full-Containment Cryogenic LNG Storage Tanks (160,000 m3 each)',
        unitId: 'U-70',
        unitName: 'LNG Storage & BOG Recondensation',
        orientation: 'Double-Wall Flat-Bottom Cylindrical Full Containment Tank',
        internalDiameterMm: 80000,
        tanToTanHeightMm: 38000,
        totalVolumeM3: 160000.0,
        operatingPressureBarg: 0.15,
        designPressureBarg: 0.29,
        operatingTempC: -162.0,
        designTempMaxC: 50.0,
        designTempMinC: -168.0,
        corrosionAllowanceMm: 0.0,
        jointEfficiency: 1.0,
        nominalShellThicknessMm: 32.0,
        minRequiredThicknessMm: 24.5,
        headType: 'Suspended Aluminum Deck Dome Roof',
        nominalHeadThicknessMm: 12.0,
        shellMaterial: 'Inner Tank: ASTM A353 / A553 Type 1 (9% Nickel Steel); Outer Tank: Post-Tensioned Reinforced Concrete with 9% Ni / Carbon Steel Liner',
        headMaterial: 'Inner: Cryogenic Aluminum Alloy 5083-O; Outer: Reinforced Concrete Dome',
        pwhtRequired: false,
        mdmtC: -168.0,
        internals: [
          'Perlite Loose-Fill Annular Insulation (1.0 m annular width)',
          'Cellular Glass Foamglas Load-Bearing Bottom Insulation',
          'Internal Submerged LNG Pump Wells (3 x 24" SS316 columns)',
          'Bottom Fill & Top Spray Fill Ring Manifolds',
          'Multi-Point Fiber-Optic DTS Temperature Profiling'
        ],
        designCode: 'API 620 Appendix Q & EN 14620 (Full Containment Class 1)'
      }),

      this.generateReactorDatasheet({
        tag: 'R-3501',
        service: 'SCOT Tail Gas Catalytic Hydrogenation Reactor',
        unitId: 'U-35',
        unitName: 'SCOT TGTU & Incineration',
        orientation: 'Vertical Cylindrical Fixed-Bed Catalytic Reactor',
        internalDiameterMm: 2600,
        tanToTanHeightMm: 7500,
        totalVolumeM3: 39.8,
        catalystType: 'Cobalt-Molybdenum (CoMo) on Alumina Extrudates (HDN-30 / Axens)',
        catalystVolumeM3: 18.5,
        catalystBedHeightMm: 3500,
        operatingPressureBarg: 1.8,
        designPressureBarg: 4.5,
        operatingTempC: 300.0,
        designTempMaxC: 350.0,
        designTempMinC: 0.0,
        corrosionAllowanceMm: 3.0,
        jointEfficiency: 1.0,
        nominalShellThicknessMm: 24.0,
        minRequiredThicknessMm: 18.2,
        headType: '2:1 Semi-Ellipsoidal Formed Heads',
        nominalHeadThicknessMm: 22.0,
        shellMaterial: 'ASTM A387 Gr 11 Cl 2 (1.25Cr-0.5Mo) Alloy Steel',
        headMaterial: 'ASTM A387 Gr 11 Cl 2 Alloy Steel',
        pwhtRequired: true,
        mdmtC: 0.0,
        internals: [
          'Inlet Gas Distributor & Ceramic Ball Grading Layer (75 mm)',
          'Stainless Steel 321 Catalyst Support Grid with Wedge Wire Screen',
          'Multi-Point In-Bed Thermocouple Assembly (8 Radial/Axial Points)',
          'Outlet Gas Collector & Ceramic Alumina Support Balls (100 mm)'
        ],
        designCode: 'ASME Section VIII Div 1 (High-Temperature Hydrogen Service)'
      }),

      this.generatePsvDatasheet({
        tag: 'PSV-1001',
        service: 'Inlet Slug Catcher Overpressure Relief (Blocked Gas Outlet)',
        unitId: 'U-10',
        unitName: 'Feed Gas Reception & Slug Catcher',
        protectedEquipment: 'Slug Catcher SC-1001 & Separator V-1001',
        contingency: 'Blocked Outlet downstream of V-1001',
        fluid: 'Natural Gas (MW=19.4)',
        phase: 'Gas',
        relievingRateKgH: 340000.0,
        setPressureBarg: 85.0,
        overpressurePercent: 10,
        relievingPressureBara: 94.51,
        relievingTempC: 45.0,
        compressibilityZ: 0.82,
        kRatio: 1.28,
        kd: 0.975,
        kb: 1.0,
        requiredAreaMm2: 3250.0,
        selectedOrifice: 'T',
        selectedAreaMm2: 3871.0,
        selectedAreaIn2: 6.00,
        inletRating: '8" Class 600 RF',
        outletRating: '10" Class 150 RF',
        valveType: 'API 526 Conventional Spring-Loaded Flanged PRV',
        bodyMaterial: 'ASTM A216 Gr WCB Carbon Steel (NACE MR0175)',
        trimMaterial: 'SS316 with Stellite 6 Overlay',
        springMaterial: 'Inconel X-750 Sour Service Spring',
        flareDestination: 'Warm Wet Flare FL-9502'
      }),

      this.generatePsvDatasheet({
        tag: 'PSV-6001',
        service: 'Main Cryogenic Heat Exchanger Tube Rupture (MR to LNG Stream)',
        unitId: 'U-60',
        unitName: 'C3MR Liquefaction & Refrigeration',
        protectedEquipment: 'MCHE Liquefier E-6001 Low Pressure Core',
        contingency: 'High Pressure Tube / Core Rupture into Cryogenic LP Casing',
        fluid: 'Mixed Refrigerant / Cold Gas (MW=26.8)',
        phase: 'Cryogenic Vapor',
        relievingRateKgH: 420000.0,
        setPressureBarg: 55.0,
        overpressurePercent: 16,
        relievingPressureBara: 64.81,
        relievingTempC: -120.0,
        compressibilityZ: 0.72,
        kRatio: 1.25,
        kd: 0.975,
        kb: 1.0,
        requiredAreaMm2: 3620.0,
        selectedOrifice: 'T',
        selectedAreaMm2: 3871.0,
        selectedAreaIn2: 6.00,
        inletRating: '8" Class 600 RF',
        outletRating: '10" Class 150 RF',
        valveType: 'API 526 Balanced Bellows Cryogenic Safety Relief Valve',
        bodyMaterial: 'ASTM A351 Gr CF8M (SS316) Stainless Steel Cryogenic Body',
        trimMaterial: 'SS316L with Kel-F / Stellite Hardfacing',
        springMaterial: 'ASTM A313 Type 316 Stainless Steel Spring',
        flareDestination: 'Cold Dry Flare FL-9501 (SS304L Cryogenic Header)'
      }),

      this.generateControlValveDatasheet({
        tag: 'PCV-1001',
        service: 'Separator V-1001 Gas Pressure Control Station',
        unitId: 'U-10',
        unitName: 'Feed Gas Reception & Slug Catcher',
        lineTag: 'L-1006-28-CS-600-IH',
        fluid: 'Raw Sour Natural Gas',
        phase: 'Gas',
        valveStyle: 'Cage-Guided Heavy-Duty Globe Valve',
        flowCharacteristic: 'Equal Percentage (=%)',
        valveSizeNps: 28,
        rating: 'Class 600 RF',
        operatingCases: {
          min: { flowRateKgH: 250000.0, inletPBarg: 74.5, outletPBarg: 68.0, tempC: 34.0, calculatedCv: 245.0, travelPercent: 32.0 },
          norm: { flowRateKgH: 665000.0, inletPBarg: 74.2, outletPBarg: 67.5, tempC: 34.2, calculatedCv: 580.0, travelPercent: 64.0 },
          max: { flowRateKgH: 740000.0, inletPBarg: 74.0, outletPBarg: 66.0, tempC: 35.0, calculatedCv: 710.0, travelPercent: 78.0 }
        },
        ratedCv: 920.0,
        shutoffClass: 'ANSI / FCI 70-2 Class V',
        predictedNoiseDba: 82.5,
        flFactor: 0.90,
        xtFactor: 0.72,
        bodyMaterial: 'ASTM A216 Gr WCB Carbon Steel (NACE MR0175)',
        bonnetType: 'Standard Flanged Bonnet with Live-Loaded Graphite Packing',
        trimMaterial: 'SS316 Cage & Plug with Stellite 6 Seat Ring',
        actuatorType: 'Pneumatic Spring-and-Diaphragm (Multi-Spring Heavy Duty)',
        failAction: 'Fail Open (FO) to prevent pipeline overpressure',
        positioner: 'Smart Digital Positioner 4-20 mA HART with Diagnostics'
      }),

      this.generateControlValveDatasheet({
        tag: 'FCV-2001',
        service: 'Lean Amine Circulation Flow to Absorber C-2001',
        unitId: 'U-20',
        unitName: 'Acid Gas Removal Unit (AGRU)',
        lineTag: 'L-2011-12-CS-600-H',
        fluid: 'Activated aMDEA Solution (50 wt%)',
        phase: 'Liquid',
        valveStyle: 'Top-Guided Balanced Globe Valve',
        flowCharacteristic: 'Linear',
        valveSizeNps: 12,
        rating: 'Class 600 RF',
        operatingCases: {
          min: { flowRateKgH: 450000.0, inletPBarg: 78.0, outletPBarg: 74.0, tempC: 45.0, calculatedCv: 185.0, travelPercent: 38.0 },
          norm: { flowRateKgH: 950000.0, inletPBarg: 77.5, outletPBarg: 72.0, tempC: 46.0, calculatedCv: 340.0, travelPercent: 65.0 },
          max: { flowRateKgH: 1050000.0, inletPBarg: 77.0, outletPBarg: 71.0, tempC: 47.0, calculatedCv: 395.0, travelPercent: 74.0 }
        },
        ratedCv: 520.0,
        shutoffClass: 'ANSI / FCI 70-2 Class IV',
        predictedNoiseDba: 74.0,
        flFactor: 0.88,
        xtFactor: 0.68,
        bodyMaterial: 'ASTM A216 Gr WCB Carbon Steel (PWHT for Amine)',
        bonnetType: 'Extension Bonnet with PTFE Chevron Rings',
        trimMaterial: '316 SS with Cobalt Alloy Hard-Facing',
        actuatorType: 'Pneumatic Spring-and-Diaphragm',
        failAction: 'Fail Closed (FC) on Loss of Instrument Air',
        positioner: 'Smart Digital Positioner 4-20 mA HART'
      })
    ];
  }

  /**
   * Lookup datasheet by equipment or valve tag.
   * @param {string} tag Equipment tag.
   * @returns {object|null} Datasheet object.
   */
  getDatasheetByTag(tag) {
    const list = this.generateAllDatasheets();
    return list.find((d) => d.tag === tag || d.tag.includes(tag)) || null;
  }

  /**
   * Generates structured API 610 Centrifugal / VS6 Pump datasheet.
   * @param {object} p Configuration parameters.
   * @returns {object} Formatted datasheet.
   */
  generatePumpDatasheet(p) {
    return {
      category: 'Pumps',
      standard: 'API 610 12th Edition / ISO 13709',
      tag: p.tag,
      service: p.service,
      unitId: p.unitId,
      unitName: p.unitName,
      documentNumber: `DS-${p.tag.replace(/[^A-Z0-9]/g, '')}`,
      revision: '0',
      date: '2026-11-06',
      pumpType: p.pumpType,
      liquid: p.liquid,
      operatingConditions: {
        ratedCapacityM3H: p.ratedCapacityM3H,
        normalCapacityM3H: p.normalCapacityM3H,
        differentialHeadM: p.differentialHeadM,
        suctionPressureBarg: p.suctionPressureBarg,
        dischargePressureBarg: p.dischargePressureBarg,
        pumpingTempC: p.pumpingTempC,
        specificGravity: p.specificGravity,
        viscosityCp: p.viscosityCp,
        vaporPressureBara: p.vaporPressureBara,
        npshaM: p.npshaM,
        npshrM: p.npshrM,
        npshMarginM: Number((p.npshaM - p.npshrM).toFixed(2))
      },
      performance: {
        speedRpm: p.speedRpm,
        efficiencyPercent: p.efficiencyPercent,
        absorbedPowerKW: p.absorbedPowerKW,
        driverPowerKW: p.driverPowerKW,
        driverVoltage: p.driverVoltage
      },
      construction: {
        casingMaterial: p.casingMaterial,
        impellerMaterial: p.impellerMaterial,
        shaftMaterial: p.shaftMaterial,
        casingDesignPressureBarg: p.casingDesignPressureBarg,
        casingDesignTempC: p.casingDesignTempC,
        hydrotestPressureBarg: p.hydrotestPressureBarg,
        sealPlan: p.sealPlan
      }
    };
  }

  /**
   * Generates structured API 617 Centrifugal Compressor datasheet.
   * @param {object} c Configuration parameters.
   * @returns {object} Formatted datasheet.
   */
  generateCompressorDatasheet(c) {
    const pr = Number(((c.dischargePressureBarg + 1.013) / (c.suctionPressureBarg + 1.013)).toFixed(2));
    return {
      category: 'Compressors',
      standard: 'API 617 8th Edition (Axial/Centrifugal Compressors)',
      tag: c.tag,
      service: c.service,
      unitId: c.unitId,
      unitName: c.unitName,
      documentNumber: `DS-${c.tag.replace(/[^A-Z0-9]/g, '')}`,
      revision: '0',
      date: '2026-11-06',
      compressorType: c.compressorType,
      stagesCount: c.stagesCount,
      gasProperties: {
        gasName: c.gasName,
        molecularWeight: c.molecularWeight,
        kRatio: c.kRatio
      },
      processConditions: {
        suctionPressureBarg: c.suctionPressureBarg,
        suctionTempC: c.suctionTempC,
        dischargePressureBarg: c.dischargePressureBarg,
        dischargeTempC: c.dischargeTempC,
        pressureRatio: pr,
        massFlowKgH: c.massFlowKgH,
        inletVolumeM3H: c.inletVolumeM3H
      },
      performance: {
        polytropicHeadKJoulePerKg: c.polytropicHeadKJoulePerKg,
        polytropicEfficiencyPercent: c.polytropicEfficiencyPercent,
        shaftPowerMW: c.shaftPowerMW,
        shaftSpeedRpm: c.shaftSpeedRpm,
        firstCriticalSpeedRpm: c.firstCriticalSpeedRpm,
        separationMarginPercent: Number((((c.shaftSpeedRpm - c.firstCriticalSpeedRpm) / c.firstCriticalSpeedRpm) * 100).toFixed(1))
      },
      mechanical: {
        casingMaterial: c.casingMaterial,
        impellerMaterial: c.impellerMaterial,
        shaftMaterial: c.shaftMaterial,
        dryGasSealPlan: c.dryGasSealPlan,
        driverType: c.driverType
      }
    };
  }

  /**
   * Generates structured TEMA / BAHX Heat Exchanger datasheet.
   * @param {object} e Configuration parameters.
   * @returns {object} Formatted datasheet.
   */
  generateExchangerDatasheet(e) {
    return {
      category: 'Heat Exchangers',
      standard: e.designCode || 'ASME Section VIII Div 1 + TEMA Class R',
      tag: e.tag,
      service: e.service,
      unitId: e.unitId,
      unitName: e.unitName,
      documentNumber: `DS-${e.tag.replace(/[^A-Z0-9]/g, '')}`,
      revision: '0',
      date: '2026-11-06',
      exchangerType: e.exchangerType,
      dutyMW: e.dutyMW,
      thermalRating: {
        dutyMW: e.dutyMW,
        heatTransferAreaM2: e.heatTransferAreaM2,
        overallUWPerM2K: e.overallUWPerM2K,
        lmtdC: e.lmtdC
      },
      shellSide: e.shellSide,
      tubeSide: e.tubeSide,
      construction: e.construction
    };
  }

  /**
   * Generates structured ASME Section VIII Pressure Vessel / Column / Tank datasheet.
   * @param {object} v Configuration parameters.
   * @returns {object} Formatted datasheet.
   */
  generateVesselDatasheet(v) {
    return {
      category: 'Pressure Vessels & Columns',
      standard: v.designCode || 'ASME Section VIII Div 1',
      tag: v.tag,
      service: v.service,
      unitId: v.unitId,
      unitName: v.unitName,
      documentNumber: `DS-${v.tag.replace(/[^A-Z0-9]/g, '')}`,
      revision: '0',
      date: '2026-11-06',
      orientation: v.orientation,
      dimensions: {
        internalDiameterMm: v.internalDiameterMm,
        tanToTanHeightMm: v.tanToTanHeightMm,
        totalVolumeM3: v.totalVolumeM3
      },
      designConditions: {
        operatingPressureBarg: v.operatingPressureBarg,
        designPressureBarg: v.designPressureBarg,
        operatingTempC: v.operatingTempC,
        designTempMaxC: v.designTempMaxC,
        designTempMinC: v.designTempMinC,
        corrosionAllowanceMm: v.corrosionAllowanceMm,
        jointEfficiency: v.jointEfficiency
      },
      mechanicalDesign: {
        nominalShellThicknessMm: v.nominalShellThicknessMm,
        minRequiredThicknessMm: v.minRequiredThicknessMm,
        headType: v.headType,
        nominalHeadThicknessMm: v.nominalHeadThicknessMm,
        shellMaterial: v.shellMaterial,
        headMaterial: v.headMaterial,
        pwhtRequired: v.pwhtRequired,
        mdmtC: v.mdmtC
      },
      internals: v.internals || []
    };
  }

  /**
   * Generates structured ASME Section VIII Reactor datasheet.
   * @param {object} r Configuration parameters.
   * @returns {object} Formatted datasheet.
   */
  generateReactorDatasheet(r) {
    return {
      category: 'Reactors',
      standard: r.designCode || 'ASME Section VIII Div 1',
      tag: r.tag,
      service: r.service,
      unitId: r.unitId,
      unitName: r.unitName,
      documentNumber: `DS-${r.tag.replace(/[^A-Z0-9]/g, '')}`,
      revision: '0',
      date: '2026-11-06',
      orientation: r.orientation,
      dimensions: {
        internalDiameterMm: r.internalDiameterMm,
        tanToTanHeightMm: r.tanToTanHeightMm,
        totalVolumeM3: r.totalVolumeM3
      },
      catalystData: {
        catalystType: r.catalystType,
        catalystVolumeM3: r.catalystVolumeM3,
        catalystBedHeightMm: r.catalystBedHeightMm
      },
      catalystBed: {
        catalystType: r.catalystType,
        catalystVolumeM3: r.catalystVolumeM3,
        catalystBedHeightMm: r.catalystBedHeightMm
      },
      designConditions: {
        operatingPressureBarg: r.operatingPressureBarg,
        designPressureBarg: r.designPressureBarg,
        operatingTempC: r.operatingTempC,
        designTempMaxC: r.designTempMaxC,
        designTempMinC: r.designTempMinC,
        corrosionAllowanceMm: r.corrosionAllowanceMm,
        jointEfficiency: r.jointEfficiency
      },
      mechanicalDesign: {
        nominalShellThicknessMm: r.nominalShellThicknessMm,
        minRequiredThicknessMm: r.minRequiredThicknessMm,
        headType: r.headType,
        nominalHeadThicknessMm: r.nominalHeadThicknessMm,
        shellMaterial: r.shellMaterial,
        headMaterial: r.headMaterial,
        pwhtRequired: r.pwhtRequired,
        mdmtC: r.mdmtC
      },
      internals: r.internals || []
    };
  }

  /**
   * Generates structured API 526 Safety Relief Valve datasheet.
   * @param {object} r Configuration parameters.
   * @returns {object} Formatted datasheet.
   */
  generatePsvDatasheet(r) {
    return {
      category: 'Pressure Relief Valves',
      standard: 'API 520 Part I / API 526 7th Edition',
      tag: r.tag,
      service: r.service,
      unitId: r.unitId,
      unitName: r.unitName,
      documentNumber: `DS-${r.tag.replace(/[^A-Z0-9]/g, '')}`,
      revision: '0',
      date: '2026-11-06',
      protectedEquipment: r.protectedEquipment,
      contingency: r.contingency,
      valveType: r.valveType,
      processData: {
        fluid: r.fluid,
        phase: r.phase,
        relievingRateKgH: r.relievingRateKgH,
        relievingTempC: r.relievingTempC,
        setPressureBarg: r.setPressureBarg,
        overpressurePercent: r.overpressurePercent,
        relievingPressureBara: r.relievingPressureBara,
        compressibilityZ: r.compressibilityZ,
        kRatio: r.kRatio
      },
      orificeSizing: {
        kd: r.kd,
        kb: r.kb,
        requiredAreaMm2: r.requiredAreaMm2,
        selectedOrifice: r.selectedOrifice,
        selectedAreaMm2: r.selectedAreaMm2,
        selectedAreaIn2: r.selectedAreaIn2,
        areaMarginPercent: Number((((r.selectedAreaMm2 - r.requiredAreaMm2) / r.requiredAreaMm2) * 100).toFixed(1))
      },
      connectionsAndMaterials: {
        inletRating: r.inletRating,
        outletRating: r.outletRating,
        bodyMaterial: r.bodyMaterial,
        trimMaterial: r.trimMaterial,
        springMaterial: r.springMaterial,
        flareDestination: r.flareDestination
      }
    };
  }

  /**
   * Generates structured ISA-75.25 Control Valve datasheet.
   * @param {object} cv Configuration parameters.
   * @returns {object} Formatted datasheet.
   */
  generateControlValveDatasheet(cv) {
    return {
      category: 'Control Valves',
      standard: 'ISA-75.01 / IEC 60534-2-1 / ISA-75.25',
      tag: cv.tag,
      service: cv.service,
      unitId: cv.unitId,
      unitName: cv.unitName,
      documentNumber: `DS-${cv.tag.replace(/[^A-Z0-9]/g, '')}`,
      revision: '0',
      date: '2026-11-06',
      lineTag: cv.lineTag,
      fluid: cv.fluid,
      phase: cv.phase,
      valveStyle: cv.valveStyle,
      flowCharacteristic: cv.flowCharacteristic,
      valveSizeNps: cv.valveSizeNps,
      rating: cv.rating,
      operatingCases: cv.operatingCases,
      sizingCoefficients: {
        ratedCv: cv.ratedCv,
        shutoffClass: cv.shutoffClass,
        predictedNoiseDba: cv.predictedNoiseDba,
        flFactor: cv.flFactor,
        xtFactor: cv.xtFactor
      },
      materials: {
        bodyMaterial: cv.bodyMaterial,
        bonnetType: cv.bonnetType,
        trimMaterial: cv.trimMaterial
      },
      actuator: {
        actuatorType: cv.actuatorType,
        failAction: cv.failAction,
        positioner: cv.positioner
      }
    };
  }

  /**
   * Formats any structured datasheet into Markdown.
   * @param {object} ds Structured datasheet object.
   * @returns {string} Markdown representation.
   */
  toMarkdown(ds) {
    let md = `# Engineering Equipment Datasheet: ${ds.tag}\n\n`;
    md += `| Item | Specification Details |\n`;
    md += `|---|---|\n`;
    md += `| **Tag Number** | **${ds.tag}** |\n`;
    md += `| **Service** | ${ds.service} |\n`;
    md += `| **Plant Unit** | ${ds.unitId} - ${ds.unitName} |\n`;
    md += `| **Document No** | ${ds.documentNumber} (Rev ${ds.revision}) |\n`;
    md += `| **Governing Standard** | ${ds.standard} |\n`;
    md += `| **Category** | ${ds.category} |\n\n`;

    if (ds.category === 'Pumps') {
      md += `### Operating & Hydraulic Data\n\n`;
      md += `| Parameter | Value |\n|---|---|\n`;
      md += `| Pump Style | ${ds.pumpType} |\n`;
      md += `| Pumping Liquid | ${ds.liquid} |\n`;
      md += `| Rated Flow | ${ds.operatingConditions.ratedCapacityM3H} m³/h |\n`;
      md += `| Differential Head | ${ds.operatingConditions.differentialHeadM} m |\n`;
      md += `| Pressures (Suct / Disch) | ${ds.operatingConditions.suctionPressureBarg} / ${ds.operatingConditions.dischargePressureBarg} barg |\n`;
      md += `| Pumping Temp | ${ds.operatingConditions.pumpingTempC} °C |\n`;
      md += `| Specific Gravity / Visc | ${ds.operatingConditions.specificGravity} / ${ds.operatingConditions.viscosityCp} cP |\n`;
      md += `| NPSHa / NPSHr / Margin | ${ds.operatingConditions.npshaM} m / ${ds.operatingConditions.npshrM} m / **+${ds.operatingConditions.npshMarginM} m** |\n`;
      md += `| Operating Speed / Efficiency | ${ds.performance.speedRpm} RPM / ${ds.performance.efficiencyPercent} % |\n`;
      md += `| Absorbed / Driver Power | ${ds.performance.absorbedPowerKW} kW / ${ds.performance.driverPowerKW} kW (${ds.performance.driverVoltage}) |\n`;
      md += `| Casing / Impeller Metallurgy | ${ds.construction.casingMaterial} / ${ds.construction.impellerMaterial} |\n`;
      md += `| Mechanical Seal | ${ds.construction.sealPlan} |\n`;
      md += `| Casing Design P / Hydrotest | ${ds.construction.casingDesignPressureBarg} barg / **${ds.construction.hydrotestPressureBarg} barg** |\n`;
    } else if (ds.category === 'Compressors') {
      md += `### Thermodynamic & Aerodynamic Performance\n\n`;
      md += `| Parameter | Value |\n|---|---|\n`;
      md += `| Compressor Type | ${ds.compressorType} (${ds.stagesCount} stages) |\n`;
      md += `| Gas Handled | ${ds.gasProperties.gasName} (MW=${ds.gasProperties.molecularWeight}, k=${ds.gasProperties.kRatio}) |\n`;
      md += `| Suction Conditions | ${ds.processConditions.suctionPressureBarg} barg / ${ds.processConditions.suctionTempC} °C |\n`;
      md += `| Discharge Conditions | ${ds.processConditions.dischargePressureBarg} barg / ${ds.processConditions.dischargeTempC} °C |\n`;
      md += `| Pressure Ratio | ${ds.processConditions.pressureRatio} : 1 |\n`;
      md += `| Flow Rates | ${ds.processConditions.massFlowKgH.toLocaleString()} kg/h (${ds.processConditions.inletVolumeM3H.toLocaleString()} m³/h) |\n`;
      md += `| Polytropic Head / Efficiency | ${ds.performance.polytropicHeadKJoulePerKg} kJ/kg / ${ds.performance.polytropicEfficiencyPercent} % |\n`;
      md += `| Shaft Power / Speed | **${ds.performance.shaftPowerMW} MW** / ${ds.performance.shaftSpeedRpm} RPM |\n`;
      md += `| Critical Speed / Margin | ${ds.performance.firstCriticalSpeedRpm} RPM / +${ds.performance.separationMarginPercent} % (API 684) |\n`;
      md += `| Casing & Impeller Materials | ${ds.mechanical.casingMaterial} / ${ds.mechanical.impellerMaterial} |\n`;
      md += `| Shaft Seal / Driver | ${ds.mechanical.dryGasSealPlan} / ${ds.mechanical.driverType} |\n`;
    } else if (ds.category === 'Heat Exchangers') {
      md += `### Thermal & Hydraulic Rating\n\n`;
      md += `| Parameter | Value |\n|---|---|\n`;
      md += `| Exchanger Configuration | ${ds.exchangerType} |\n`;
      md += `| Thermal Duty | **${ds.thermalRating.dutyMW} MW** |\n`;
      md += `| Heat Transfer Surface Area | ${ds.thermalRating.heatTransferAreaM2.toLocaleString()} m² |\n`;
      md += `| Overall Heat Transfer Coeff (U) | ${ds.thermalRating.overallUWPerM2K} W/(m²·K) |\n`;
      md += `| LMTD | ${ds.thermalRating.lmtdC} °C |\n`;
      md += `| Shell Side Fluid & Rate | ${ds.shellSide.fluid} (${ds.shellSide.flowRateKgH.toLocaleString()} kg/h) |\n`;
      md += `| Shell Temps (In/Out) / Press | ${ds.shellSide.inletTempC}°C -> ${ds.shellSide.outletTempC}°C / ${ds.shellSide.operatingPressureBarg} barg |\n`;
      md += `| Tube Side Fluid & Rate | ${ds.tubeSide.fluid} (${ds.tubeSide.flowRateKgH.toLocaleString()} kg/h) |\n`;
      md += `| Tube Temps (In/Out) / Press | ${ds.tubeSide.inletTempC}°C -> ${ds.tubeSide.outletTempC}°C / ${ds.tubeSide.operatingPressureBarg} barg |\n`;
      md += `| Shell / Tube Materials | ${ds.shellSide.material} / ${ds.tubeSide.material} |\n`;
    } else if (ds.category === 'Pressure Vessels & Columns') {
      md += `### Mechanical Design per ASME Section VIII\n\n`;
      md += `| Parameter | Value |\n|---|---|\n`;
      md += `| Vessel Dimensions | ID ${ds.dimensions.internalDiameterMm} mm x H/L ${ds.dimensions.tanToTanHeightMm} mm (Vol: ${ds.dimensions.totalVolumeM3} m³) |\n`;
      md += `| Design Press / Temp | ${ds.designConditions.designPressureBarg} barg / ${ds.designConditions.designTempMaxC} °C (MDMT: ${ds.mechanicalDesign.mdmtC} °C) |\n`;
      md += `| Operating Press / Temp | ${ds.designConditions.operatingPressureBarg} barg / ${ds.designConditions.operatingTempC} °C |\n`;
      md += `| Corrosion Allowance | ${ds.designConditions.corrosionAllowanceMm} mm |\n`;
      md += `| Shell / Head Thickness | Shell: ${ds.mechanicalDesign.nominalShellThicknessMm} mm (req: ${ds.mechanicalDesign.minRequiredThicknessMm} mm) / Head: ${ds.mechanicalDesign.nominalHeadThicknessMm} mm |\n`;
      md += `| Materials (Shell / Heads) | ${ds.mechanicalDesign.shellMaterial} / ${ds.mechanicalDesign.headMaterial} |\n`;
      md += `| Head Geometry | ${ds.mechanicalDesign.headType} |\n`;
      md += `| PWHT Required | ${ds.mechanicalDesign.pwhtRequired ? 'YES (per ASME UCS-56 / NACE)' : 'NO'} |\n`;
      md += `| Internal Components | ${ds.internals.join('; ')} |\n`;
    } else if (ds.category === 'Reactors') {
      md += `### Catalytic & Mechanical Design per ASME Section VIII\n\n`;
      md += `| Parameter | Value |\n|---|---|\n`;
      md += `| Reactor Style | ${ds.orientation} |\n`;
      md += `| Dimensions | ID ${ds.dimensions.internalDiameterMm} mm x H/L ${ds.dimensions.tanToTanHeightMm} mm (Vol: ${ds.dimensions.totalVolumeM3} m³) |\n`;
      md += `| Catalyst Spec | ${ds.catalystData.catalystType} (${ds.catalystData.catalystVolumeM3} m³, Bed H=${ds.catalystData.catalystBedHeightMm} mm) |\n`;
      md += `| Design Press / Temp | ${ds.designConditions.designPressureBarg} barg / ${ds.designConditions.designTempMaxC} °C (MDMT: ${ds.mechanicalDesign.mdmtC} °C) |\n`;
      md += `| Operating Press / Temp | ${ds.designConditions.operatingPressureBarg} barg / ${ds.designConditions.operatingTempC} °C |\n`;
      md += `| Corrosion Allowance | ${ds.designConditions.corrosionAllowanceMm} mm |\n`;
      md += `| Shell / Head Thickness | Shell: ${ds.mechanicalDesign.nominalShellThicknessMm} mm (req: ${ds.mechanicalDesign.minRequiredThicknessMm} mm) / Head: ${ds.mechanicalDesign.nominalHeadThicknessMm} mm |\n`;
      md += `| Materials (Shell / Heads) | ${ds.mechanicalDesign.shellMaterial} / ${ds.mechanicalDesign.headMaterial} |\n`;
      md += `| PWHT Required | ${ds.mechanicalDesign.pwhtRequired ? 'YES (per ASME UCS-56 / NACE)' : 'NO'} |\n`;
      md += `| Reactor Internals | ${ds.internals.join('; ')} |\n`;
    } else if (ds.category === 'Pressure Relief Valves') {
      md += `### API 520 / API 526 Relief Sizing\n\n`;
      md += `| Parameter | Value |\n|---|---|\n`;
      md += `| Protected Equipment | ${ds.protectedEquipment} |\n`;
      md += `| Governing Contingency | ${ds.contingency} |\n`;
      md += `| Relieving Fluid & Phase | ${ds.processData.fluid} (${ds.processData.phase}) |\n`;
      md += `| Relieving Mass Rate | ${ds.processData.relievingRateKgH.toLocaleString()} kg/h |\n`;
      md += `| Set Pressure / Overpressure | ${ds.processData.setPressureBarg} barg / +${ds.processData.overpressurePercent} % (P1 = ${ds.processData.relievingPressureBara} bara) |\n`;
      md += `| Relieving Temp | ${ds.processData.relievingTempC} °C |\n`;
      md += `| Calculated Required Area | ${ds.orificeSizing.requiredAreaMm2} mm² |\n`;
      md += `| Selected API 526 Orifice | **Letter '${ds.orificeSizing.selectedOrifice}'** (${ds.orificeSizing.selectedAreaMm2} mm² / ${ds.orificeSizing.selectedAreaIn2} in²) |\n`;
      md += `| Sizing Margin | +${ds.orificeSizing.areaMarginPercent} % over required area |\n`;
      md += `| Flange Connections | Inlet: ${ds.connectionsAndMaterials.inletRating} / Outlet: ${ds.connectionsAndMaterials.outletRating} |\n`;
      md += `| Body / Trim Metallurgy | ${ds.connectionsAndMaterials.bodyMaterial} / ${ds.connectionsAndMaterials.trimMaterial} |\n`;
      md += `| Flare Destination | **${ds.connectionsAndMaterials.flareDestination}** |\n`;
    } else if (ds.category === 'Control Valves') {
      md += `### Control Valve Sizing & Acoustics (ISA-75.01 / IEC 60534)\n\n`;
      md += `| Parameter | Value |\n|---|---|\n`;
      md += `| Service Line Number | ${ds.lineTag} |\n`;
      md += `| Valve Body Style & Trim | ${ds.valveStyle} (${ds.flowCharacteristic}) |\n`;
      md += `| Valve Size & Flange Rating | **NPS ${ds.valveSizeNps}" Class ${ds.rating}** |\n`;
      md += `| Rated Cv / Shutoff Class | **Cv = ${ds.sizingCoefficients.ratedCv}** / ${ds.sizingCoefficients.shutoffClass} |\n`;
      md += `| Min Flow Case | ${ds.operatingCases.min.flowRateKgH.toLocaleString()} kg/h (Cv=${ds.operatingCases.min.calculatedCv}, Travel=${ds.operatingCases.min.travelPercent}%) |\n`;
      md += `| Normal Flow Case | ${ds.operatingCases.norm.flowRateKgH.toLocaleString()} kg/h (Cv=${ds.operatingCases.norm.calculatedCv}, Travel=${ds.operatingCases.norm.travelPercent}%) |\n`;
      md += `| Max Flow Case | ${ds.operatingCases.max.flowRateKgH.toLocaleString()} kg/h (Cv=${ds.operatingCases.max.calculatedCv}, Travel=${ds.operatingCases.max.travelPercent}%) |\n`;
      md += `| Predicted Noise at 1m | ${ds.sizingCoefficients.predictedNoiseDba} dBA (IEC 60534-8-3) |\n`;
      md += `| Body / Trim Materials | ${ds.materials.bodyMaterial} / ${ds.materials.trimMaterial} |\n`;
      md += `| Actuator & Failure Action | ${ds.actuator.actuatorType} / **${ds.actuator.failAction}** |\n`;
      md += `| Smart Positioner | ${ds.actuator.positioner} |\n`;
    }

    return md;
  }

  /**
   * Formats structured datasheet into standalone HTML page with industrial CSS styling.
   * Converts markdown tables into semantic HTML tables.
   * @param {object} ds Structured datasheet object.
   * @returns {string} HTML content.
   */
  toHtml(ds) {
    const md = this.toMarkdown(ds);
    const lines = md.split('\n');
    const htmlLines = [];
    let inTable = false;
    let tableHeader = null;
    let tableRows = [];

    const flushTable = () => {
      if (!inTable) return;
      htmlLines.push('<table>');
      if (tableHeader) {
        htmlLines.push('  <thead>');
        htmlLines.push('    <tr>' + tableHeader.map((c) => `<th>${c}</th>`).join('') + '</tr>');
        htmlLines.push('  </thead>');
      }
      if (tableRows.length > 0) {
        htmlLines.push('  <tbody>');
        for (const row of tableRows) {
          htmlLines.push('    <tr>' + row.map((c) => `<td>${c}</td>`).join('') + '</tr>');
        }
        htmlLines.push('  </tbody>');
      }
      htmlLines.push('</table>');
      inTable = false;
      tableHeader = null;
      tableRows = [];
    };

    const formatInline = (text) => {
      return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('|') && line.endsWith('|')) {
        if (/^\|[-:\s|]+$/.test(line)) {
          // Delimiter line (|---|---|)
          if (tableRows.length > 0 && !tableHeader) {
            tableHeader = tableRows.pop();
          }
          continue;
        }
        const cells = line.split('|').slice(1, -1).map((c) => formatInline(c.trim()));
        if (!inTable) {
          inTable = true;
          tableHeader = null;
          tableRows = [];
        }
        tableRows.push(cells);
      } else {
        flushTable();
        if (line.startsWith('# ')) {
          htmlLines.push(`<h1>${formatInline(line.slice(2))}</h1>`);
        } else if (line.startsWith('### ')) {
          htmlLines.push(`<h3>${formatInline(line.slice(4))}</h3>`);
        } else if (line.startsWith('## ')) {
          htmlLines.push(`<h2>${formatInline(line.slice(3))}</h2>`);
        } else if (line.length > 0) {
          htmlLines.push(`<p>${formatInline(line)}</p>`);
        }
      }
    }
    flushTable();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${ds.tag} - Datasheet</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 30px; color: #222; background: #fff; line-height: 1.5; }
    h1 { color: #0b3c5d; border-bottom: 2px solid #0b3c5d; padding-bottom: 8px; font-size: 22px; }
    h3 { color: #328cc1; margin-top: 24px; font-size: 16px; text-transform: uppercase; letter-spacing: 0.5px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; margin-bottom: 20px; font-size: 13px; }
    th, td { border: 1px solid #dcdcdc; padding: 6px 12px; text-align: left; }
    th { background-color: #0b3c5d; color: #ffffff; font-weight: 600; }
    tr:nth-child(even) { background-color: #f9fbfd; }
    td:first-child { font-weight: 600; width: 35%; color: #333; background: #f4f7f9; }
    .badge { display: inline-block; padding: 2px 8px; font-size: 11px; font-weight: bold; border-radius: 3px; background: #e0f2fe; color: #0369a1; }
  </style>
</head>
<body>
  <div class="datasheet-container">
    ${htmlLines.join('\n    ')}
  </div>
</body>
</html>`;
  }
}

module.exports = {
  EquipmentDatasheetGenerator
};
