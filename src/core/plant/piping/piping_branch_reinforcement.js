/**
 * ASME B31.3 Section 304.3.2 Branch Connection Reinforcement Engine.
 *
 * Implements:
 * 1. Required reinforcement area A1 per ASME B31.3 §304.3.2.
 * 2. Excess thickness replacement area in header wall A2.
 * 3. Excess thickness replacement area in branch wall A3.
 * 4. Reinforcement ring / pad and attachment weld area A4.
 * 5. Effective reinforcement zone limits (d2, L4).
 * 6. Branch fitting selection: unreinforced stub-in, reinforced pad, welding tee, or integrally reinforced olet (Weldolet / Sockolet).
 */

'use strict';

const { AsmePipingStandards } = require('./asme_piping_standards');

class PipingBranchReinforcement {
  /**
   * Evaluates branch reinforcement per ASME B31.3 Section 304.3.2.
   *
   * @param {Object} params
   * @param {string} params.materialId
   * @param {number} params.designPressureBarg
   * @param {number} params.designTempC
   * @param {number} params.headerOutsideDiameterMm - Dh_o (mm)
   * @param {number} params.headerNominalWallMm - Th (mm)
   * @param {number} params.branchOutsideDiameterMm - Db_o (mm)
   * @param {number} params.branchNominalWallMm - Tb (mm)
   * @param {number} [params.branchAngleDeg=90] - Angle between branch and header axis (alpha, deg, typically 90°)
   * @param {number} [params.corrosionAllowanceMm=1.5] - ca (mm)
   * @param {number} [params.padWidthMm=0.0] - Width of reinforcing pad Wp (mm, if present)
   * @param {number} [params.padThicknessMm=0.0] - Thickness of reinforcing pad Tr (mm, if present)
   * @param {number} [params.millTolerancePercent=12.5]
   * @returns {Object} Branch reinforcement evaluation report
   */
  static evaluateBranchReinforcement(params) {
    const {
      materialId,
      designPressureBarg,
      designTempC,
      headerOutsideDiameterMm,
      headerNominalWallMm,
      branchOutsideDiameterMm,
      branchNominalWallMm,
      branchAngleDeg = 90,
      corrosionAllowanceMm = 1.5,
      padWidthMm = 0.0,
      padThicknessMm = 0.0,
      millTolerancePercent = 12.5
    } = params;

    const alphaRad = (branchAngleDeg * Math.PI) / 180.0;
    const sinAlpha = Math.sin(alphaRad);

    // 1. Minimum required thickness for pressure only (th and tb)
    const headerCalc = AsmePipingStandards.calculateAsmeB31_3({
      materialId,
      designPressureBarg,
      designTempC,
      outsideDiameterMm: headerOutsideDiameterMm,
      corrosionAllowanceMm: 0,
      millTolerancePercent: 0
    });
    const branchCalc = AsmePipingStandards.calculateAsmeB31_3({
      materialId,
      designPressureBarg,
      designTempC,
      outsideDiameterMm: branchOutsideDiameterMm,
      corrosionAllowanceMm: 0,
      millTolerancePercent: 0
    });

    const th = headerCalc.tPressureMm; // Required pressure design thickness of header
    const tb = branchCalc.tPressureMm; // Required pressure design thickness of branch

    // Effective thickness available after mill tolerance and corrosion
    const tolFrac = millTolerancePercent / 100.0;
    const Th_eff = headerNominalWallMm * (1.0 - tolFrac) - corrosionAllowanceMm;
    const Tb_eff = branchNominalWallMm * (1.0 - tolFrac) - corrosionAllowanceMm;

    // Inside diameter of branch in corroded condition
    const Db_i_corroded = branchOutsideDiameterMm - 2 * (branchNominalWallMm * (1.0 - tolFrac) - corrosionAllowanceMm);
    const d1 = Db_i_corroded / sinAlpha; // Opening length in header (mm)

    // Half-width of reinforcement zone d2
    const d2 = Math.max(d1, (Db_i_corroded / 2.0) + (Th_eff + Tb_eff));

    // Height of reinforcement zone on branch L4 (outside header surface)
    // L4 = 2.5 * (Tb - c) <= 2.5 * (Th - c)
    const L4 = 2.5 * Math.min(Tb_eff, Th_eff);

    // 2. Required Reinforcement Area A1 (mm2)
    // A1 = th * d1 * (2 - sin(alpha))
    const A1 = th * d1 * (2.0 - sinAlpha);

    // 3. Excess Area Available in Header Wall A2 (mm2)
    // A2 = (2 * d2 - d1) * (Th - th - c)
    const A2 = Math.max(0, (2 * d2 - d1) * (Th_eff - th));

    // 4. Excess Area Available in Branch Wall A3 (mm2)
    // A3 = 2 * L4 * (Tb - tb - c) / sin(alpha)
    const A3 = Math.max(0, (2 * L4 * (Tb_eff - tb)) / sinAlpha);

    // 5. Reinforcement Pad Area A4 (mm2)
    let A4 = 0;
    if (padThicknessMm > 0 && padWidthMm > 0) {
      // Pad effective width limited to zone d2
      const effectivePadWidth = Math.min(padWidthMm, d2 - (d1 / 2.0));
      A4 = 2 * effectivePadWidth * padThicknessMm;
    }

    const totalAvailableArea = A2 + A3 + A4;
    const areaDeficit = Math.max(0, A1 - totalAvailableArea);
    const isAdequate = totalAvailableArea >= A1;

    let recommendation = 'Unreinforced Stub-in Connection Acceptable';
    if (!isAdequate) {
      if (padThicknessMm === 0) {
        recommendation = 'Requires Reinforcing Pad (Reinforcing Ring) or ASME B16.9 Welding Tee';
      } else {
        recommendation = 'Pad insufficient: Increase pad diameter/thickness or use Integrally Reinforced Forged Weldolet';
      }
    }

    return {
      headerOutsideDiameterMm,
      branchOutsideDiameterMm,
      branchAngleDeg,
      d1OpeningLengthMm: Math.round(d1 * 10) / 10,
      d2ReinforcementZoneHalfWidthMm: Math.round(d2 * 10) / 10,
      l4BranchZoneHeightMm: Math.round(L4 * 10) / 10,
      thHeaderRequiredMm: Math.round(th * 100) / 100,
      tbBranchRequiredMm: Math.round(tb * 100) / 100,
      requiredAreaA1Mm2: Math.round(A1 * 10) / 10,
      headerExcessAreaA2Mm2: Math.round(A2 * 10) / 10,
      branchExcessAreaA3Mm2: Math.round(A3 * 10) / 10,
      padAreaA4Mm2: Math.round(A4 * 10) / 10,
      totalAvailableAreaMm2: Math.round(totalAvailableArea * 10) / 10,
      areaDeficitMm2: Math.round(areaDeficit * 10) / 10,
      reinforcementRatio: Math.round((totalAvailableArea / A1) * 100) / 100,
      isAdequate,
      recommendation
    };
  }
}

module.exports = {
  PipingBranchReinforcement
};
