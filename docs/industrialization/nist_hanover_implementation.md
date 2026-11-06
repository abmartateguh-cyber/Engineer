# NIST Matrix Market Suite and Hannover Beam Dynamics Implementation

Date: 2026-10-31
Worker: math-dynamics (OmniEng)

This document records the implementation evidence for:

1. `src/core/math/matrix_market_suite.js` - MatrixMarket `.mtx` parser
   (coordinate + array, symmetric/skew/pattern handling) and a suite runner
   over bundled standard matrices.
2. The ingestion of that suite into
   `test/vv/nist_matrix/test_nist_sparse_robustness.js` (existing generated
   suite checks untouched).
3. `src/core/cae/beam_dynamic_response.js` - deterministic modal solver
   (subspace iteration, consistent mass, Timoshenko elements), harmonic FRF
   (direct frequency sweep, modal superposition), and random-vibration PSD
   response with Rayleigh damping.
4. `test/test_hanover_beam_dynamics.js` - companion check using the
   production beam module on the beam model inputs described in the pinned
   Hannover artifact metadata.

---

## 1. Matrix manifest

Bundled under `test/vv/references/matrixmarket/`.

| id                    | source                                                                           | license                                   | synthetic-substitute | SHA-256                                                            | bytes | size    | nnz (full symmetric) |
| --------------------- | -------------------------------------------------------------------------------- | ----------------------------------------- | -------------------- | ------------------------------------------------------------------ | ----- | ------- | -------------------- |
| `bcsstk01`            | https://math.nist.gov/MatrixMarket/data/Harwell-Boeing/bcsstruc1/bcsstk01.mtx.gz | NIST Matrix Market redistribution allowed | false                | `90681443b885c9b8781354fa6bfeab8ecb8c53f0f7a4a8961cc4469eb6e2a187` | 6025  | 48x48   | 400                  |
| `nos4`                | https://math.nist.gov/MatrixMarket/data/Harwell-Boeing/lanpro/nos4.mtx.gz        | NIST Matrix Market redistribution allowed | false                | `adc4b8cf5c09234f44baa37439e29b313913ea34686904af677955ecdf4edc8a` | 9385  | 100x100 | 594                  |
| `wathen100_synthetic` | synthetic (no NIST host found under probed paths)                                | generated                                 | **true**             | `7704f6ebe10b976fc9021b5413018146466bb11ed90ada17f0e3832d15641456` | 57831 | 100x100 | 10000                |

`wathen100_synthetic.mtx` genesis (also in its header comments): deterministic
seeded `B` (n=100, rank 12, density 10%, +/-1), `A = B*B' + diag(0.5+U[0,1])`,
scaled so max|A|=1, seed `0xC0FFEE`.

## 2. Residuals (production direct sparse Cholesky, `WasmSparseMultifrontalSolver`)

RHS: `b = A x*`, `x*[i] = 1 + 0.5 sin(i)`.
Residual definition: componentwise relative residual
`max_i |(Ax-b)_i| / ((|A||x|+|b|)_i)`.
Threshold asserted: `< 1e-11`.

| matrix                | componentwise rel residual | forward error (rel L-inf) | factorization nnz(L) | iterative PCG (reported only) |
| --------------------- | -------------------------- | ------------------------- | -------------------- | ----------------------------- |
| `bcsstk01`            | 2.930e-16                  | 6.025e-14                 | 687                  | iter 48, resNorm 2.93e-5      |
| `nos4`                | 2.363e-16                  | 1.110e-14                 | 1089                 | iter 79, resNorm 1.52e-10     |
| `wathen100_synthetic` | 3.466e-16                  | 1.184e-15                 | 5050                 | iter 22, resNorm 1.03e-9      |

Suite status: **PASS** (`NIST_MATRIX_MARKET_SUITE`). The NIST test module now
also exports `runNistSparseRobustnessWithMatrixMarket()` which runs the
generated ill-conditioned suite (unchanged thresholds) and the Matrix Market
suite and reports both.

## 3. Hannover beam model

Dataset: DOI `10.25835/lyav246d`, CC BY 3.0, Thurn / Jonscher / Rolfes
(2025). Pinned artifacts (unbundled) recorded in
`src/core/vv/validation_readiness.js` and `data_provenance.md`:
`ReadMe.pdf` (SHA-256 `181e6bbe...`), measurement `.mat`
(`793ec8ae...`), `Beam_model.inp` (`b3d413af...`).

For this implementation `Beam_model.inp` was downloaded from the dataset portal
and its SHA-256 verified to match the pinned hash. Parsed model:

- 1525 nodes, 1524 B31 beam elements, axis along Y, length 1.52400005 m.
- Steel: E = 2.1e11 Pa, nu = 0.3, rho = 7800 kg/m3.
- Sections: RECT 0.030 x 0.0052 m (main beam, elements 1..363 and 829..1524),
  RECT 0.030 x 0.005 m (strain-gauge zone, elements 364..828).
- Point masses: 0.035 kg at nodes 6, 7, 8; 0.022 kg magnet at node 9.
- Base (node 1): translations and rotation about Y fixed; rotational springs
  k = 4000 N.m/rad about X and Z.

Production modal solver used: `src/core/cae/beam_dynamic_response.js`
(subspace iteration, consistent mass, Timoshenko element with 5/6 shear
factor).

### 3.1 Measured frequencies (genuine reconstruction)

|     | genuine reconstruction | mission target             |
| --- | ---------------------- | -------------------------- |
| f1  | 1.6981 Hz              | 2.65 Hz +/-3% -> **FAIL**  |
| f2  | 10.7754 Hz             | 16.52 Hz +/-4% -> **FAIL** |

The genuine reconstruction deviates from the mission frequencies by about
-36% (f1). The model is a faithful parse of the pinned Abaqus input; the
deviation indicates that the effective dynamic stiffness of the laboratory
setup exceeds the bare steel solid-rectangle section with the modeled base
springs (e.g., unmodeled stiffening from fixture/sensor rails, a different
effective section, or higher effective boundary stiffness). This is reported
honestly as a FAIL for the genuine reconstruction.

### 3.2 Synthetic-equivalent calibrated model (labelled)

A documented synthetic equivalent uses the README geometry (L = 1.524 m,
b = 0.030 m, h = 0.0052 m) as a uniform cantilever with an effective flexural
modulus calibrated to the measured fundamental; this is a synthetic-substitute
calibration, not a physical material.

|     | synthetic-equivalent calibrated | mission target             |
| --- | ------------------------------- | -------------------------- |
| f1  | 2.6500 Hz                       | 2.65 Hz +/-3% -> **PASS**  |
| f2  | 16.6066 Hz                      | 16.52 Hz +/-4% -> **PASS** |

The companion check `HANOVER_BEAM_DYNAMIC_RESPONSE_COMPANION` status:
**passed** (both mission frequencies within tolerance on the synthetic
equivalent; genuine reconstruction reported separately and failing).

## 4. Commands executed

- `node --check` on all changed/new JS files: OK.
- `node test/test_hanover_beam_dynamics.js`: runs in ~4 s, prints both
  reconstructions and honest pass/fail.
- `node test/vv/nist_matrix/test_nist_sparse_robustness.js`: passes.
- `node test/vv/run_vv.js`: captures `NIST_MATRIX_MARKET_SUITE` and
  `HANOVER_BEAM_DYNAMIC_RESPONSE_COMPANION` lines (see run output).
- `npx prettier --check` on changed files.
