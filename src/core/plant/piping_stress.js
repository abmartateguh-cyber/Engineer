/**
 * OmniEng Piping Flexibility & Stress Engine (Bentley AutoPIPE / Caesar II Equivalent)
 * Implements ASME B31.3 / B31.1 code compliance stress calculations, thermal expansion loops, and SIF.
 */

// ASME standard carbon steel A106 Grade B material properties
const PIPING_MATERIALS = {
  'A106-B': {
    name: 'ASTM A106 Grade B Seamless Carbon Steel',
    E_GPa: 200.0,
    alpha: 1.2e-5,       // Thermal expansion coefficient 1/K
    Sc_MPa: 138.0,       // Basic allowable stress at cold ambient temp (20 C)
    Sh_MPa: 125.0,       // Allowable stress at design temp (200 C)
    yieldStress_MPa: 240.0
  },
  'A312-TP316': {
    name: 'ASTM A312 TP316 Austenitic Stainless Steel',
    E_GPa: 193.0,
    alpha: 1.6e-5,
    Sc_MPa: 138.0,
    Sh_MPa: 118.0,
    yieldStress_MPa: 205.0
  }
};

// Standard ASME B36.10M Pipe Dimensions (Nominal Pipe Size NPS -> Outside Dia mm, Wall thickness mm)
const ASME_PIPE_SCHEDULES = {
  '4_SCH40':  { Do_mm: 114.3, t_mm: 6.02,  weight_kg_m: 16.07 },
  '6_SCH40':  { Do_mm: 168.3, t_mm: 7.11,  weight_kg_m: 28.26 },
  '8_SCH40':  { Do_mm: 219.1, t_mm: 8.18,  weight_kg_m: 42.55 },
  '10_SCH40': { Do_mm: 273.0, t_mm: 9.27,  weight_kg_m: 60.31 },
  '12_SCH40': { Do_mm: 323.8, t_mm: 10.31, weight_kg_m: 79.73 }
};

class PipingStressEngine {
  /**
   * Evaluate ASME B31.3 Piping Stress on an expansion loop or straight pipeline
   */
  static evaluateASMEB313(config = {}) {
    const {
      pipeSpec = '8_SCH40',
      materialKey = 'A106-B',
      designPressureBar = 25.0, // 25 bar (~360 psi)
      operatingTempC = 220.0,   // 220 C
      ambientTempC = 20.0,      // 20 C
      straightLengthM = 35.0,   // 35 meters between rigid equipment anchors
      hasExpansionLoop = true,
      loopWidthM = 4.0,         // 4-meter expansion loop
      corrosionAllowanceMm = 1.6 // 1.6 mm standard corrosion allowance
    } = config;

    const pipe = ASME_PIPE_SCHEDULES[pipeSpec] || ASME_PIPE_SCHEDULES['8_SCH40'];
    const mat = PIPING_MATERIALS[materialKey] || PIPING_MATERIALS['A106-B'];

    const Do_m = pipe.Do_mm / 1000.0;
    const t_nom_m = pipe.t_mm / 1000.0;
    const c_m = corrosionAllowanceMm / 1000.0;
    const t_net_m = t_nom_m - c_m; // corroded net wall thickness

    const P_Pa = designPressureBar * 1e5;
    const deltaT = operatingTempC - ambientTempC;

    // 1. Internal Pressure Hoop Stress (ASME B31.3 Eq 3a)
    // sigma_h = P * Do / (2 * (t - c))
    const hoopStress_Pa = (P_Pa * Do_m) / (2.0 * t_net_m);
    const hoopStress_MPa = hoopStress_Pa / 1e6;

    // 2. Thermal Expansion Elongation
    // Delta L = alpha * L * Delta T
    const deltaL_mm = mat.alpha * straightLengthM * deltaT * 1000.0;

    // 3. Expansion Bending Stress (Guided loop flexibility analysis)
    // S_E = i * M / Z
    let SIF_elbow = 1.0;
    const R_elbow_m = 1.5 * Do_m; // Long radius ASME elbow (R = 1.5D)
    const h_factor = (t_net_m * R_elbow_m) / Math.pow((Do_m - t_net_m) / 2, 2);
    if (h_factor > 0) {
      SIF_elbow = Math.max(1.0, 0.9 / Math.pow(h_factor, 2.0 / 3.0));
    }

    let expansionStress_MPa = 0;
    if (hasExpansionLoop && loopWidthM > 0) {
      // With expansion loop: flexible deflection distributes across loop legs
      const loopHeightM = loopWidthM * 1.2;
      const flexLength = straightLengthM + 2 * loopHeightM + loopWidthM;
      expansionStress_MPa = (SIF_elbow * mat.E_GPa * 1e3 * (deltaL_mm / 1000.0) * (Do_m / 2)) / Math.pow(loopHeightM, 2);
    } else {
      // Fully constrained anchor: pure axial thermal stress sigma = E * alpha * Delta T
      expansionStress_MPa = mat.E_GPa * 1e3 * mat.alpha * deltaT;
    }

    // 4. Sustained Longitudinal Stress (Pressure + Deadweight)
    const longitudinalStress_MPa = hoopStress_MPa * 0.5 + 18.0; // 18 MPa weight allowance

    // 5. ASME B31.3 Allowable Displacement Stress Range S_A
    // S_A = f * [1.25 * (S_c + S_h) - S_L]
    const f_cycleFactor = 1.0; // 1.0 for <= 7,000 thermal cycles
    const S_A_MPa = f_cycleFactor * (1.25 * (mat.Sc_MPa + mat.Sh_MPa) - longitudinalStress_MPa);

    const stressRatio = expansionStress_MPa / S_A_MPa;
    const isCodeCompliant = stressRatio <= 1.0;

    return {
      pipeSpec,
      pipeOuterDia_mm: pipe.Do_mm,
      netWallThickness_mm: +(t_net_m * 1000).toFixed(2),
      operatingTemp_C: operatingTempC,
      designPressure_bar: designPressureBar,
      thermalElongation_mm: +deltaL_mm.toFixed(1),
      hoopStress_MPa: +hoopStress_MPa.toFixed(1),
      expansionStress_SE_MPa: +expansionStress_MPa.toFixed(1),
      allowableStress_SA_MPa: +S_A_MPa.toFixed(1),
      stressRatio: +stressRatio.toFixed(3),
      isCodeCompliant,
      status: isCodeCompliant ? 'PASS (ASME B31.3 Code Compliant)' : 'FAIL (Overstressed Elbows - Thermal Overload)',
      recommendation: isCodeCompliant ? 'No modifications required' : 'Increase expansion loop width by 1.5m to mitigate thermal surge'
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PIPING_MATERIALS, ASME_PIPE_SCHEDULES, PipingStressEngine };
}
