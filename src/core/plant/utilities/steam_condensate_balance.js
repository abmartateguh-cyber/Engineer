/**
 * Multi-Pressure Steam & Condensate Network Balance Engine.
 *
 * Implements:
 * 1. Multi-tier steam distribution hierarchy:
 *    - HP Header: 42.0 barg, 400.0 °C (HRSG / Fired Boilers)
 *    - MP Header: 12.0 barg, 250.0 °C (Steam turbine extraction, process reboilers)
 *    - LP Header: 3.5 barg, 160.0 °C (Amine reboilers, deaerator, trace heating)
 * 2. PRDS (Pressure Reducing & Desuperheating Stations) rigorous enthalpy balance:
 *    m_spray = m_letdown * (h_upstream - h_target) / (h_target - h_spray)
 * 3. Deaerator Mass & Thermal Energy Balance:
 *    Stripping steam requirement to preheat BFW to 105 °C and scavenge dissolved O2 (< 7 ppb)
 * 4. Condensate return recovery, flash steam generation, and BFW makeup demand.
 */

'use strict';

class SteamCondensateBalance {
  /**
   * Approximate saturated/superheated steam enthalpy (kJ/kg) for standard headers.
   */
  static getSteamEnthalpy(headerType, tempC) {
    if (headerType === 'HP') {
      // 42 barg (4.3 MPa), ~ 400C: h ~ 3210 kJ/kg
      return 3210.0 + (tempC - 400.0) * 2.2;
    }
    if (headerType === 'MP') {
      // 12 barg (1.3 MPa), ~ 250C: h ~ 2930 kJ/kg
      return 2930.0 + (tempC - 250.0) * 2.1;
    }
    if (headerType === 'LP') {
      // 3.5 barg (0.45 MPa), ~ 160C: h ~ 2770 kJ/kg
      return 2770.0 + (tempC - 160.0) * 2.0;
    }
    if (headerType === 'BFW') {
      // Boiler Feedwater at ~ 105C: h ~ 440 kJ/kg
      return 4.184 * tempC;
    }
    if (headerType === 'CONDENSATE') {
      // Condensate return at ~ 85C: h ~ 355 kJ/kg
      return 4.184 * tempC;
    }
    if (headerType === 'MAKEUP') {
      // Demin water makeup at ~ 25C: h ~ 105 kJ/kg
      return 4.184 * tempC;
    }
    return 2800.0;
  }

  /**
   * Calculates desuperheater spray water required for letdown stations.
   *
   * @param {number} inletSteamKgH - Steam flow through pressure letdown valve (kg/h)
   * @param {number} inletEnthalpyKJkg - Superheated steam enthalpy upstream
   * @param {number} targetEnthalpyKJkg - Desuperheated steam enthalpy downstream
   * @param {number} sprayWaterEnthalpyKJkg - Boiler feedwater spray water enthalpy
   * @returns {Object} Desuperheating balance
   */
  static calculateDesuperheaterSpray(inletSteamKgH, inletEnthalpyKJkg, targetEnthalpyKJkg, sprayWaterEnthalpyKJkg) {
    if (inletEnthalpyKJkg <= targetEnthalpyKJkg) {
      return { sprayWaterRequiredKgH: 0, totalDownstreamSteamKgH: inletSteamKgH };
    }
    // Energy balance: m_in * h_in + m_spray * h_spray = (m_in + m_spray) * h_target
    // m_spray = m_in * (h_in - h_target) / (h_target - h_spray)
    const numerator = inletEnthalpyKJkg - targetEnthalpyKJkg;
    const denominator = Math.max(1.0, targetEnthalpyKJkg - sprayWaterEnthalpyKJkg);
    const sprayKgH = (inletSteamKgH * numerator) / denominator;
    return {
      sprayWaterRequiredKgH: Math.round(sprayKgH * 10) / 10,
      totalDownstreamSteamKgH: Math.round((inletSteamKgH + sprayKgH) * 10) / 10
    };
  }

