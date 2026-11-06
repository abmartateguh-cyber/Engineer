# Optics / EDA Implementation — ISO 10110 Tolerance Evaluator & Liberty (.lib) Parser

## 1. Overview

This workstream adds two deterministic, dependency-free production modules to OmniEng:

| Module                                            | Purpose                                                                                                                                              |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/optics/iso10110_tolerance_evaluator.js` | ISO 10110 drawing-notation callout parser, 37-term Zernike modal wavefront decomposition, Strehl-ratio (Maréchal) evaluation                         |
| `src/core/eda/liberty_parser.js`                  | Parser for a practical subset of Liberty (.lib) timing libraries with bilinear NLDM table interpolation; fails closed on malformed/unsupported input |

Verification:

- `test/vv/optics/test_iso10110_tolerance.js` — keeps the existing plane-parallel plate OPD check and adds evaluator checks (callout parsing, manufactured-coefficient recovery, RMSWFE, Strehl, malformed rejection).
- `test/test_liberty_parser.js` — inline `.lib` snippet parse, exact corner values, interpolation continuity, malformed-input rejection.

## 2. ISO 10110 drawing-notation callout parser

Drawing callouts follow the form:

```
<section>/<value>(<param>/<param>...)
```

Examples:

- `3/A(B/C)` — surface form tolerance (section 3), value `A`, parameters `B`, `C`
- `4/σ` — inhomogeneity tolerance (section 4), value `σ`, no parameters
- `13/A(B/C)` — laser damage threshold (section 13), value `A`, parameters `B`, `C`
- `13/25(1064/1.5)` — numeric value and numeric parameters

API:

- `parseIso10110Callout(text)` → `{ text, section, sectionText, value, params }`; throws `Error` on malformed input (fail closed).
- `isValidIso10110Callout(text)` → boolean.
- `formatIso10110Callout(parsed)` → canonical round-trip string.

Rejected forms (each raises): empty input, missing or multiple `/` separators, non-numeric section, missing value, whitespace inside value, unbalanced/missing parentheses, empty parameter list, nested parentheses, empty parameter tokens.

## 3. 37-term Zernike modal decomposition

### 3.1 Indexing conventions

Two 37-term orderings are supported (`indexing: 'fringe' | 'standard'`):

- **Fringe** (Wyant/Creath): piston (1), tilts (2,3), defocus (4), astigmatism (5,6), coma (7,8), primary spherical (9), then grouped by radial degree up to `n=10` (terms 10–37).
- **Standard** (Noll): Noll index ordering 1–37 (grouped by radial degree with all azimuthal orders per degree).

Both tables map each 1-based index to `(n, m)`. The full mode tables are exported as `FRINGE_NM` and `STANDARD_NM`.

### 3.2 Orthonormal basis

Polynomials use the radial Zernike polynomial

```
R_n^{|m|}(ρ) = Σ_{s=0}^{(n-|m|)/2} (-1)^s (n-s)! / (s! ((n+|m|)/2 - s)! ((n-|m|)/2 - s)!) · ρ^{n-2s}
```

with azimuthal factor `cos(|m|θ)` for `m > 0`, `sin(|m|θ)` for `m < 0`, `1` for `m = 0`. Normalization is `sqrt(n+1)` (`m=0`) or `sqrt(2(n+1))` (`m≠0`), which makes the basis orthonormal under the mean-over-unit-disk inner product

```
<f,g> = (1/π) ∫∫_disk f·g dA
```

Consequence: for orthonormal coefficients `c_j`, the RMS wavefront error (piston at index 0 excluded) is

```
RMSWFE = sqrt(Σ_{j≥2} c_j²)
```

### 3.3 Coefficient recovery

Two recovery paths, both deterministic:

1. **Exact modal projection** on the built-in quadrature grid (`createZernikeQuadratureGrid`): 21-point Gauss–Legendre radial rule in `ρ ∈ [0,1]` × 32-point uniform trapezoid rule in `θ ∈ [0, 2π)`. The grid integrates polynomials of Zernike total degree ≤ 10 exactly (radial degree ≤ 41, harmonic degree ≤ 20), so coefficients of any synthesized wavefront are recovered to floating-point precision. Sum of grid weights = `π`.
2. **General least-squares fit** (`decomposeZernike` on arbitrary sample points) via Householder QR (`qrSolve`), recommended with an oversampled, well-distributed unit-disk point set.

API:

- `createZernikeQuadratureGrid({radialPoints, angularPoints})`
- `synthesizeZernikeOpd(coeffs, points)`
- `projectZernikeCoefficients(opd, grid)`
- `decomposeZernike(opd, points)` — auto-selects projection when a weight-carrying grid is passed
- `zernikeModeByIndex(index, {indexing})`, `zernikeBasis({indexing})`, `zernikePolynomial(index, x, y, {indexing})`

## 4. Strehl ratio

Maréchal / small-aberration approximation:

```
Strehl ≈ exp(-(2π · RMSWFE / λ)²)
```

API:

- `strehlRatio(rmsWfe, {wavelength})` — accepts RMS in the same units as `wavelength` (or in waves when wavelength is omitted).
- `strehlFromOpd(opd, points, {wavelength})` — decompose → RMSWFE → Strehl in one call.

## 5. Liberty (.lib) parser

### 5.1 Supported subset

Lexical layer: identifiers, numbers, quoted strings, comments (`//`, `/* */`), punctuation `{ } ( ) : ; ,`; strict rejection of illegal characters and unterminated strings/comments.

