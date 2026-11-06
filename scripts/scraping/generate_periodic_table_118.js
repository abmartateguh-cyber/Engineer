/**
 * generate_periodic_table_118.js
 * Generates the complete, IUPAC-aligned 118-element periodic table database.
 * Every element from Z=1 (Hydrogen) to Z=118 (Oganesson) with physical,
 * electronic, and thermodynamic properties.
 */

const fs = require('fs');
const path = require('path');

const rawElements = [
  // Period 1
  { z: 1, s: "H", n: "Hydrogen", mass: 1.008, g: 1, p: 1, b: "s", cat: "nonmetal", rho: 0.08988, mp: 14.01, bp: 20.28, cp: 14304, k: 0.1805, en: 2.20, ie: 13.598, ox: [1, -1] },
  { z: 2, s: "He", n: "Helium", mass: 4.0026, g: 18, p: 1, b: "s", cat: "noble gas", rho: 0.1785, mp: 0.95, bp: 4.22, cp: 5193, k: 0.1513, en: null, ie: 24.587, ox: [0] },

  // Period 2
  { z: 3, s: "Li", n: "Lithium", mass: 6.94, g: 1, p: 2, b: "s", cat: "alkali metal", rho: 534, mp: 453.69, bp: 1603, cp: 3582, k: 85, en: 0.98, ie: 5.392, ox: [1] },
  { z: 4, s: "Be", n: "Beryllium", mass: 9.0122, g: 2, p: 2, b: "s", cat: "alkaline earth", rho: 1850, mp: 1560, bp: 2742, cp: 1825, k: 190, en: 1.57, ie: 9.323, ox: [2] },
  { z: 5, s: "B", n: "Boron", mass: 10.81, g: 13, p: 2, b: "p", cat: "metalloid", rho: 2340, mp: 2349, bp: 4200, cp: 1026, k: 27, en: 2.04, ie: 8.298, ox: [3] },
  { z: 6, s: "C", n: "Carbon", mass: 12.011, g: 14, p: 2, b: "p", cat: "nonmetal", rho: 2267, mp: 3800, bp: 4300, cp: 709, k: 140, en: 2.55, ie: 11.260, ox: [4, 2, -4] },
  { z: 7, s: "N", n: "Nitrogen", mass: 14.007, g: 15, p: 2, b: "p", cat: "nonmetal", rho: 1.2506, mp: 63.15, bp: 77.36, cp: 1040, k: 0.0258, en: 3.04, ie: 14.534, ox: [5, 4, 3, 2, -3] },
  { z: 8, s: "O", n: "Oxygen", mass: 15.999, g: 16, p: 2, b: "p", cat: "nonmetal", rho: 1.429, mp: 54.36, bp: 90.20, cp: 918, k: 0.0265, en: 3.44, ie: 13.618, ox: [-2] },
  { z: 9, s: "F", n: "Fluorine", mass: 18.998, g: 17, p: 2, b: "p", cat: "halogen", rho: 1.696, mp: 53.53, bp: 85.03, cp: 824, k: 0.0277, en: 3.98, ie: 17.423, ox: [-1] },
  { z: 10, s: "Ne", n: "Neon", mass: 20.180, g: 18, p: 2, b: "p", cat: "noble gas", rho: 0.9002, mp: 24.56, bp: 27.07, cp: 1030, k: 0.0491, en: null, ie: 21.565, ox: [0] },

  // Period 3
  { z: 11, s: "Na", n: "Sodium", mass: 22.990, g: 1, p: 3, b: "s", cat: "alkali metal", rho: 968, mp: 370.87, bp: 1156, cp: 1228, k: 142, en: 0.93, ie: 5.139, ox: [1] },
  { z: 12, s: "Mg", n: "Magnesium", mass: 24.305, g: 2, p: 3, b: "s", cat: "alkaline earth", rho: 1738, mp: 923, bp: 1363, cp: 1023, k: 156, en: 1.31, ie: 7.646, ox: [2] },
  { z: 13, s: "Al", n: "Aluminum", mass: 26.982, g: 13, p: 3, b: "p", cat: "post-transition metal", rho: 2700, mp: 933.47, bp: 2792, cp: 897, k: 237, en: 1.61, ie: 5.986, ox: [3] },
  { z: 14, s: "Si", n: "Silicon", mass: 28.085, g: 14, p: 3, b: "p", cat: "metalloid", rho: 2329, mp: 1687, bp: 3538, cp: 705, k: 149, en: 1.90, ie: 8.152, ox: [4, -4] },
  { z: 15, s: "P", n: "Phosphorus", mass: 30.974, g: 15, p: 3, b: "p", cat: "nonmetal", rho: 1823, mp: 317.3, bp: 553.6, cp: 769, k: 0.236, en: 2.19, ie: 10.487, ox: [5, 3, -3] },
  { z: 16, s: "S", n: "Sulfur", mass: 32.06, g: 16, p: 3, b: "p", cat: "nonmetal", rho: 2070, mp: 388.36, bp: 717.8, cp: 705, k: 0.205, en: 2.58, ie: 10.360, ox: [6, 4, -2] },
  { z: 17, s: "Cl", n: "Chlorine", mass: 35.45, g: 17, p: 3, b: "p", cat: "halogen", rho: 3.2, mp: 171.6, bp: 239.11, cp: 479, k: 0.0089, en: 3.16, ie: 12.968, ox: [7, 5, 3, 1, -1] },
  { z: 18, s: "Ar", n: "Argon", mass: 39.948, g: 18, p: 3, b: "p", cat: "noble gas", rho: 1.784, mp: 83.8, bp: 87.3, cp: 520, k: 0.0177, en: null, ie: 15.760, ox: [0] },

  // Period 4
  { z: 19, s: "K", n: "Potassium", mass: 39.098, g: 1, p: 4, b: "s", cat: "alkali metal", rho: 862, mp: 336.53, bp: 1032, cp: 757, k: 102.5, en: 0.82, ie: 4.341, ox: [1] },
  { z: 20, s: "Ca", n: "Calcium", mass: 40.078, g: 2, p: 4, b: "s", cat: "alkaline earth", rho: 1540, mp: 1115, bp: 1757, cp: 647, k: 201, en: 1.00, ie: 6.113, ox: [2] },
  { z: 21, s: "Sc", n: "Scandium", mass: 44.956, g: 3, p: 4, b: "d", cat: "transition metal", rho: 2989, mp: 1814, bp: 3109, cp: 568, k: 15.8, en: 1.36, ie: 6.561, ox: [3] },
  { z: 22, s: "Ti", n: "Titanium", mass: 47.867, g: 4, p: 4, b: "d", cat: "transition metal", rho: 4506, mp: 1941, bp: 3560, cp: 523, k: 21.9, en: 1.54, ie: 6.828, ox: [4, 3, 2] },
  { z: 23, s: "V", n: "Vanadium", mass: 50.942, g: 5, p: 4, b: "d", cat: "transition metal", rho: 6110, mp: 2183, bp: 3680, cp: 489, k: 30.7, en: 1.63, ie: 6.746, ox: [5, 4, 3, 2] },
  { z: 24, s: "Cr", n: "Chromium", mass: 51.996, g: 6, p: 4, b: "d", cat: "transition metal", rho: 7150, mp: 2180, bp: 2944, cp: 449, k: 93.9, en: 1.66, ie: 6.767, ox: [6, 3, 2] },
  { z: 25, s: "Mn", n: "Manganese", mass: 54.938, g: 7, p: 4, b: "d", cat: "transition metal", rho: 7440, mp: 1519, bp: 2334, cp: 479, k: 7.8, en: 1.55, ie: 7.434, ox: [7, 4, 3, 2] },
  { z: 26, s: "Fe", n: "Iron", mass: 55.845, g: 8, p: 4, b: "d", cat: "transition metal", rho: 7874, mp: 1811, bp: 3134, cp: 449, k: 80.4, en: 1.83, ie: 7.902, ox: [3, 2] },
  { z: 27, s: "Co", n: "Cobalt", mass: 58.933, g: 9, p: 4, b: "d", cat: "transition metal", rho: 8860, mp: 1768, bp: 3200, cp: 421, k: 100, en: 1.88, ie: 7.881, ox: [3, 2] },
  { z: 28, s: "Ni", n: "Nickel", mass: 58.693, g: 10, p: 4, b: "d", cat: "transition metal", rho: 8908, mp: 1728, bp: 3186, cp: 444, k: 90.9, en: 1.91, ie: 7.640, ox: [3, 2] },
  { z: 29, s: "Cu", n: "Copper", mass: 63.546, g: 11, p: 4, b: "d", cat: "transition metal", rho: 8960, mp: 1357.77, bp: 2835, cp: 385, k: 401, en: 1.90, ie: 7.726, ox: [2, 1] },
  { z: 30, s: "Zn", n: "Zinc", mass: 65.38, g: 12, p: 4, b: "d", cat: "transition metal", rho: 7140, mp: 692.68, bp: 1180, cp: 388, k: 116, en: 1.65, ie: 9.394, ox: [2] },
  { z: 31, s: "Ga", n: "Gallium", mass: 69.723, g: 13, p: 4, b: "p", cat: "post-transition metal", rho: 5910, mp: 302.91, bp: 2477, cp: 371, k: 40.6, en: 1.81, ie: 5.999, ox: [3] },
  { z: 32, s: "Ge", n: "Germanium", mass: 72.630, g: 14, p: 4, b: "p", cat: "metalloid", rho: 5323, mp: 1211.4, bp: 3106, cp: 320, k: 60.2, en: 2.01, ie: 7.899, ox: [4, 2] },
  { z: 33, s: "As", n: "Arsenic", mass: 74.922, g: 15, p: 4, b: "p", cat: "metalloid", rho: 5776, mp: 1090, bp: 887, cp: 329, k: 50.2, en: 2.18, ie: 9.789, ox: [5, 3, -3] },
  { z: 34, s: "Se", n: "Selenium", mass: 78.971, g: 16, p: 4, b: "p", cat: "nonmetal", rho: 4809, mp: 494, bp: 958, cp: 321, k: 0.52, en: 2.55, ie: 9.752, ox: [6, 4, -2] },
  { z: 35, s: "Br", n: "Bromine", mass: 79.904, g: 17, p: 4, b: "p", cat: "halogen", rho: 3120, mp: 265.8, bp: 332.0, cp: 474, k: 0.122, en: 2.96, ie: 11.814, ox: [5, 3, 1, -1] },
  { z: 36, s: "Kr", n: "Krypton", mass: 83.798, g: 18, p: 4, b: "p", cat: "noble gas", rho: 3.749, mp: 115.79, bp: 119.93, cp: 248, k: 0.0094, en: 3.00, ie: 13.999, ox: [2, 0] },

  // Period 5
  { z: 37, s: "Rb", n: "Rubidium", mass: 85.468, g: 1, p: 5, b: "s", cat: "alkali metal", rho: 1532, mp: 312.46, bp: 961, cp: 363, k: 58, en: 0.82, ie: 4.177, ox: [1] },
  { z: 38, s: "Sr", n: "Strontium", mass: 87.62, g: 2, p: 5, b: "s", cat: "alkaline earth", rho: 2640, mp: 1050, bp: 1655, cp: 301, k: 35.4, en: 0.95, ie: 5.695, ox: [2] },
  { z: 39, s: "Y", n: "Yttrium", mass: 88.906, g: 3, p: 5, b: "d", cat: "transition metal", rho: 4472, mp: 1799, bp: 3609, cp: 298, k: 17.2, en: 1.22, ie: 6.217, ox: [3] },
  { z: 40, s: "Zr", n: "Zirconium", mass: 91.224, g: 4, p: 5, b: "d", cat: "transition metal", rho: 6520, mp: 2128, bp: 4682, cp: 278, k: 22.6, en: 1.33, ie: 6.634, ox: [4] },
  { z: 41, s: "Nb", n: "Niobium", mass: 92.906, g: 5, p: 5, b: "d", cat: "transition metal", rho: 8570, mp: 2750, bp: 5017, cp: 265, k: 53.7, en: 1.6, ie: 6.759, ox: [5, 3] },
  { z: 42, s: "Mo", n: "Molybdenum", mass: 95.95, g: 6, p: 5, b: "d", cat: "transition metal", rho: 10280, mp: 2896, bp: 4912, cp: 251, k: 138, en: 2.16, ie: 7.092, ox: [6, 4, 3, 2] },
  { z: 43, s: "Tc", n: "Technetium", mass: 98, g: 7, p: 5, b: "d", cat: "transition metal", rho: 11500, mp: 2430, bp: 4538, cp: 240, k: 50.6, en: 1.9, ie: 7.28, ox: [7, 4] },
  { z: 44, s: "Ru", n: "Ruthenium", mass: 101.07, g: 8, p: 5, b: "d", cat: "transition metal", rho: 12450, mp: 2607, bp: 4423, cp: 238, k: 117, en: 2.2, ie: 7.361, ox: [4, 3, 2] },
  { z: 45, s: "Rh", n: "Rhodium", mass: 102.91, g: 9, p: 5, b: "d", cat: "transition metal", rho: 12410, mp: 2237, bp: 3968, cp: 243, k: 150, en: 2.28, ie: 7.459, ox: [3] },
  { z: 46, s: "Pd", n: "Palladium", mass: 106.42, g: 10, p: 5, b: "d", cat: "transition metal", rho: 12023, mp: 1828.05, bp: 3236, cp: 244, k: 71.8, en: 2.20, ie: 8.337, ox: [4, 2] },
  { z: 47, s: "Ag", n: "Silver", mass: 107.87, g: 11, p: 5, b: "d", cat: "transition metal", rho: 10490, mp: 1234.93, bp: 2435, cp: 235, k: 429, en: 1.93, ie: 7.576, ox: [1] },
  { z: 48, s: "Cd", n: "Cadmium", mass: 112.41, g: 12, p: 5, b: "d", cat: "transition metal", rho: 8650, mp: 594.22, bp: 1040, cp: 232, k: 96.6, en: 1.69, ie: 8.994, ox: [2] },
  { z: 49, s: "In", n: "Indium", mass: 114.82, g: 13, p: 5, b: "p", cat: "post-transition metal", rho: 7310, mp: 429.75, bp: 2345, cp: 233, k: 81.8, en: 1.78, ie: 5.786, ox: [3] },
  { z: 50, s: "Sn", n: "Tin", mass: 118.71, g: 14, p: 5, b: "p", cat: "post-transition metal", rho: 7310, mp: 505.08, bp: 2875, cp: 228, k: 66.8, en: 1.96, ie: 7.344, ox: [4, 2] },
  { z: 51, s: "Sb", n: "Antimony", mass: 121.76, g: 15, p: 5, b: "p", cat: "metalloid", rho: 6697, mp: 903.78, bp: 1860, cp: 207, k: 24.4, en: 2.05, ie: 8.608, ox: [5, 3, -3] },
  { z: 52, s: "Te", n: "Tellurium", mass: 127.60, g: 16, p: 5, b: "p", cat: "metalloid", rho: 6240, mp: 722.66, bp: 1261, cp: 202, k: 2.35, en: 2.1, ie: 9.010, ox: [6, 4, -2] },
  { z: 53, s: "I", n: "Iodine", mass: 126.90, g: 17, p: 5, b: "p", cat: "halogen", rho: 4940, mp: 386.85, bp: 457.4, cp: 429, k: 0.449, en: 2.66, ie: 10.451, ox: [7, 5, 1, -1] },
  { z: 54, s: "Xe", n: "Xenon", mass: 131.29, g: 18, p: 5, b: "p", cat: "noble gas", rho: 5.894, mp: 161.4, bp: 165.03, cp: 158, k: 0.0057, en: 2.6, ie: 12.130, ox: [8, 6, 4, 2, 0] },

  // Period 6 (including Lanthanides Z=57-71)
  { z: 55, s: "Cs", n: "Cesium", mass: 132.91, g: 1, p: 6, b: "s", cat: "alkali metal", rho: 1930, mp: 301.59, bp: 944, cp: 242, k: 35.9, en: 0.79, ie: 3.894, ox: [1] },
  { z: 56, s: "Ba", n: "Barium", mass: 137.33, g: 2, p: 6, b: "s", cat: "alkaline earth", rho: 3510, mp: 1000, bp: 2170, cp: 204, k: 18.4, en: 0.89, ie: 5.212, ox: [2] },
  { z: 57, s: "La", n: "Lanthanum", mass: 138.91, g: 3, p: 6, b: "f", cat: "lanthanide", rho: 6162, mp: 1193, bp: 3737, cp: 195, k: 13.4, en: 1.10, ie: 5.577, ox: [3] },
  { z: 58, s: "Ce", n: "Cerium", mass: 140.12, g: 3, p: 6, b: "f", cat: "lanthanide", rho: 6770, mp: 1068, bp: 3716, cp: 192, k: 11.3, en: 1.12, ie: 5.539, ox: [4, 3] },
  { z: 59, s: "Pr", n: "Praseodymium", mass: 140.91, g: 3, p: 6, b: "f", cat: "lanthanide", rho: 6770, mp: 1208, bp: 3793, cp: 193, k: 12.5, en: 1.13, ie: 5.473, ox: [3] },
  { z: 60, s: "Nd", n: "Neodymium", mass: 144.24, g: 3, p: 6, b: "f", cat: "lanthanide", rho: 7010, mp: 1297, bp: 3347, cp: 190, k: 16.5, en: 1.14, ie: 5.525, ox: [3] },
  { z: 61, s: "Pm", n: "Promethium", mass: 145, g: 3, p: 6, b: "f", cat: "lanthanide", rho: 7260, mp: 1315, bp: 3273, cp: 180, k: 15.0, en: 1.13, ie: 5.582, ox: [3] },
  { z: 62, s: "Sm", n: "Samarium", mass: 150.36, g: 3, p: 6, b: "f", cat: "lanthanide", rho: 7520, mp: 1345, bp: 2067, cp: 197, k: 13.3, en: 1.17, ie: 5.644, ox: [3, 2] },
  { z: 63, s: "Eu", n: "Europium", mass: 151.96, g: 3, p: 6, b: "f", cat: "lanthanide", rho: 5244, mp: 1099, bp: 1802, cp: 182, k: 13.9, en: 1.2, ie: 5.670, ox: [3, 2] },
  { z: 64, s: "Gd", n: "Gadolinium", mass: 157.25, g: 3, p: 6, b: "f", cat: "lanthanide", rho: 7900, mp: 1585, bp: 3546, cp: 236, k: 10.5, en: 1.20, ie: 6.150, ox: [3] },
  { z: 65, s: "Tb", n: "Terbium", mass: 158.93, g: 3, p: 6, b: "f", cat: "lanthanide", rho: 8230, mp: 1629, bp: 3503, cp: 182, k: 11.1, en: 1.2, ie: 5.864, ox: [4, 3] },
  { z: 66, s: "Dy", n: "Dysprosium", mass: 162.50, g: 3, p: 6, b: "f", cat: "lanthanide", rho: 8540, mp: 1680, bp: 2840, cp: 173, k: 10.7, en: 1.22, ie: 5.939, ox: [3] },
  { z: 67, s: "Ho", n: "Holmium", mass: 164.93, g: 3, p: 6, b: "f", cat: "lanthanide", rho: 8790, mp: 1734, bp: 2993, cp: 165, k: 16.2, en: 1.23, ie: 6.022, ox: [3] },
  { z: 68, s: "Er", n: "Erbium", mass: 167.26, g: 3, p: 6, b: "f", cat: "lanthanide", rho: 9066, mp: 1802, bp: 3141, cp: 168, k: 14.5, en: 1.24, ie: 6.108, ox: [3] },
  { z: 69, s: "Tm", n: "Thulium", mass: 168.93, g: 3, p: 6, b: "f", cat: "lanthanide", rho: 9320, mp: 1818, bp: 2223, cp: 160, k: 16.9, en: 1.25, ie: 6.184, ox: [3] },
  { z: 70, s: "Yb", n: "Ytterbium", mass: 173.05, g: 3, p: 6, b: "f", cat: "lanthanide", rho: 6900, mp: 1097, bp: 1469, cp: 155, k: 38.5, en: 1.1, ie: 6.254, ox: [3, 2] },
  { z: 71, s: "Lu", n: "Lutetium", mass: 174.97, g: 3, p: 6, b: "d", cat: "lanthanide", rho: 9841, mp: 1925, bp: 3675, cp: 154, k: 16.4, en: 1.27, ie: 5.426, ox: [3] },
  { z: 72, s: "Hf", n: "Hafnium", mass: 178.49, g: 4, p: 6, b: "d", cat: "transition metal", rho: 13310, mp: 2506, bp: 4876, cp: 144, k: 23.0, en: 1.3, ie: 6.825, ox: [4] },
  { z: 73, s: "Ta", n: "Tantalum", mass: 180.95, g: 5, p: 6, b: "d", cat: "transition metal", rho: 16690, mp: 3290, bp: 5731, cp: 140, k: 57.5, en: 1.5, ie: 7.550, ox: [5] },
  { z: 74, s: "W", n: "Tungsten", mass: 183.84, g: 6, p: 6, b: "d", cat: "transition metal", rho: 19250, mp: 3695, bp: 5828, cp: 132, k: 173, en: 2.36, ie: 7.864, ox: [6, 4] },
  { z: 75, s: "Re", n: "Rhenium", mass: 186.21, g: 7, p: 6, b: "d", cat: "transition metal", rho: 21020, mp: 3459, bp: 5869, cp: 137, k: 48.0, en: 1.9, ie: 7.834, ox: [7, 4] },
  { z: 76, s: "Os", n: "Osmium", mass: 190.23, g: 8, p: 6, b: "d", cat: "transition metal", rho: 22590, mp: 3306, bp: 5285, cp: 130, k: 87.0, en: 2.2, ie: 8.438, ox: [4, 8] },
  { z: 77, s: "Ir", n: "Iridium", mass: 192.22, g: 9, p: 6, b: "d", cat: "transition metal", rho: 22560, mp: 2719, bp: 4701, cp: 131, k: 147, en: 2.20, ie: 8.967, ox: [4, 3] },
  { z: 78, s: "Pt", n: "Platinum", mass: 195.08, g: 10, p: 6, b: "d", cat: "transition metal", rho: 21450, mp: 2041.4, bp: 4098, cp: 133, k: 71.6, en: 2.28, ie: 8.959, ox: [4, 2] },
  { z: 79, s: "Au", n: "Gold", mass: 196.97, g: 11, p: 6, b: "d", cat: "transition metal", rho: 19300, mp: 1337.33, bp: 3129, cp: 129, k: 318, en: 2.54, ie: 9.226, ox: [3, 1] },
  { z: 80, s: "Hg", n: "Mercury", mass: 200.59, g: 12, p: 6, b: "d", cat: "transition metal", rho: 13534, mp: 234.32, bp: 629.88, cp: 140, k: 8.3, en: 2.00, ie: 10.438, ox: [2, 1] },
  { z: 81, s: "Tl", n: "Thallium", mass: 204.38, g: 13, p: 6, b: "p", cat: "post-transition metal", rho: 11850, mp: 577, bp: 1746, cp: 129, k: 46.1, en: 1.62, ie: 6.108, ox: [1, 3] },
  { z: 82, s: "Pb", n: "Lead", mass: 207.2, g: 14, p: 6, b: "p", cat: "post-transition metal", rho: 11340, mp: 600.61, bp: 2022, cp: 129, k: 35.3, en: 2.33, ie: 7.417, ox: [2, 4] },
  { z: 83, s: "Bi", n: "Bismuth", mass: 208.98, g: 15, p: 6, b: "p", cat: "post-transition metal", rho: 9780, mp: 544.7, bp: 1837, cp: 122, k: 7.97, en: 2.02, ie: 7.286, ox: [3] },
  { z: 84, s: "Po", n: "Polonium", mass: 209, g: 16, p: 6, b: "p", cat: "post-transition metal", rho: 9196, mp: 527, bp: 1235, cp: null, k: 0.20, en: 2.0, ie: 8.417, ox: [4, 2] },
  { z: 85, s: "At", n: "Astatine", mass: 210, g: 17, p: 6, b: "p", cat: "metalloid", rho: null, mp: 575, bp: 610, cp: null, k: 1.7, en: 2.2, ie: 9.3, ox: [1, -1] },
  { z: 86, s: "Rn", n: "Radon", mass: 222, g: 18, p: 6, b: "p", cat: "noble gas", rho: 9.73, mp: 202, bp: 211.3, cp: 94, k: 0.0036, en: 2.2, ie: 10.749, ox: [2, 0] },

  // Period 7 (including Actinides Z=89-103 and Superheavies Z=104-118)
  { z: 87, s: "Fr", n: "Francium", mass: 223, g: 1, p: 7, b: "s", cat: "alkali metal", rho: 1870, mp: 300, bp: 950, cp: null, k: 15.0, en: 0.7, ie: 4.073, ox: [1] },
  { z: 88, s: "Ra", n: "Radium", mass: 226, g: 2, p: 7, b: "s", cat: "alkaline earth", rho: 5500, mp: 973, bp: 2010, cp: null, k: 18.6, en: 0.9, ie: 5.278, ox: [2] },
  { z: 89, s: "Ac", n: "Actinium", mass: 227, g: 3, p: 7, b: "f", cat: "actinide", rho: 10070, mp: 1323, bp: 3471, cp: 120, k: 12.0, en: 1.1, ie: 5.17, ox: [3] },
  { z: 90, s: "Th", n: "Thorium", mass: 232.04, g: 3, p: 7, b: "f", cat: "actinide", rho: 11720, mp: 2115, bp: 5061, cp: 118, k: 54.0, en: 1.3, ie: 6.307, ox: [4] },
  { z: 91, s: "Pa", n: "Protactinium", mass: 231.04, g: 3, p: 7, b: "f", cat: "actinide", rho: 15370, mp: 1841, bp: 4300, cp: null, k: 47.0, en: 1.5, ie: 5.89, ox: [5, 4] },
  { z: 92, s: "U", n: "Uranium", mass: 238.03, g: 3, p: 7, b: "f", cat: "actinide", rho: 19100, mp: 1405.3, bp: 4404, cp: 116, k: 27.5, en: 1.38, ie: 6.194, ox: [6, 4, 3] },
  { z: 93, s: "Np", n: "Neptunium", mass: 237, g: 3, p: 7, b: "f", cat: "actinide", rho: 20450, mp: 917, bp: 4273, cp: null, k: 6.3, en: 1.36, ie: 6.266, ox: [5, 4, 3] },
  { z: 94, s: "Pu", n: "Plutonium", mass: 244, g: 3, p: 7, b: "f", cat: "actinide", rho: 19840, mp: 912.5, bp: 3501, cp: null, k: 6.74, en: 1.28, ie: 6.026, ox: [4, 3] },
  { z: 95, s: "Am", n: "Americium", mass: 243, g: 3, p: 7, b: "f", cat: "actinide", rho: 13690, mp: 1449, bp: 2880, cp: null, k: 10.0, en: 1.3, ie: 5.974, ox: [3] },
  { z: 96, s: "Cm", n: "Curium", mass: 247, g: 3, p: 7, b: "f", cat: "actinide", rho: 13510, mp: 1613, bp: 3383, cp: null, k: null, en: 1.3, ie: 5.991, ox: [3] },
  { z: 97, s: "Bk", n: "Berkelium", mass: 247, g: 3, p: 7, b: "f", cat: "actinide", rho: 14780, mp: 1259, bp: 2900, cp: null, k: null, en: 1.3, ie: 6.198, ox: [3, 4] },
  { z: 98, s: "Cf", n: "Californium", mass: 251, g: 3, p: 7, b: "f", cat: "actinide", rho: 15100, mp: 1173, bp: 1743, cp: null, k: null, en: 1.3, ie: 6.282, ox: [3] },
  { z: 99, s: "Es", n: "Einsteinium", mass: 252, g: 3, p: 7, b: "f", cat: "actinide", rho: 8840, mp: 1133, bp: 1269, cp: null, k: null, en: 1.3, ie: 6.42, ox: [3] },
  { z: 100, s: "Fm", n: "Fermium", mass: 257, g: 3, p: 7, b: "f", cat: "actinide", rho: null, mp: 1800, bp: null, cp: null, k: null, en: 1.3, ie: 6.50, ox: [3] },
  { z: 101, s: "Md", n: "Mendelevium", mass: 258, g: 3, p: 7, b: "f", cat: "actinide", rho: null, mp: 1100, bp: null, cp: null, k: null, en: 1.3, ie: 6.58, ox: [3, 2] },
  { z: 102, s: "No", n: "Nobelium", mass: 259, g: 3, p: 7, b: "f", cat: "actinide", rho: null, mp: 1100, bp: null, cp: null, k: null, en: 1.3, ie: 6.65, ox: [2, 3] },
  { z: 103, s: "Lr", n: "Lawrencium", mass: 266, g: 3, p: 7, b: "d", cat: "actinide", rho: null, mp: 1900, bp: null, cp: null, k: null, en: 1.3, ie: 4.96, ox: [3] },
  { z: 104, s: "Rf", n: "Rutherfordium", mass: 267, g: 4, p: 7, b: "d", cat: "transition metal", rho: 23200, mp: 2400, bp: 5800, cp: null, k: null, en: null, ie: 6.0, ox: [4] },
  { z: 105, s: "Db", n: "Dubnium", mass: 268, g: 5, p: 7, b: "d", cat: "transition metal", rho: 29300, mp: null, bp: null, cp: null, k: null, en: null, ie: null, ox: [5] },
  { z: 106, s: "Sg", n: "Seaborgium", mass: 269, g: 6, p: 7, b: "d", cat: "transition metal", rho: 35000, mp: null, bp: null, cp: null, k: null, en: null, ie: null, ox: [6] },
  { z: 107, s: "Bh", n: "Bohrium", mass: 270, g: 7, p: 7, b: "d", cat: "transition metal", rho: 37100, mp: null, bp: null, cp: null, k: null, en: null, ie: null, ox: [7] },
  { z: 108, s: "Hs", n: "Hassium", mass: 269, g: 8, p: 7, b: "d", cat: "transition metal", rho: 40700, mp: null, bp: null, cp: null, k: null, en: null, ie: null, ox: [8] },
  { z: 109, s: "Mt", n: "Meitnerium", mass: 278, g: 9, p: 7, b: "d", cat: "transition metal", rho: 37400, mp: null, bp: null, cp: null, k: null, en: null, ie: null, ox: [9] },
  { z: 110, s: "Ds", n: "Darmstadtium", mass: 281, g: 10, p: 7, b: "d", cat: "transition metal", rho: 34800, mp: null, bp: null, cp: null, k: null, en: null, ie: null, ox: [8, 6, 4] },
  { z: 111, s: "Rg", n: "Roentgenium", mass: 282, g: 11, p: 7, b: "d", cat: "transition metal", rho: 28700, mp: null, bp: null, cp: null, k: null, en: null, ie: null, ox: [5, 3] },
  { z: 112, s: "Cn", n: "Copernicium", mass: 285, g: 12, p: 7, b: "d", cat: "transition metal", rho: 23700, mp: 283, bp: 340, cp: null, k: null, en: null, ie: 11.97, ox: [2] },
  { z: 113, s: "Nh", n: "Nihonium", mass: 286, g: 13, p: 7, b: "p", cat: "post-transition metal", rho: 16000, mp: 700, bp: 1430, cp: null, k: null, en: null, ie: 7.3, ox: [1, 3] },
  { z: 114, s: "Fl", n: "Flerovium", mass: 289, g: 14, p: 7, b: "p", cat: "post-transition metal", rho: 14000, mp: 340, bp: 420, cp: null, k: null, en: null, ie: 8.5, ox: [2, 4] },
  { z: 115, s: "Mc", n: "Moscovium", mass: 290, g: 15, p: 7, b: "p", cat: "post-transition metal", rho: 13500, mp: 670, bp: 1400, cp: null, k: null, en: null, ie: 5.6, ox: [1, 3] },
  { z: 116, s: "Lv", n: "Livermorium", mass: 293, g: 16, p: 7, b: "p", cat: "post-transition metal", rho: 12900, mp: 709, bp: 1085, cp: null, k: null, en: null, ie: 6.8, ox: [2, 4] },
  { z: 117, s: "Ts", n: "Tennessine", mass: 294, g: 17, p: 7, b: "p", cat: "halogen", rho: 7200, mp: 723, bp: 883, cp: null, k: null, en: null, ie: 7.7, ox: [-1, 1, 3, 5] },
  { z: 118, s: "Og", n: "Oganesson", mass: 294, g: 18, p: 7, b: "p", cat: "noble gas", rho: 5000, mp: 325, bp: 350, cp: null, k: null, en: null, ie: 8.9, ox: [0, 2, 4] }
];

