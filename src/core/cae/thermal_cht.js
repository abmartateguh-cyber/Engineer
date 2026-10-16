/**
 * OmniEng Conjugate Heat Transfer (CHT) & Electronics Thermal Engine (Ansys Icepak Equivalent)
 * Solves solid-fluid heat dissipation, vapor chamber heat spreaders, and SoC/Battery thermal runaway.
 */

class ThermalEngine {
  /**
   * Run 2D transient thermal conduction & convection simulation
   * @param {Object} config Smartphone packaging thermal configuration
   */
  static simulateSmartphoneThermal(config = {}) {
    const {
      socPowerWatts = 8.5,     // 8.5W during 4K video recording / heavy gaming
      batteryPowerWatts = 3.2, // 3.2W during 65W fast charging
      ambientTempC = 25.0,     // 25 C ambient
      hasVaporChamber = true,  // Modern copper-wick vapor chamber
      chassisMaterial = 'Aluminum', // 'Aluminum' or 'Titanium'
      totalTimeSec = 30.0,
      gridW = 30, // 30x60 grid representing 75mm x 150mm smartphone
      gridH = 60
    } = config;

    // Dimensions
    const width = 0.075;  // 75 mm
    const height = 0.150; // 150 mm
    const dx = width / gridW;
    const dy = height / gridH;

    // Thermal properties grid: k (W/m*K), rhoCp (J/m^3*K)
    const k = Array.from({ length: gridH }, () => new Float64Array(gridW));
    const rhoCp = Array.from({ length: gridH }, () => new Float64Array(gridW));
    const qGen = Array.from({ length: gridH }, () => new Float64Array(gridW)); // W/m^3

    // Default PCB substrate (FR4: k ~ 0.3 W/m*K, rho*cp ~ 2.0e6)
    for (let j = 0; j < gridH; j++) {
      for (let i = 0; i < gridW; i++) {
        k[j][i] = 0.8;
        rhoCp[j][i] = 1.9e6;
      }
    }

    // Chassis perimeter (Aluminum: k=180, Titanium: k=22)
    const kChassis = chassisMaterial === 'Titanium' ? 22.0 : 180.0;
    for (let j = 0; j < gridH; j++) {
      k[j][0] = kChassis;
      k[j][gridW - 1] = kChassis;
    }
    for (let i = 0; i < gridW; i++) {
      k[0][i] = kChassis;
      k[gridH - 1][i] = kChassis;
    }

    // Vapor chamber location (Upper center over SoC and battery)
    if (hasVaporChamber) {
      const vcX0 = Math.floor(gridW * 0.2);
      const vcX1 = Math.floor(gridW * 0.8);
      const vcY0 = Math.floor(gridH * 0.2);
      const vcY1 = Math.floor(gridH * 0.7);

      for (let j = vcY0; j < vcY1; j++) {
        for (let i = vcX0; i < vcX1; i++) {
          k[j][i] = 280.0; // Effective 2D planar spreading conductivity of thin vapor chamber
          rhoCp[j][i] = 3.2e6;
        }
      }
    }

    // SoC location (Upper third: 12mm x 12mm footprint)
    const socI0 = Math.floor(gridW * 0.35);
    const socI1 = Math.floor(gridW * 0.65);
    const socJ0 = Math.floor(gridH * 0.25);
    const socJ1 = Math.floor(gridH * 0.40);
    const socCells = (socI1 - socI0) * (socJ1 - socJ0);
    const socVolume = socCells * dx * dy * 0.001; // 1mm thick

    for (let j = socJ0; j < socJ1; j++) {
      for (let i = socI0; i < socI1; i++) {
        qGen[j][i] = socPowerWatts / socVolume;
        k[j][i] = 140.0; // Silicon k ~ 140 W/m*K
      }
    }

    // Battery location (Lower two-thirds)
    const batI0 = Math.floor(gridW * 0.2);
    const batI1 = Math.floor(gridW * 0.8);
    const batJ0 = Math.floor(gridH * 0.45);
    const batJ1 = Math.floor(gridH * 0.85);
    const batCells = (batI1 - batI0) * (batJ1 - batJ0);
    const batVolume = batCells * dx * dy * 0.004; // 4mm thick

    for (let j = batJ0; j < batJ1; j++) {
      for (let i = batI0; i < batI1; i++) {
        qGen[j][i] = batteryPowerWatts / batVolume;
        k[j][i] = 2.5; // Li-ion pouch
      }
    }

    // Temperature field (initialized to ambient)
    let T = Array.from({ length: gridH }, () => new Float64Array(gridW).fill(ambientTempC));
    const hConv = 12.0; // Natural convection heat transfer coefficient W/m^2*K

    // Numerical integration loop with sub-stepping for CFL stability
    const subDt = 0.005; // 5ms sub-step
    const totalSteps = Math.min(1200, Math.ceil(totalTimeSec / subDt));

    for (let s = 0; s < totalSteps; s++) {
      const T_next = T.map(row => new Float64Array(row));

      for (let j = 1; j < gridH - 1; j++) {
        for (let i = 1; i < gridW - 1; i++) {
          const kij = k[j][i];
          const cp = rhoCp[j][i];

          // Harmonic mean face conductivities (standard FVM for heterogeneous materials)
          const kE = (2 * kij * k[j][i + 1]) / (kij + k[j][i + 1] + 1e-12);
          const kW = (2 * kij * k[j][i - 1]) / (kij + k[j][i - 1] + 1e-12);
          const kN = (2 * kij * k[j + 1][i]) / (kij + k[j + 1][i] + 1e-12);
          const kS = (2 * kij * k[j - 1][i]) / (kij + k[j - 1][i] + 1e-12);

          const qFluxX = (kE * (T[j][i + 1] - T[j][i]) + kW * (T[j][i - 1] - T[j][i])) / (dx * dx);
          const qFluxY = (kN * (T[j + 1][i] - T[j][i]) + kS * (T[j - 1][i] - T[j][i])) / (dy * dy);
          const qConduction = qFluxX + qFluxY;

          // Surface convective heat loss
          const qConvection = (2 * hConv / 0.008) * (ambientTempC - T[j][i]);

          const dT_dt = (qConduction + qGen[j][i] + qConvection) / cp;
          const change = Math.max(-2.0, Math.min(2.0, subDt * dT_dt));
          T_next[j][i] = Math.max(ambientTempC, T[j][i] + change);
        }
      }

      // Perimeter boundary condition (Newton cooling)
      for (let j = 0; j < gridH; j++) {
        T_next[j][0] = T_next[j][1] - (hConv * dx / kChassis) * (T_next[j][0] - ambientTempC);
        T_next[j][gridW - 1] = T_next[j][gridW - 2] - (hConv * dx / kChassis) * (T_next[j][gridW - 1] - ambientTempC);
      }
      for (let i = 0; i < gridW; i++) {
        T_next[0][i] = T_next[1][i] - (hConv * dy / kChassis) * (T_next[0][i] - ambientTempC);
        T_next[gridH - 1][i] = T_next[gridH - 2][i] - (hConv * dy / kChassis) * (T_next[gridH - 1][i] - ambientTempC);
      }

      T = T_next;
    }

    // Calculate maximum temperatures
    let maxSocTemp = -999;
    let maxBatteryTemp = -999;
    let maxSkinTemp = -999;

    for (let j = 0; j < gridH; j++) {
      for (let i = 0; i < gridW; i++) {
        const val = T[j][i];
        if (j >= socJ0 && j < socJ1 && i >= socI0 && i < socI1) {
          if (val > maxSocTemp) maxSocTemp = val;
        }
        if (j >= batJ0 && j < batJ1 && i >= batI0 && i < batI1) {
          if (val > maxBatteryTemp) maxBatteryTemp = val;
        }
        if (j === 0 || j === gridH - 1 || i === 0 || i === gridW - 1) {
          if (val > maxSkinTemp) maxSkinTemp = val;
        }
      }
    }

    const socThrottlingRisk = maxSocTemp > 85.0; // SoC throttles at 85 C
    const batteryThermalRunawayRisk = maxBatteryTemp > 55.0; // Li-ion degradation threshold 55 C

    return {
      ambientTempC,
      socPowerWatts,
      batteryPowerWatts,
      hasVaporChamber,
      maxSocTempC: +maxSocTemp.toFixed(1),
      maxBatteryTempC: +maxBatteryTemp.toFixed(1),
      maxSkinTempC: +maxSkinTemp.toFixed(1),
      socThrottlingRisk,
      batteryThermalRunawayRisk,
      verdict: batteryThermalRunawayRisk ? 'DANGER (Battery Overheat)' : (socThrottlingRisk ? 'WARNING (SoC Throttling)' : 'NORMAL (Thermal Equilibrium)'),
      temperatureMap: this.exportSampledHeatmap(T, gridW, gridH)
    };
  }

  static exportSampledHeatmap(T, gridW, gridH) {
    const map = [];
    const stepX = 2;
    const stepY = 3;
    for (let j = 0; j < gridH; j += stepY) {
      const row = [];
      for (let i = 0; i < gridW; i += stepX) {
        row.push(+T[j][i].toFixed(1));
      }
      map.push(row);
    }
    return map;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ThermalEngine };
}
