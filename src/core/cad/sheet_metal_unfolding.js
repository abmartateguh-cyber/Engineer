/**
 * OmniEng Experimental Sheet Metal Unfolding & K-Factor Example
 * 
 * Illustrates sheet metal flat-pattern calculations:
 * 1. Exact neutral axis K-factor formulation: BA = (pi/180) * theta * (R + K * T).
 * 2. Setback (OSB) and Bend Deduction: BD = 2 * (R + T) * tan(theta / 2) - BA.
 * 3. Automated corner reliefs (rectangular, tear, obround) to eliminate stress concentration.
 * 4. 2D Flat blank generation with bend lines, angles, and tooling punch direction.
 * 
 * No material-specific bend data, manufacturing validation, or comparison to commercial CAD
 * systems is established.
 */

'use strict';

class SheetMetalBend {
  /**
   * @param {Object} spec
   * @param {number} spec.angleDeg - Included bend angle in degrees (e.g. 90.0)
   * @param {number} spec.innerRadiusMm - Tooling punch radius R (mm)
   * @param {number} spec.thicknessMm - Material sheet thickness T (mm)
   * @param {number} [spec.kFactor=0.44] - Neutral axis ratio K (typical 0.33 to 0.50)
   * @param {string} [spec.direction='UP'] - Bend direction 'UP' or 'DOWN'
   */
  constructor(spec = {}) {
    this.angleDeg = spec.angleDeg || 90.0;
    this.innerRadiusMm = spec.innerRadiusMm || 3.0;
    this.thicknessMm = spec.thicknessMm || 2.0;
    this.kFactor = spec.kFactor !== undefined ? spec.kFactor : 0.44; // Default cold rolled steel
    this.direction = spec.direction || 'UP';

    this.calculateBendParameters();
  }

  calculateBendParameters() {
    const thetaRad = (this.angleDeg * Math.PI) / 180.0;
    const R = this.innerRadiusMm;
    const T = this.thicknessMm;
    const K = this.kFactor;

    // 1. Bend Allowance (BA): Arc length along the neutral axis
    this.bendAllowanceMm = thetaRad * (R + K * T);

    // 2. Outside Setback (OSB): Distance from apex to bend tangent point
    this.outsideSetbackMm = (R + T) * Math.tan(thetaRad / 2.0);

    // 3. Bend Deduction (BD): Length subtracted from sum of flange lengths
    this.bendDeductionMm = 2.0 * this.outsideSetbackMm - this.bendAllowanceMm;
  }
}

class SheetMetalFlange {
  constructor(name, lengthMm, widthMm) {
    this.name = name;
    this.lengthMm = lengthMm;
    this.widthMm = widthMm;
  }
}

class SheetMetalUnfolder {
  /**
   * Unfolds a multi-flange sheet metal part into a flat blank
   * @param {Object} partSpec
   * @param {SheetMetalFlange[]} partSpec.flanges - Array of planar flanges
   * @param {SheetMetalBend[]} partSpec.bends - Array of bends connecting flanges
   * @param {string} [partSpec.reliefType='rectangular'] - 'rectangular', 'tear', 'obround'
   * @param {number} [partSpec.reliefWidthMm=2.5]
   * @param {number} [partSpec.reliefDepthMm=3.0]
   * @returns {Object} 2D Flat pattern geometry with cut profile and bend lines
   */
  static unfoldPart(partSpec) {
    const flanges = partSpec.flanges || [];
    const bends = partSpec.bends || [];
    const reliefType = partSpec.reliefType || 'rectangular';
    const reliefWidth = partSpec.reliefWidthMm || 2.5;
    const reliefDepth = partSpec.reliefDepthMm || 3.0;

    let totalDevelopedLength = 0;
    const flatFlanges = [];
    const bendLines = [];

    let currentOffset = 0;
    for (let i = 0; i < flanges.length; i++) {
      const flange = flanges[i];
      flatFlanges.push({
        name: flange.name,
        startX: currentOffset,
        length: flange.lengthMm,
        endX: currentOffset + flange.lengthMm,
        width: flange.widthMm
      });
      currentOffset += flange.lengthMm;

      if (i < bends.length) {
        const bend = bends[i];
        // In DIN 6935 / ANSI, developed length = L1 + L2 - BD
        // In unfolded blank layout, the bend region has width = Bend Allowance (BA)
        const bendStartX = currentOffset - bend.outsideSetbackMm;
        const bendCenterLineX = bendStartX + bend.bendAllowanceMm / 2.0;

        bendLines.push({
          bendIndex: i + 1,
          x: bendCenterLineX,
          angleDeg: bend.angleDeg,
          direction: bend.direction,
          bendAllowanceMm: Number(bend.bendAllowanceMm.toFixed(3)),
          bendDeductionMm: Number(bend.bendDeductionMm.toFixed(3)),
          radiusMm: bend.innerRadiusMm,
          kFactor: bend.kFactor
        });

        // Advance layout by (Bend Allowance - 2*Setback) effectively subtracting BD
        currentOffset -= bend.bendDeductionMm;
      }
    }

    totalDevelopedLength = currentOffset;

    // Generate corner relief geometry
    const reliefs = [];
    for (const bl of bendLines) {
      reliefs.push({
        type: reliefType,
        x: bl.x,
        y: 0,
        width: reliefWidth,
        depth: reliefDepth
      });
      reliefs.push({
        type: reliefType,
        x: bl.x,
        y: flanges[0] ? flanges[0].widthMm : 100.0,
        width: reliefWidth,
        depth: reliefDepth
      });
    }

    return {
      success: true,
      totalDevelopedLengthMm: Number(totalDevelopedLength.toFixed(3)),
      flangesCount: flanges.length,
      bendsCount: bends.length,
      bendLines,
      reliefs,
      flatFlanges,
      dxfExportReady: true
    };
  }
}

module.exports = {
  SheetMetalBend,
  SheetMetalFlange,
  SheetMetalUnfolder
};