  /**
   * Computes the complete multi-pressure steam network mass and energy balance.
   *
   * @param {Object} plantData
   * @param {Array<Object>} plantData.producers - Steam generators (e.g. HRSG, Boilers)
   * @param {Array<Object>} plantData.consumers - Steam users (e.g. turbines, reboilers, tracing)
   * @param {number} [plantData.boilerBlowdownPercent=2.0] - Continuous boiler blowdown %
   * @param {number} [plantData.condensateReturnRatePercent=80.0] - Recovered condensate %
   * @returns {Object} Comprehensive steam, condensate and BFW balance
   */
  static evaluateNetworkBalance(plantData) {
    const {
      producers = [],
      consumers = [],
      boilerBlowdownPercent = 2.0,
      condensateReturnRatePercent = 80.0
    } = plantData;

    // Default header parameters
    const headers = {
      HP: { name: 'High Pressure Steam', pressureBarg: 42.0, tempC: 400.0, generationKgH: 0, userDemandKgH: 0, letdownInKgH: 0, letdownOutKgH: 0, sprayWaterKgH: 0 },
      MP: { name: 'Medium Pressure Steam', pressureBarg: 12.0, tempC: 250.0, generationKgH: 0, userDemandKgH: 0, letdownInKgH: 0, letdownOutKgH: 0, sprayWaterKgH: 0 },
      LP: { name: 'Low Pressure Steam', pressureBarg: 3.5, tempC: 160.0, generationKgH: 0, userDemandKgH: 0, letdownInKgH: 0, letdownOutKgH: 0, sprayWaterKgH: 0 }
    };

    for (const p of producers) {
      if (headers[p.header]) {
        headers[p.header].generationKgH += (p.flowKgH || 0);
      }
    }

    for (const c of consumers) {
      if (headers[c.header]) {
        headers[c.header].userDemandKgH += (c.flowKgH || 0);
      }
    }

    const h_HP = this.getSteamEnthalpy('HP', headers.HP.tempC);
    const h_MP = this.getSteamEnthalpy('MP', headers.MP.tempC);
    const h_LP = this.getSteamEnthalpy('LP', headers.LP.tempC);
    const h_BFW_spray = this.getSteamEnthalpy('BFW', 105.0);

    // HP Header Balance:
    // Net excess HP steam is let down to MP header via PRDS-01
    const hpDeficit = headers.HP.userDemandKgH - headers.HP.generationKgH;
    let hpLetdownToMPKgH = 0;
    if (hpDeficit < 0) {
      hpLetdownToMPKgH = -hpDeficit; // Excess HP steam
      headers.HP.letdownOutKgH = hpLetdownToMPKgH;
    }

    // PRDS HP -> MP desuperheating
    const prdsHpToMp = this.calculateDesuperheaterSpray(hpLetdownToMPKgH, h_HP, h_MP, h_BFW_spray);
    headers.MP.letdownInKgH = prdsHpToMp.totalDownstreamSteamKgH;
    headers.MP.sprayWaterKgH = prdsHpToMp.sprayWaterRequiredKgH;

    // MP Header Balance:
    const mpSupply = headers.MP.generationKgH + headers.MP.letdownInKgH;
    const mpDeficit = headers.MP.userDemandKgH - mpSupply;
    let mpLetdownToLPKgH = 0;
    if (mpDeficit < 0) {
      mpLetdownToLPKgH = -mpDeficit; // Excess MP steam
      headers.MP.letdownOutKgH = mpLetdownToLPKgH;
    }

    // PRDS MP -> LP desuperheating
    const prdsMpToLp = this.calculateDesuperheaterSpray(mpLetdownToLPKgH, h_MP, h_LP, h_BFW_spray);
    headers.LP.letdownInKgH = prdsMpToLp.totalDownstreamSteamKgH;
    headers.LP.sprayWaterKgH = prdsMpToLp.sprayWaterRequiredKgH;

    // Total steam produced across all boilers
    const totalSteamGeneratedKgH = headers.HP.generationKgH + headers.MP.generationKgH + headers.LP.generationKgH;

    // Boiler blowdown flow
    const boilerBlowdownKgH = totalSteamGeneratedKgH * (boilerBlowdownPercent / 100.0);

    // Condensate Return & Deaerator Mass/Heat Balance
    // Recovered condensate
    const recoveredCondensateKgH = totalSteamGeneratedKgH * (condensateReturnRatePercent / 100.0);
    const h_condensate = this.getSteamEnthalpy('CONDENSATE', 85.0);
    const h_makeup = this.getSteamEnthalpy('MAKEUP', 25.0);
    const h_da_bfw = this.getSteamEnthalpy('BFW', 105.0);

    // Demineralized makeup water and deaerator pegging steam simultaneous balance:
    // Conservation of Mass:   m_cond + m_makeup + m_da_steam = m_BFW
    // Conservation of Energy: m_cond * h_cond + m_makeup * h_makeup + m_da_steam * h_LP = m_BFW * h_da_bfw
    // Substituting m_makeup = m_BFW - m_cond - m_da_steam yields:
    // m_da_steam = [ m_BFW*(h_da_bfw - h_makeup) - m_cond*(h_cond - h_makeup) ] / (h_LP - h_makeup)
    const totalDesuperheatingSprayKgH = headers.MP.sprayWaterKgH + headers.LP.sprayWaterKgH;
    const totalBfwRequiredKgH = totalSteamGeneratedKgH + boilerBlowdownKgH + totalDesuperheatingSprayKgH;

    const numeratorEnergy = (totalBfwRequiredKgH * (h_da_bfw - h_makeup)) - (recoveredCondensateKgH * (h_condensate - h_makeup));
    const denominatorEnergy = Math.max(1.0, h_LP - h_makeup);
    const deaeratorSteamDemandKgH = Math.max(0, numeratorEnergy / denominatorEnergy);

    const makeupWaterRequiredKgH = Math.max(0, totalBfwRequiredKgH - recoveredCondensateKgH - deaeratorSteamDemandKgH);

    // Add deaerator demand to LP header demand
    headers.LP.userDemandKgH += Math.round(deaeratorSteamDemandKgH * 10) / 10;
    const lpSurplusKgH = (headers.LP.generationKgH + headers.LP.letdownInKgH) - headers.LP.userDemandKgH;

    return {
      headers: {
        HP: {
          ...headers.HP,
          netBalanceKgH: Math.round((headers.HP.generationKgH - headers.HP.userDemandKgH - headers.HP.letdownOutKgH) * 10) / 10
        },
        MP: {
          ...headers.MP,
          netBalanceKgH: Math.round((headers.MP.generationKgH + headers.MP.letdownInKgH - headers.MP.userDemandKgH - headers.MP.letdownOutKgH) * 10) / 10
        },
        LP: {
          ...headers.LP,
          netBalanceKgH: Math.round(lpSurplusKgH * 10) / 10
        }
      },
      deaeratorAndBfw: {
        totalSteamGeneratedKgH: Math.round(totalSteamGeneratedKgH * 10) / 10,
        boilerBlowdownKgH: Math.round(boilerBlowdownKgH * 10) / 10,
        boilerBlowdownPercent,
        desuperheaterSprayWaterKgH: Math.round(totalDesuperheatingSprayKgH * 10) / 10,
        totalBfwDemandKgH: Math.round(totalBfwRequiredKgH * 10) / 10,
        condensateReturnedKgH: Math.round(recoveredCondensateKgH * 10) / 10,
        condensateReturnRatePercent,
        demineralizedWaterMakeupKgH: Math.round(makeupWaterRequiredKgH * 10) / 10,
        deaeratorPeggingSteamLPKgH: Math.round(deaeratorSteamDemandKgH * 10) / 10,
        deaeratorOperatingTempC: 105.0,
        deaeratorOperatingPressureBarg: 0.25,
        dissolvedOxygenSpecPpb: '< 7 ppb'
      },
      prdsLetdownStations: [
        {
          tag: 'PRDS-01 (HP -> MP)',
          inletSteamKgH: Math.round(hpLetdownToMPKgH * 10) / 10,
          sprayWaterKgH: headers.MP.sprayWaterKgH,
          outletSteamKgH: headers.MP.letdownInKgH
        },
        {
          tag: 'PRDS-02 (MP -> LP)',
          inletSteamKgH: Math.round(mpLetdownToLPKgH * 10) / 10,
          sprayWaterKgH: headers.LP.sprayWaterKgH,
          outletSteamKgH: headers.LP.letdownInKgH
        }
      ]
    };
  }
}

module.exports = {
  SteamCondensateBalance
};