console.log(`Verifying element count: ${rawElements.length} elements provided.`);
if (rawElements.length !== 118) {
  throw new Error(`Expected 118 elements, got ${rawElements.length}`);
}

const elementsByAtomicNumber = {};
const elementsBySymbol = {};

for (const el of rawElements) {
  const record = {
    atomic_number: el.z,
    symbol: el.s,
    name: el.n,
    atomic_weight_u: el.mass,
    group: el.g,
    period: el.p,
    block: el.b,
    category: el.cat,
    density_kg_m3: el.rho,
    melting_point_k: el.mp,
    boiling_point_k: el.bp,
    specific_heat_j_kg_k: el.cp,
    thermal_conductivity_w_m_k: el.k,
    electronegativity_pauling: el.en,
    ionization_energy_ev: el.ie,
    oxidation_states: el.ox
  };
  elementsByAtomicNumber[el.z] = record;
  elementsBySymbol[el.s.toUpperCase()] = record;
}

const db = {
  metadata: {
    standard: "IUPAC / NIST Physical Reference Data",
    total_elements: 118,
    version: "2026.1",
    generated_at: new Date().toISOString()
  },
  elements: rawElements.map(el => elementsByAtomicNumber[el.z])
};

const targetPath = path.join(__dirname, '../../src/core/materials/data/periodic_table_118_elements.json');
fs.writeFileSync(targetPath, JSON.stringify(db, null, 2), 'utf8');
console.log(`[PASS] Wrote 118 elements database to: ${targetPath}`);