Grammar subset:

```
library (name) {
  delay_model : table_lookup;            // + time_unit, capacitance_unit,
  ...                                    //   voltage_unit, current_unit,
                                         //   resistance_unit, leakage_power_unit
  cell (name) {
    area : 1.8;
    cell_leakage_power : 0.0001;
    pin (name) {
      direction : input | output | inout;
      capacitance : 0.002;
      max_capacitance / min_capacitance : <number>;
      timing () {
        related_pin : "A";
        timing_type : rising_edge | falling_edge;
        cell_rise (template) { index_1(...); index_2(...); values(...); }
        cell_fall / rise_transition / fall_transition: same
        // or scalar: cell_rise (0.07);
      }
    }
  }
}
```

`values(...)` accepts quoted comma-separated row strings or bare number sequences; rows = `index_1` length, columns = `index_2` length.

### 5.2 Interpolation

`LibertyTable.lookup(x, y)` implements bilinear interpolation with linear extrapolation beyond the index range. Properties verified in tests:

- exact at all table corners;
- continuous across cell boundaries;
- mid-edge values equal the linear average of the edge endpoints.

Scalar arcs return their constant value for any `(slew, load)`.

### 5.3 Fail-closed policy

The parser throws `Error` rather than partially parsing on: unbalanced braces/parentheses, missing semicolons, unknown constructs at any level, duplicate cells/attributes, missing required attributes (`direction`, `related_pin`, `timing_type`, table index/value completeness), non-monotonic indices, table dimension mismatches, non-numeric index/value tokens, unsupported `timing_type`/`direction` values, and empty/missing library declaration.

## 6. Verification results

### 6.1 ISO 10110 evaluator (`node test/vv/optics/test_iso10110_tolerance.js`)

Checks executed: existing plane-parallel plate OPD ray-trace check + evaluator check.

Measured values (deterministic run):

| Quantity                                                           | Value                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------- |
| Max coefficient error, quadrature projection                       | < 1e-12 (tolerance 1e-9)                                |
| Max coefficient error, QR least-squares (300 deterministic points) | < 1e-9 (tolerance 1e-6)                                 |
| RMSWFE (manufactured set)                                          | ≈ 0.03497 µm — finite, positive                         |
| Strehl at λ = 0.55 µm                                              | ≈ 0.8525 — exceeds 0.80                                 |
| Callout round-trip                                                 | `3/A(B/C)` → `3/A(B/C)`; 11 malformed callouts rejected |

Manufactured coefficients: defocus 0.025, astigmatism 0.020, coma y 0.010, primary spherical 0.008, secondary spherical 0.005, mode (8,2) 0.003.

### 6.2 Liberty parser (`node test/test_liberty_parser.js`)

Checks: library header/units, cell/pin population, timing arcs, exact corner values (`0.020`, `0.110`, `0.045`, …), bilinear continuity, scalar arcs, and 17 malformed-input rejections. All pass.

## 7. Determinism & dependencies

- No external dependencies; all math implemented in-file (factorials, Gauss–Legendre via Newton iteration on Legendre polynomials, Householder QR).
- The least-squares sampling check uses a fixed-seed mulberry32 PRNG, so test output is reproducible across runs/platforms.
- All results reported above are from `node` v24.16.0.

## 8. Limitations

- ISO 10110 callout parsing is syntactically generic (section/value/params) and does not enforce per-section semantic rules (e.g., units for section 3 vs. section 13).
- Fringe table follows the Wyant/Creath 37-term ordering; the exact term order varies slightly across vendor literature, but recovery is self-consistent for any complete orthonormal basis.
- Liberty parser accepts a deliberately narrow subset; constructs outside it (e.g., `lu_table_template`, `operating_conditions`, CCS arcs) are rejected, not skipped.
- Bilinear interpolation is linear (NLDM), not higher-order; index vectors must be strictly increasing.
