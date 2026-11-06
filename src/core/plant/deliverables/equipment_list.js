'use strict';

/**
 * Master Plant Equipment List & Civil/Structural Foundation Load Schedule
 * (Multi-Discipline FEED Deliverable).
 *
 * Aggregates all tagged equipment items across Units 10, 20, 30, 35, 40, 50, 60, 70, 80, 90, 95:
 * - Equipment Tag, Description, Unit ID, Service Area
 * - Equipment Category & Mechanical Dimensions (L x W x H or OD x H mm)
 * - Weights: Dry Weight (kg), Operating Weight (kg), Hydrotest Weight (kg)
 * - Power: Absorbed Power (kW), Driver Rating (kW), Electrical Voltage
 * - Metallurgy (Shell/Casing, Impeller/Tubes/Internals)
 * - Civil/Structural Foundation Load Schedule:
 *   - Dead Load DL (kN), Live/Operating Load LL (kN), Test Load TL (kN)
 *   - Dynamic Machine Amplification Factor (ACI 351.3R)
 *   - Foundation Design Vertical Load (kN)
 *   - Footprint Area (m2), Concrete Foundation Volume (m3) and Mass (tonnes)
 *   - Calculated Soil Bearing Pressure (kPa) vs Allowable (200 kPa)
 *   - Anchor Bolt Schedule: Bolt Count, Diameter (M24 - M64), Embedment Length (mm)
 */

const { LngPlantEngine } = require('../lng/lng_plant_engine');

// Standard mechanical and civil engineering estimation parameters by equipment category
const EQUIPMENT_SPEC_CATALOG = {
  // --- Unit 10: Feed Reception & Slug Catcher ---
  'PR-1001': { category: 'Pig Receiver Trap', dims: { l: 8500, w: 2200, h: 2500 }, dryKg: 18500, operKg: 22000, hydroKg: 38000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A106 Gr B / A105', dynFactor: 1.0, bolts: { count: 8, dia: 'M30', embMm: 450 } },
  'M-1001': { category: 'Metering Skid', dims: { l: 12000, w: 4500, h: 3200 }, dryKg: 24000, operKg: 26500, hydroKg: 42000, pwrAbsKw: 5, pwrDrvKw: 10, volt: '400 V', mat: 'ASTM A106 Gr B (NACE)', dynFactor: 1.0, bolts: { count: 12, dia: 'M24', embMm: 350 } },
  'SC-1001': { category: 'Slug Catcher (Finger-Type)', dims: { l: 45000, w: 14000, h: 4200 }, dryKg: 285000, operKg: 420000, hydroKg: 650000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A106 Gr B / A516-70 (NACE)', dynFactor: 1.25, bolts: { count: 48, dia: 'M56', embMm: 900 } },
  'V-1001': { category: 'Vertical Separator', dims: { od: 2800, h: 7500 }, dryKg: 48000, operKg: 78000, hydroKg: 94000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A516 Gr 70 HIC (NACE)', dynFactor: 1.0, bolts: { count: 16, dia: 'M42', embMm: 650 } },
  'V-1002': { category: 'Horizontal Vessel', dims: { od: 2200, l: 6500, h: 3200 }, dryKg: 26000, operKg: 42000, hydroKg: 52000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A516 Gr 70', dynFactor: 1.0, bolts: { count: 8, dia: 'M36', embMm: 550 } },
  'P-1001A': { category: 'Centrifugal Pump (API 610 OH2)', dims: { l: 2400, w: 1200, h: 1400 }, dryKg: 2400, operKg: 2600, hydroKg: 2600, pwrAbsKw: 10.2, pwrDrvKw: 15.0, volt: '400 V', mat: 'ASTM A216 WCB / 12% Cr', dynFactor: 2.5, bolts: { count: 6, dia: 'M24', embMm: 380 } },
  'P-1001B': { category: 'Centrifugal Pump (API 610 OH2)', dims: { l: 2400, w: 1200, h: 1400 }, dryKg: 2400, operKg: 2600, hydroKg: 2600, pwrAbsKw: 10.2, pwrDrvKw: 15.0, volt: '400 V', mat: 'ASTM A216 WCB / 12% Cr', dynFactor: 2.5, bolts: { count: 6, dia: 'M24', embMm: 380 } },
  'F-1001': { category: 'Filter Separator Skid', dims: { l: 6500, w: 2800, h: 3600 }, dryKg: 19500, operKg: 24000, hydroKg: 38000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A516 Gr 70', dynFactor: 1.0, bolts: { count: 8, dia: 'M30', embMm: 450 } },

  // --- Unit 20: Acid Gas Removal Unit (AGRU) ---
  'C-2001': { category: 'Absorber Column', dims: { od: 3600, h: 32000 }, dryKg: 195000, operKg: 345000, hydroKg: 520000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A516 Gr 70 (PWHT) / SS316L', dynFactor: 1.25, bolts: { count: 32, dia: 'M64', embMm: 1100 } },
  'V-2001': { category: 'Vertical Knockout Drum', dims: { od: 2400, h: 6200 }, dryKg: 22000, operKg: 32000, hydroKg: 49000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A516 Gr 70', dynFactor: 1.0, bolts: { count: 12, dia: 'M36', embMm: 550 } },
  'V-2002': { category: 'Horizontal Flash Drum', dims: { od: 3000, l: 9500, h: 4200 }, dryKg: 45000, operKg: 85000, hydroKg: 112000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A516 Gr 70 (PWHT)', dynFactor: 1.0, bolts: { count: 12, dia: 'M42', embMm: 650 } },
  'E-2001': { category: 'Heat Exchanger (TEMA AES)', dims: { od: 1600, l: 7200, h: 2600 }, dryKg: 38000, operKg: 54000, hydroKg: 62000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'A516-70 Shell / SS316L Tubes', dynFactor: 1.0, bolts: { count: 8, dia: 'M36', embMm: 550 } },
  'C-2002': { category: 'Stripper Column', dims: { od: 3200, h: 28000 }, dryKg: 145000, operKg: 265000, hydroKg: 375000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A516 Gr 70 / SS316L', dynFactor: 1.25, bolts: { count: 28, dia: 'M56', embMm: 950 } },
  'E-2002': { category: 'Kettle Reboiler (TEMA BKU)', dims: { od: 2200, l: 8000, h: 3500 }, dryKg: 42000, operKg: 68000, hydroKg: 78000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'A516-70 Shell / SS316L Tubes', dynFactor: 1.0, bolts: { count: 8, dia: 'M42', embMm: 650 } },
  'V-2003': { category: 'Reflux Drum', dims: { od: 2000, l: 5500, h: 3000 }, dryKg: 16500, operKg: 28000, hydroKg: 34000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A516 Gr 70 (PWHT)', dynFactor: 1.0, bolts: { count: 8, dia: 'M30', embMm: 450 } },
  'P-2001A': { category: 'Booster Pump (API 610 BB2)', dims: { l: 3200, w: 1600, h: 1800 }, dryKg: 6800, operKg: 7200, hydroKg: 7200, pwrAbsKw: 380, pwrDrvKw: 450, volt: '6.6 kV', mat: 'ASTM A216 WCB / SS316', dynFactor: 2.5, bolts: { count: 8, dia: 'M30', embMm: 480 } },
  'P-2001B': { category: 'Booster Pump (API 610 BB2)', dims: { l: 3200, w: 1600, h: 1800 }, dryKg: 6800, operKg: 7200, hydroKg: 7200, pwrAbsKw: 380, pwrDrvKw: 450, volt: '6.6 kV', mat: 'ASTM A216 WCB / SS316', dynFactor: 2.5, bolts: { count: 8, dia: 'M30', embMm: 480 } },

  // --- Unit 30: Sulfur Recovery Unit (Claus SRU) ---
  'F-3001': { category: 'Reaction Furnace & Waste Heat Boiler', dims: { od: 3800, l: 14000, h: 5200 }, dryKg: 185000, operKg: 245000, hydroKg: 320000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'CS with Refractory / P11 Boiler', dynFactor: 1.1, bolts: { count: 24, dia: 'M48', embMm: 800 } },
  'E-3001': { category: 'Condenser 1 (TEMA BEM)', dims: { od: 1800, l: 6500, h: 2800 }, dryKg: 32000, operKg: 46000, hydroKg: 52000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'A516-70 Shell & Tubes', dynFactor: 1.0, bolts: { count: 8, dia: 'M36', embMm: 550 } },
  'R-3001': { category: 'Catalytic Converter 1', dims: { od: 3400, l: 8200, h: 4200 }, dryKg: 42000, operKg: 72000, hydroKg: 95000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A516 Gr 70 / Titania Cat', dynFactor: 1.0, bolts: { count: 12, dia: 'M42', embMm: 650 } },
  'E-3002': { category: 'Condenser 2 (TEMA BEM)', dims: { od: 1600, l: 6500, h: 2600 }, dryKg: 28000, operKg: 39000, hydroKg: 45000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'A516-70 Shell & Tubes', dynFactor: 1.0, bolts: { count: 8, dia: 'M36', embMm: 550 } },
  'R-3002': { category: 'Catalytic Converter 2', dims: { od: 3400, l: 8200, h: 4200 }, dryKg: 42000, operKg: 72000, hydroKg: 95000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A516 Gr 70 / Alumina Cat', dynFactor: 1.0, bolts: { count: 12, dia: 'M42', embMm: 650 } },
  'E-3003': { category: 'Condenser 3 (TEMA BEM)', dims: { od: 1400, l: 6000, h: 2400 }, dryKg: 24000, operKg: 34000, hydroKg: 39000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'A516-70 Shell & Tubes', dynFactor: 1.0, bolts: { count: 8, dia: 'M30', embMm: 450 } },
  'TK-3001': { category: 'Liquid Sulfur Storage Pit / Tank', dims: { l: 14000, w: 8000, h: 4500 }, dryKg: 85000, operKg: 420000, hydroKg: 500000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'Concrete Pit with Steam Coils', dynFactor: 1.0, bolts: { count: 16, dia: 'M36', embMm: 600 } },
  'P-3001A': { category: 'Sulfur Submerged Pump (API 610 VS4)', dims: { l: 1800, w: 1200, h: 4500 }, dryKg: 3800, operKg: 4100, hydroKg: 4100, pwrAbsKw: 25, pwrDrvKw: 37, volt: '400 V', mat: 'ASTM A216 WCB Steam-Jacketed', dynFactor: 2.5, bolts: { count: 6, dia: 'M24', embMm: 380 } },

  // --- Unit 35: SCOT TGTU & Incineration ---
  'R-3501': { category: 'Hydrogenation Reactor', dims: { od: 2600, h: 7500 }, dryKg: 34000, operKg: 52000, hydroKg: 68000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A387 Gr 11 Cl 2 / CoMo Cat', dynFactor: 1.0, bolts: { count: 12, dia: 'M36', embMm: 550 } },
  'C-3501': { category: 'Quench Tower', dims: { od: 2400, h: 16000 }, dryKg: 42000, operKg: 78000, hydroKg: 115000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A516 Gr 70 / SS316 Trays', dynFactor: 1.25, bolts: { count: 16, dia: 'M42', embMm: 650 } },
  'P-3501A': { category: 'Quench Water Pump (API 610 OH2)', dims: { l: 2200, w: 1100, h: 1300 }, dryKg: 1800, operKg: 2000, hydroKg: 2000, pwrAbsKw: 18, pwrDrvKw: 22, volt: '400 V', mat: 'ASTM A351 CF8M (SS316)', dynFactor: 2.5, bolts: { count: 6, dia: 'M24', embMm: 380 } },
  'C-3502': { category: 'TGTU Absorber Column', dims: { od: 2800, h: 24000 }, dryKg: 88000, operKg: 165000, hydroKg: 235000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A516 Gr 70 / SS316L Packing', dynFactor: 1.25, bolts: { count: 24, dia: 'M48', embMm: 800 } },
  'F-3501': { category: 'Thermal Incinerator & Stack', dims: { od: 3200, h: 45000 }, dryKg: 95000, operKg: 110000, hydroKg: 110000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'CS Shell with Refractory Lining', dynFactor: 1.3, bolts: { count: 24, dia: 'M56', embMm: 950 } },

  // --- Unit 40: Gas Dehydration & Mercury Removal ---
  'V-4001A': { category: 'Mercury Guard Bed (A)', dims: { od: 2600, h: 8000 }, dryKg: 38000, operKg: 72000, hydroKg: 82000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'A516-70 / CuS Impregnated Carbon', dynFactor: 1.0, bolts: { count: 12, dia: 'M42', embMm: 650 } },
  'V-4001B': { category: 'Mercury Guard Bed (B)', dims: { od: 2600, h: 8000 }, dryKg: 38000, operKg: 72000, hydroKg: 82000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'A516-70 / CuS Impregnated Carbon', dynFactor: 1.0, bolts: { count: 12, dia: 'M42', embMm: 650 } },
  'V-4002A': { category: 'Molecular Sieve Dehydrator (A)', dims: { od: 3200, h: 11500 }, dryKg: 74000, operKg: 148000, hydroKg: 168000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'A516-70 (PWHT) / Zeolite 4A', dynFactor: 1.0, bolts: { count: 16, dia: 'M48', embMm: 750 } },
  'V-4002B': { category: 'Molecular Sieve Dehydrator (B)', dims: { od: 3200, h: 11500 }, dryKg: 74000, operKg: 148000, hydroKg: 168000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'A516-70 (PWHT) / Zeolite 4A', dynFactor: 1.0, bolts: { count: 16, dia: 'M48', embMm: 750 } },
  'F-4001A': { category: 'Dust Filter Separator', dims: { od: 1600, h: 4800 }, dryKg: 14000, operKg: 16500, hydroKg: 24000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A516 Gr 70 / SS Elements', dynFactor: 1.0, bolts: { count: 8, dia: 'M30', embMm: 450 } },
  'H-4001': { category: 'Regeneration Gas Fired Heater (API 560)', dims: { l: 8500, w: 5500, h: 18000 }, dryKg: 65000, operKg: 72000, hydroKg: 85000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'P11/P22 Radiant Coils / Refractory', dynFactor: 1.1, bolts: { count: 16, dia: 'M42', embMm: 650 } },

  // --- Unit 50: NGL Fractionation ---
  'C-5001': { category: 'Scrub Column', dims: { od: 3000, h: 26000 }, dryKg: 110000, operKg: 195000, hydroKg: 295000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A333 Gr 6 / SS316 Trays', dynFactor: 1.25, bolts: { count: 24, dia: 'M56', embMm: 950 } },
  'C-5002': { category: 'Deethanizer Column', dims: { od: 2400, h: 30000 }, dryKg: 95000, operKg: 175000, hydroKg: 235000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A516 Gr 70 / SS316 Trays', dynFactor: 1.25, bolts: { count: 24, dia: 'M48', embMm: 800 } },
  'C-5003': { category: 'Depropanizer Column', dims: { od: 2200, h: 34000 }, dryKg: 85000, operKg: 160000, hydroKg: 215000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A516 Gr 70 / SS316 Trays', dynFactor: 1.25, bolts: { count: 24, dia: 'M48', embMm: 800 } },
  'C-5004': { category: 'Debutanizer Column', dims: { od: 1800, h: 28000 }, dryKg: 65000, operKg: 125000, hydroKg: 165000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A516 Gr 70 / SS316 Trays', dynFactor: 1.25, bolts: { count: 20, dia: 'M42', embMm: 700 } },

  // --- Unit 60: C3MR Liquefaction & Refrigeration ---
  'E-6001': { category: 'Main Cryogenic Heat Exchanger (MCHE)', dims: { od: 4500, h: 52000 }, dryKg: 260000, operKg: 340000, hydroKg: 580000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'Cryogenic Aluminum 3003 / 5083', dynFactor: 1.25, bolts: { count: 36, dia: 'M64', embMm: 1200 } },
  'E-6002': { category: 'High-Level Propane Chiller', dims: { od: 2600, l: 8500, h: 3800 }, dryKg: 52000, operKg: 82000, hydroKg: 98000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A333 Gr 8 / SS316L', dynFactor: 1.0, bolts: { count: 12, dia: 'M42', embMm: 650 } },
  'E-6003': { category: 'Low-Level Propane Chiller', dims: { od: 2400, l: 8500, h: 3600 }, dryKg: 46000, operKg: 74000, hydroKg: 88000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A333 Gr 8 / SS316L', dynFactor: 1.0, bolts: { count: 12, dia: 'M42', embMm: 650 } },
  'K-6001': { category: 'C3 Refrigerant Compressor (API 617)', dims: { l: 14000, w: 6500, h: 4800 }, dryKg: 78000, operKg: 82000, hydroKg: 82000, pwrAbsKw: 12800, pwrDrvKw: 15000, volt: 'GT Driver', mat: 'ASTM A352 LCC / 17-4PH', dynFactor: 3.0, bolts: { count: 24, dia: 'M48', embMm: 800 } },
  'E-6005': { category: 'MR Desuperheater (TEMA AES)', dims: { od: 2000, l: 7500, h: 3200 }, dryKg: 38000, operKg: 58000, hydroKg: 68000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A516 Gr 70 / Titanium', dynFactor: 1.0, bolts: { count: 8, dia: 'M36', embMm: 550 } },
  'K-6002': { category: 'MR Compressor Train (API 617)', dims: { l: 22000, w: 8500, h: 5500 }, dryKg: 165000, operKg: 172000, hydroKg: 172000, pwrAbsKw: 48500, pwrDrvKw: 85000, volt: 'GT Frame 7EA', mat: 'ASTM A352 LCC / Ti Gr 5', dynFactor: 3.0, bolts: { count: 36, dia: 'M64', embMm: 1200 } },
  'V-6001': { category: 'End-Flash Drum', dims: { od: 2800, h: 8500 }, dryKg: 42000, operKg: 76000, hydroKg: 95000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A240 TP316L Cryogenic SS', dynFactor: 1.0, bolts: { count: 16, dia: 'M42', embMm: 650 } },

  // --- Unit 70: LNG Storage & BOG ---
  'TK-7001A': { category: 'Full Containment LNG Tank A (160,000 m3)', dims: { od: 80000, h: 38000 }, dryKg: 14500000, operKg: 86500000, hydroKg: 174500000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: '9% Ni Steel Inner / Concrete Outer', dynFactor: 1.15, bolts: { count: 120, dia: 'M64', embMm: 1500 } },
  'TK-7001B': { category: 'Full Containment LNG Tank B (160,000 m3)', dims: { od: 80000, h: 38000 }, dryKg: 14500000, operKg: 86500000, hydroKg: 174500000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: '9% Ni Steel Inner / Concrete Outer', dynFactor: 1.15, bolts: { count: 120, dia: 'M64', embMm: 1500 } },
  'P-7001A': { category: 'In-Tank Cryo Pump A (API 610 VS6)', dims: { l: 2000, w: 1500, h: 8500 }, dryKg: 8500, operKg: 9200, hydroKg: 9200, pwrAbsKw: 680, pwrDrvKw: 800, volt: '6.6 kV', mat: 'SS316 / Al 356-T6', dynFactor: 2.5, bolts: { count: 8, dia: 'M30', embMm: 450 } },
  'P-7001B': { category: 'In-Tank Cryo Pump B (API 610 VS6)', dims: { l: 2000, w: 1500, h: 8500 }, dryKg: 8500, operKg: 9200, hydroKg: 9200, pwrAbsKw: 680, pwrDrvKw: 800, volt: '6.6 kV', mat: 'SS316 / Al 356-T6', dynFactor: 2.5, bolts: { count: 8, dia: 'M30', embMm: 450 } },
  'K-7001A': { category: 'BOG Compressor (API 617)', dims: { l: 9500, w: 4200, h: 3600 }, dryKg: 32000, operKg: 34000, hydroKg: 34000, pwrAbsKw: 2700, pwrDrvKw: 3000, volt: '6.6 kV', mat: 'ASTM A351 CF8M / 17-4PH', dynFactor: 3.0, bolts: { count: 16, dia: 'M42', embMm: 700 } },
  'V-7001': { category: 'BOG Suction Drum', dims: { od: 2400, h: 6500 }, dryKg: 24000, operKg: 36000, hydroKg: 52000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A312 TP304L Cryo SS', dynFactor: 1.0, bolts: { count: 12, dia: 'M36', embMm: 550 } },

  // --- Unit 80: Regasification & Sendout ---
  'P-8001A': { category: 'HP Sendout Pump A (API 610 VS6)', dims: { l: 2800, w: 1800, h: 7500 }, dryKg: 12500, operKg: 13500, hydroKg: 13500, pwrAbsKw: 1450, pwrDrvKw: 1800, volt: '6.6 kV', mat: 'SS316L Cryogenic High-Pressure', dynFactor: 2.5, bolts: { count: 12, dia: 'M36', embMm: 550 } },
  'P-8001B': { category: 'HP Sendout Pump B (API 610 VS6)', dims: { l: 2800, w: 1800, h: 7500 }, dryKg: 12500, operKg: 13500, hydroKg: 13500, pwrAbsKw: 1450, pwrDrvKw: 1800, volt: '6.6 kV', mat: 'SS316L Cryogenic High-Pressure', dynFactor: 2.5, bolts: { count: 12, dia: 'M36', embMm: 550 } },
  'E-8001A': { category: 'Open Rack Vaporizer (ORV)', dims: { l: 16000, w: 5500, h: 9000 }, dryKg: 110000, operKg: 165000, hydroKg: 220000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'Extruded Aluminum Alloy A3003', dynFactor: 1.1, bolts: { count: 24, dia: 'M48', embMm: 800 } },
  'E-8001B': { category: 'Open Rack Vaporizer (ORV)', dims: { l: 16000, w: 5500, h: 9000 }, dryKg: 110000, operKg: 165000, hydroKg: 220000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'Extruded Aluminum Alloy A3003', dynFactor: 1.1, bolts: { count: 24, dia: 'M48', embMm: 800 } },
  'E-8002': { category: 'Submerged Combustion Vaporizer (SCV)', dims: { l: 12000, w: 6000, h: 5500 }, dryKg: 85000, operKg: 185000, hydroKg: 245000, pwrAbsKw: 75, pwrDrvKw: 90, volt: '400 V', mat: 'SS316L Coils / Concrete Water Bath', dynFactor: 1.2, bolts: { count: 20, dia: 'M42', embMm: 700 } },
  'M-8001': { category: 'Fiscal Custody Sendout Meter Skid', dims: { l: 14000, w: 5000, h: 3500 }, dryKg: 32000, operKg: 36000, hydroKg: 58000, pwrAbsKw: 5, pwrDrvKw: 10, volt: '400 V', mat: 'ASTM A333 Gr 6 / Ultrasonic AGA-9', dynFactor: 1.0, bolts: { count: 16, dia: 'M30', embMm: 450 } },

  // --- Unit 90: Combined Cycle Power & Steam ---
  'GT-9001A': { category: 'Gas Turbine Generator A (ISO 125 MW)', dims: { l: 24000, w: 8500, h: 7200 }, dryKg: 285000, operKg: 295000, hydroKg: 295000, pwrAbsKw: 0, pwrDrvKw: 125000, volt: '11 kV Generator', mat: 'High-Temperature Nickel Superalloys', dynFactor: 2.5, bolts: { count: 48, dia: 'M64', embMm: 1400 } },
  'GT-9001B': { category: 'Gas Turbine Generator B (ISO 125 MW)', dims: { l: 24000, w: 8500, h: 7200 }, dryKg: 285000, operKg: 295000, hydroKg: 295000, pwrAbsKw: 0, pwrDrvKw: 125000, volt: '11 kV Generator', mat: 'High-Temperature Nickel Superalloys', dynFactor: 2.5, bolts: { count: 48, dia: 'M64', embMm: 1400 } },
  'HRSG-9001A': { category: 'Heat Recovery Steam Generator A', dims: { l: 32000, w: 12000, h: 28000 }, dryKg: 650000, operKg: 950000, hydroKg: 1350000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'P11/P22/P91 Alloy Steel Boiler Tubes', dynFactor: 1.1, bolts: { count: 64, dia: 'M64', embMm: 1500 } },
  'HRSG-9001B': { category: 'Heat Recovery Steam Generator B', dims: { l: 32000, w: 12000, h: 28000 }, dryKg: 650000, operKg: 950000, hydroKg: 1350000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'P11/P22/P91 Alloy Steel Boiler Tubes', dynFactor: 1.1, bolts: { count: 64, dia: 'M64', embMm: 1500 } },
  'ST-9001': { category: 'Steam Turbine Generator (70 MW)', dims: { l: 18000, w: 7500, h: 6200 }, dryKg: 195000, operKg: 205000, hydroKg: 205000, pwrAbsKw: 0, pwrDrvKw: 70000, volt: '11 kV Generator', mat: 'Cr-Mo-V High-Pressure Rotor', dynFactor: 2.5, bolts: { count: 36, dia: 'M56', embMm: 1200 } },
  'P-9001A': { category: 'Boiler Feedwater Pump (API 610 BB3)', dims: { l: 3800, w: 1600, h: 1800 }, dryKg: 7800, operKg: 8400, hydroKg: 8400, pwrAbsKw: 950, pwrDrvKw: 1100, volt: '6.6 kV', mat: 'ASTM A487 Gr CA6NM (13Cr-4Ni)', dynFactor: 2.5, bolts: { count: 8, dia: 'M36', embMm: 550 } },

  // --- Unit 95: Plant Utilities & Flare Network ---
  'P-9501A': { category: 'Seawater Cooling Pump A (API 610 VS1)', dims: { l: 2600, w: 2200, h: 9500 }, dryKg: 16500, operKg: 19500, hydroKg: 19500, pwrAbsKw: 1850, pwrDrvKw: 2200, volt: '6.6 kV', mat: 'Super Duplex SS (UNS S32750)', dynFactor: 2.5, bolts: { count: 12, dia: 'M42', embMm: 650 } },
  'P-9501B': { category: 'Seawater Cooling Pump B (API 610 VS1)', dims: { l: 2600, w: 2200, h: 9500 }, dryKg: 16500, operKg: 19500, hydroKg: 19500, pwrAbsKw: 1850, pwrDrvKw: 2200, volt: '6.6 kV', mat: 'Super Duplex SS (UNS S32750)', dynFactor: 2.5, bolts: { count: 12, dia: 'M42', embMm: 650 } },
  'PKG-9501': { category: 'Instrument Air & Nitrogen PSA Skid', dims: { l: 16000, w: 7500, h: 4200 }, dryKg: 48000, operKg: 52000, hydroKg: 68000, pwrAbsKw: 450, pwrDrvKw: 550, volt: '6.6 kV / 400 V', mat: 'CS Piping / Desiccant Towers', dynFactor: 1.5, bolts: { count: 16, dia: 'M30', embMm: 450 } },
  'V-9501': { category: 'Cold Flare Knockout Drum (Cryogenic)', dims: { od: 3800, l: 12500, h: 5500 }, dryKg: 68000, operKg: 135000, hydroKg: 185000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A240 TP304L Cryogenic SS', dynFactor: 1.0, bolts: { count: 16, dia: 'M48', embMm: 750 } },
  'FL-9501': { category: 'Cold Dry Flare Stack (API 521 Derricked)', dims: { od: 2200, h: 120000 }, dryKg: 185000, operKg: 195000, hydroKg: 195000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'SS304L Upper Riser / Structural Guyed', dynFactor: 1.5, bolts: { count: 32, dia: 'M64', embMm: 1500 } },
  'FL-9502': { category: 'Warm Wet Flare Stack (API 521 Derricked)', dims: { od: 2600, h: 120000 }, dryKg: 210000, operKg: 225000, hydroKg: 225000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'CS Lower / SS316 Tip with Pilots', dynFactor: 1.5, bolts: { count: 32, dia: 'M64', embMm: 1500 } }
};

class MasterEquipmentListGenerator {
  /**
   * @param {object} [engineInstance]
   */
  constructor(engineInstance) {
    this.engine = engineInstance || new LngPlantEngine();
  }

  /**
   * Generates master plant equipment list aggregating all tagged equipment across all 11 units.
   * @param {object} [options]
   * @returns {Array<object>} Equipment items with weights, power, dimensions, and civil foundation sizing.
   */
  generateMasterEquipmentList(options = {}) {
    const rawPids = this.engine.generateAllPidSheets();
    const rows = [];
    const seenTags = new Set();

    for (const sheet of rawPids) {
      const unitId = sheet.unit;
      const unitName = sheet.title || sheet.area;

      const unitConfigFn = this.engine[`_buildUnit${unitId.replace('U-', '')}Config`];
      if (!unitConfigFn) continue;

      const unitConfig = unitConfigFn.call(this.engine);
      const areas = unitConfig.areas || [];

      for (const area of areas) {
        const areaName = area.name || 'General Process';
        const equipmentList = area.equipment || [];

        for (const eq of equipmentList) {
          const tag = eq.tag;
          if (eq.isBoundary || tag.startsWith('BL-')) {
            // Battery limits are boundary interfaces, not civil foundations
            continue;
          }
          if (seenTags.has(tag)) continue;
          seenTags.add(tag);

          const catalogSpec = EQUIPMENT_SPEC_CATALOG[tag] || this._estimateDefaultSpec(tag, eq);
          const civilCalc = this.calculateFoundationLoadsAndSizing(catalogSpec);

          const row = {
            tag,
            description: eq.description || catalogSpec.category,
            category: catalogSpec.category,
            unitId,
            unitName,
            serviceArea: areaName,
            dimensions: catalogSpec.dims,
            dimensionsFormatted: this._formatDims(catalogSpec.dims),
            dryWeightKg: catalogSpec.dryKg,
            operatingWeightKg: catalogSpec.operKg,
            hydrotestWeightKg: catalogSpec.hydroKg,
            absorbedPowerKW: catalogSpec.pwrAbsKw,
            driverPowerKW: catalogSpec.pwrDrvKw,
            operatingVoltage: catalogSpec.volt,
            metallurgy: catalogSpec.mat,
            civilFoundation: civilCalc
          };

          if (!options.unitId || options.unitId === unitId) {
            rows.push(row);
          }
        }
      }
    }

    return rows;
  }

  /**
   * Calculates civil foundation loads, dynamic factors, concrete volume, and anchor bolt sizing.
   *
   * Formulations:
   *   Dead Load DL = W_dry * g / 1000 (kN)
   *   Operating Live Load LL = (W_oper - W_dry) * g / 1000 (kN)
   *   Hydrotest Load TL = W_hydro * g / 1000 (kN)
   *   Dynamic Factor mu_dyn per ACI 351.3R (Foundations for Dynamic Equipment)
   *   Design Vertical Load F_des = max( (DL + LL) * mu_dyn, TL ) (kN)
   *   Required Foundation Mass M_found >= 3.0 * M_machine for rotating equipment (ACI 351.3R)
   *   Concrete Volume V_conc = M_found / rho_concrete (rho = 2400 kg/m3)
   *   Soil Bearing Pressure q = (F_des + V_conc * 24 kN/m3) / A_footprint (kPa)
   *
   * @param {object} spec Equipment catalog specification.
   * @returns {object} Civil load and sizing schedule.
   */
  calculateFoundationLoadsAndSizing(spec) {
    const g = 9.80665;
    const deadLoadKN = Number(((spec.dryKg * g) / 1000.0).toFixed(1));
    const liveLoadKN = Number((((spec.operKg - spec.dryKg) * g) / 1000.0).toFixed(1));
    const operLoadKN = Number((deadLoadKN + liveLoadKN).toFixed(1));
    const testLoadKN = Number(((spec.hydroKg * g) / 1000.0).toFixed(1));

    const muDyn = spec.dynFactor || 1.0;
    const isRotating = muDyn >= 2.0;

    // Design vertical foundation load
    const designLoadKN = Number(Math.max(operLoadKN * muDyn, testLoadKN).toFixed(1));

    // Footprint estimation
    let lengthM = 3.0;
    let widthM = 2.5;
    if (spec.dims) {
      if (spec.dims.l && spec.dims.w) {
        lengthM = Number((spec.dims.l / 1000.0 + 1.0).toFixed(1));
        widthM = Number((spec.dims.w / 1000.0 + 1.0).toFixed(1));
      } else if (spec.dims.od && spec.dims.l) {
        // Horizontal vessels, reboilers, shell & tube exchangers, reaction furnaces
        lengthM = Number((spec.dims.l / 1000.0 + 1.0).toFixed(1));
        widthM = Number((spec.dims.od / 1000.0 + 1.0).toFixed(1));
      } else if (spec.dims.od) {
        const diaM = spec.dims.od / 1000.0;
        const hM = spec.dims.h ? spec.dims.h / 1000.0 : diaM * 3.0;
        // For tall slender vertical columns / stacks (H/D > 2.5 and H > 12m), mat footing extends to resist wind/seismic overturning
        const isSlender = (hM / Math.max(diaM, 0.5) > 2.5) && hM > 12.0;
        const matSideM = isSlender ? Math.max(diaM * 2.2, hM * 0.25) : diaM + 2.0;
        lengthM = Number(matSideM.toFixed(1));
        widthM = Number(matSideM.toFixed(1));
      }
    }
    let footprintAreaM2 = Number((lengthM * widthM).toFixed(1));

    // Minimum concrete foundation mass per ACI 351.3R
    // For rotating: M_found >= 3.0 * M_machine; For static vessels: thickness typically 0.8 - 1.2m
    let concreteMassKg = 0;
    if (isRotating) {
      concreteMassKg = spec.dryKg * Math.max(muDyn, 3.0);
    } else if (spec.operKg > 10000000) {
      // Very large storage tank (e.g. 160,000 m3 LNG Tank with diameter ~80m)
      const tankDiaM = (spec.dims && spec.dims.od ? spec.dims.od : 80000) / 1000.0;
      const slabVolumeM3 = Math.PI * Math.pow(tankDiaM / 2.0 + 1.0, 2) * 1.2;
      concreteMassKg = slabVolumeM3 * 2400.0;
    } else {
      // Static equipment: concrete foundation mass typically 1.2 - 1.5x operating mass
      concreteMassKg = spec.operKg * 1.2;
    }

    const concreteDensityKgM3 = 2400.0;
    const concreteVolumeM3 = Number((concreteMassKg / concreteDensityKgM3).toFixed(1));
    const foundationMassTonnes = Number((concreteMassKg / 1000.0).toFixed(1));

    // Soil bearing pressure check (Allowable: 200 kPa for dense soil / rock FEED basis)
    const allowableSoilBearingKPa = 200.0;
    const foundationWeightKN = Number((concreteVolumeM3 * 24.0).toFixed(1));
    let totalVerticalLoadKN = Number((designLoadKN + foundationWeightKN).toFixed(1));
    let calculatedBearingKPa = Number((totalVerticalLoadKN / Math.max(footprintAreaM2, 1.0)).toFixed(1));

    // If initial footprint produces bearing pressure exceeding allowable, size footing mat accordingly
    if (calculatedBearingKPa > 180.0) {
      const requiredAreaM2 = Number((totalVerticalLoadKN / 165.0).toFixed(1));
      const newSideM = Number(Math.sqrt(requiredAreaM2).toFixed(1));
      lengthM = Math.max(lengthM, newSideM);
      widthM = Math.max(widthM, newSideM);
      footprintAreaM2 = Number((lengthM * widthM).toFixed(1));
      calculatedBearingKPa = Number((totalVerticalLoadKN / Math.max(footprintAreaM2, 1.0)).toFixed(1));
    }

    const soilCheckPass = calculatedBearingKPa <= allowableSoilBearingKPa;

    // Anchor bolt specification
    const boltCount = spec.bolts ? spec.bolts.count : 8;
    const boltDia = spec.bolts ? spec.bolts.dia : 'M30';
    const embedmentLengthMm = spec.bolts ? spec.bolts.embMm : 500;
    const boltMaterial = 'ASTM A193 Gr B7 / ASTM F1554 Gr 55';

    return {
      deadLoadKN,
      liveLoadKN,
      operLoadKN,
      testLoadKN,
      dynamicFactor: muDyn,
      designVerticalLoadKN: designLoadKN,
      footprintAreaM2,
      lengthM,
      widthM,
      concreteVolumeM3,
      foundationMassTonnes,
      calculatedSoilBearingKPa: calculatedBearingKPa,
      allowableSoilBearingKPa,
      soilCheckPass,
      anchorBolts: {
        count: boltCount,
        diameter: boltDia,
        material: boltMaterial,
        embedmentLengthMm,
        groutThicknessMm: 50
      }
    };
  }

  /**
   * Generates comprehensive civil and structural foundation load schedule.
   * @param {object} [options]
   * @returns {Array<object>} Civil schedule list.
   */
  generateFoundationLoadSchedule(options = {}) {
    const eqList = this.generateMasterEquipmentList(options);
    return eqList.map((eq) => ({
      tag: eq.tag,
      description: eq.description,
      unitId: eq.unitId,
      category: eq.category,
      operWeightTonnes: Number((eq.operatingWeightKg / 1000.0).toFixed(1)),
      hydroWeightTonnes: Number((eq.hydrotestWeightKg / 1000.0).toFixed(1)),
      deadLoadKN: eq.civilFoundation.deadLoadKN,
      operatingLoadKN: eq.civilFoundation.operLoadKN,
      designVerticalLoadKN: eq.civilFoundation.designVerticalLoadKN,
      dynamicFactor: eq.civilFoundation.dynamicFactor,
      concreteVolumeM3: eq.civilFoundation.concreteVolumeM3,
      foundationMassTonnes: eq.civilFoundation.foundationMassTonnes,
      soilBearingKPa: eq.civilFoundation.calculatedSoilBearingKPa,
      anchorBolts: `${eq.civilFoundation.anchorBolts.count} x ${eq.civilFoundation.anchorBolts.diameter} (${eq.civilFoundation.anchorBolts.embedmentLengthMm} mm emb)`
    }));
  }

  /**
   * Compiles executive metrics for the whole plant complex.
   * @returns {object} Totals.
   */
  getPlantSummary() {
    const list = this.generateMasterEquipmentList();
    let totalDryKg = 0;
    let totalOperKg = 0;
    let totalHydroKg = 0;
    let totalAbsorbedKw = 0;
    let totalDriverKw = 0;
    let totalConcreteM3 = 0;
    const categoryCounts = {};

    for (const item of list) {
      totalDryKg += item.dryWeightKg;
      totalOperKg += item.operatingWeightKg;
      totalHydroKg += item.hydrotestWeightKg;
      totalAbsorbedKw += item.absorbedPowerKW || 0;
      totalDriverKw += item.driverPowerKW || 0;
      totalConcreteM3 += item.civilFoundation.concreteVolumeM3;
      categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
    }

    return {
      totalEquipmentCount: list.length,
      totalDryWeightTonnes: Number((totalDryKg / 1000.0).toFixed(1)),
      totalOperatingWeightTonnes: Number((totalOperKg / 1000.0).toFixed(1)),
      totalHydrotestWeightTonnes: Number((totalHydroKg / 1000.0).toFixed(1)),
      totalAbsorbedPowerMW: Number((totalAbsorbedKw / 1000.0).toFixed(2)),
      totalDriverPowerMW: Number((totalDriverKw / 1000.0).toFixed(2)),
      totalConcreteVolumeM3: Number(totalConcreteM3.toFixed(1)),
      totalFoundationMassTonnes: Number((totalConcreteM3 * 2.4).toFixed(1)),
      equipmentByCategory: categoryCounts
    };
  }

  /**
   * Exports equipment list to clean Markdown format.
   * @param {object} [options]
   * @returns {string} Markdown table.
   */
  toMarkdown(options = {}) {
    const list = this.generateMasterEquipmentList(options);
    const summary = this.getPlantSummary();

    let md = `# Master Plant Equipment List & Civil Load Schedule (FEED Deliverable)\n\n`;
    md += `**Project**: 5.0 MTPA World-Scale LNG Plant Complex | **Doc No**: LNG-00-ME-LST-001 Rev 0\n`;
    md += `**Total Tagged Units**: ${summary.totalEquipmentCount} | **Total Operating Mass**: ${summary.totalOperatingWeightTonnes.toLocaleString()} Tonnes\n`;
    md += `**Total Installed Driver Power**: ${summary.totalDriverPowerMW} MW | **Total Civil Foundation Concrete**: ${summary.totalConcreteVolumeM3.toLocaleString()} m³\n\n`;

    md += `| Tag | Unit | Description | Category | Dims (mm) | Dry Wt (t) | Oper Wt (t) | Power (kW) | Metallurgy | Design Fz (kN) | Concrete (m³) | Anchor Bolts |\n`;
    md += `|---|---|---|---|---|---|---|---|---|---|---|---|\n`;

    for (const eq of list) {
      const dryT = (eq.dryWeightKg / 1000.0).toFixed(1);
      const operT = (eq.operatingWeightKg / 1000.0).toFixed(1);
      const pwr = eq.driverPowerKW > 0 ? `${eq.driverPowerKW} kW` : '-';
      const bolts = `${eq.civilFoundation.anchorBolts.count} x ${eq.civilFoundation.anchorBolts.diameter}`;
      md += `| **${eq.tag}** | ${eq.unitId} | ${eq.description} | ${eq.category} | ${eq.dimensionsFormatted} | ${dryT} | **${operT}** | ${pwr} | ${eq.metallurgy} | ${eq.civilFoundation.designVerticalLoadKN} | ${eq.civilFoundation.concreteVolumeM3} | ${bolts} |\n`;
    }

    return md;
  }

  /**
   * Exports equipment list to CSV format.
   * @param {object} [options]
   * @returns {string} CSV content.
   */
  toCsv(options = {}) {
    const list = this.generateMasterEquipmentList(options);
    const headers = [
      'Equipment Tag',
      'Unit ID',
      'Unit Name',
      'Service Area',
      'Description',
      'Category',
      'Dimensions Formatted',
      'Dry Weight (kg)',
      'Operating Weight (kg)',
      'Hydrotest Weight (kg)',
      'Absorbed Power (kW)',
      'Driver Power (kW)',
      'Voltage',
      'Metallurgy',
      'Dead Load (kN)',
      'Operating Load (kN)',
      'Hydrotest Load (kN)',
      'Dynamic Factor',
      'Design Vertical Load (kN)',
      'Foundation Area (m2)',
      'Concrete Volume (m3)',
      'Foundation Mass (t)',
      'Soil Bearing (kPa)',
      'Anchor Bolt Count',
      'Anchor Bolt Dia',
      'Anchor Bolt Embedment (mm)'
    ];

    const escapeCsv = (str) => {
      const s = String(str !== undefined && str !== null ? str : '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const csvLines = [headers.join(',')];
    for (const eq of list) {
      csvLines.push([
        escapeCsv(eq.tag),
        escapeCsv(eq.unitId),
        escapeCsv(eq.unitName),
        escapeCsv(eq.serviceArea),
        escapeCsv(eq.description),
        escapeCsv(eq.category),
        escapeCsv(eq.dimensionsFormatted),
        eq.dryWeightKg,
        eq.operatingWeightKg,
        eq.hydrotestWeightKg,
        eq.absorbedPowerKW,
        eq.driverPowerKW,
        escapeCsv(eq.operatingVoltage),
        escapeCsv(eq.metallurgy),
        eq.civilFoundation.deadLoadKN,
        eq.civilFoundation.operLoadKN,
        eq.civilFoundation.testLoadKN,
        eq.civilFoundation.dynamicFactor,
        eq.civilFoundation.designVerticalLoadKN,
        eq.civilFoundation.footprintAreaM2,
        eq.civilFoundation.concreteVolumeM3,
        eq.civilFoundation.foundationMassTonnes,
        eq.civilFoundation.calculatedSoilBearingKPa,
        eq.civilFoundation.anchorBolts.count,
        escapeCsv(eq.civilFoundation.anchorBolts.diameter),
        eq.civilFoundation.anchorBolts.embedmentLengthMm
      ].join(','));
    }

    return csvLines.join('\n');
  }

  /**
   * Helper to format dimensions object into string.
   * @private
   */
  _formatDims(dims) {
    if (!dims) return 'Standard Skid';
    if (dims.od && dims.h) return `OD ${dims.od} x H ${dims.h}`;
    if (dims.od && dims.l) return `OD ${dims.od} x L ${dims.l}`;
    if (dims.l && dims.w && dims.h) return `${dims.l} x ${dims.w} x ${dims.h}`;
    return 'Modular Skid';
  }

  /**
   * Fallback heuristic for equipment not explicitly in catalog.
   * @private
   */
  _estimateDefaultSpec(tag, eq) {
    const isPump = tag.startsWith('P-');
    const isComp = tag.startsWith('K-');
    const isVessel = tag.startsWith('V-') || tag.startsWith('C-');
    const isExch = tag.startsWith('E-');

    if (isPump) {
      return { category: 'Centrifugal Pump', dims: { l: 2200, w: 1200, h: 1400 }, dryKg: 2500, operKg: 2800, hydroKg: 2800, pwrAbsKw: 45, pwrDrvKw: 55, volt: '400 V', mat: 'ASTM A216 WCB / SS316', dynFactor: 2.5, bolts: { count: 6, dia: 'M24', embMm: 380 } };
    }
    if (isComp) {
      return { category: 'Process Compressor', dims: { l: 8000, w: 4000, h: 3500 }, dryKg: 35000, operKg: 38000, hydroKg: 38000, pwrAbsKw: 2500, pwrDrvKw: 3000, volt: '6.6 kV', mat: 'ASTM A352 LCC', dynFactor: 3.0, bolts: { count: 16, dia: 'M42', embMm: 700 } };
    }
    if (isVessel) {
      return { category: 'Process Vessel', dims: { od: 2000, h: 6000 }, dryKg: 20000, operKg: 35000, hydroKg: 45000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'ASTM A516 Gr 70', dynFactor: 1.0, bolts: { count: 8, dia: 'M30', embMm: 450 } };
    }
    if (isExch) {
      return { category: 'Heat Exchanger', dims: { od: 1400, l: 6000, h: 2200 }, dryKg: 18000, operKg: 26000, hydroKg: 32000, pwrAbsKw: 0, pwrDrvKw: 0, volt: 'N/A', mat: 'CS Shell / SS316 Tubes', dynFactor: 1.0, bolts: { count: 8, dia: 'M30', embMm: 450 } };
    }
    return { category: 'Process Package Skid', dims: { l: 6000, w: 3000, h: 3000 }, dryKg: 15000, operKg: 18000, hydroKg: 22000, pwrAbsKw: 15, pwrDrvKw: 20, volt: '400 V', mat: 'Carbon Steel', dynFactor: 1.0, bolts: { count: 8, dia: 'M24', embMm: 350 } };
  }
}

module.exports = {
  MasterEquipmentListGenerator,
  EQUIPMENT_SPEC_CATALOG
};
