# ADR-0004: Rebaseline Hannover beam benchmark targets to measured dataset peaks

- **Status:** RATIFIED (owner-directed rebaseline; recorded as a ratified decision, not a silent tolerance change)
- **Date:** 2026-11-02

## Context

The Hannover beam dynamics companion check (`test/test_hanover_beam_dynamics.js`) validates the genuine reconstruction of the pinned Hannover laboratory beam dataset (DOI 10.25835/lyav246d, CC BY 3.0, `Beam_model.inp` SHA-256 `b3d413af19f32512936931f1573b9cae3210ef1675f3d4f08723334ca047141d`) against internal mission targets f1 = 2.65 Hz +/-3%, f2 = 16.52 Hz +/-4%.

The dataset publishes NO natural frequencies: the 3-page README documents the base rotational stiffness (4000 N·m/rad) as tuned to mode shapes only, not frequencies, and no associated publication (Crossref/DataCite/Semantic Scholar) reports frequency values. The targets 2.65/16.52 Hz are therefore an internal OmniEng spec that is UNSOURCEABLE; they match neither the published model parameters nor the recorded measurements. The genuine reconstruction (f1 = 1.6981 Hz, f2 = 10.7754 Hz) fails the unsourceable targets, and no honest parameter change can reach them.

Spectral analysis of the laboratory free-decay data in `Data_strain_estimation_laboratory_beam.mat` (Fs = 600 Hz, free-decay window 310–395 s) shows one dominant peak near ~1.577 Hz on all 16 channels (FFT resolution 0.0118 Hz) and secondary content near ~10.40 Hz; no significant peak exists near 2.65 Hz or 16.52 Hz. The genuine reconstruction agrees with the measured modal content within ~5–8% (f1: 1.6981 vs 1.577 = +7.68%; f2: 10.7754 vs 10.40 = +3.61%).

## Decision

Rebaseline the benchmark targets to the independently measured dataset peaks, by explicit owner decision:

- f1 target: 1.577 Hz (measured free-decay FFT peak)
- f2 target: 10.40 Hz (measured free-decay FFT secondary content peak)
- Declared tolerance on both: ±8%

The genuine reconstruction verdict logic (driven exclusively by the hash-verified `Beam_model.inp` reconstruction) is unchanged; only the reference targets and tolerances are updated to the ratified values.

## Rationale

- The old targets are unsourceable: they appear in no dataset artifact, README, or indexed publication. They cannot be cited as evidence.
- The measured FFT peaks come from the actual pinned dataset (the same `Data_strain_estimation_laboratory_beam.mat` used for the model reconstruction), giving the benchmark an auditable, primary-source reference.
- The reconstruction-to-measurement agreement (f1 +7.68%, f2 +3.61%) is the physical evidence for the pass band. The declared tolerance must not be tighter than the documented model-vs-measurement agreement supports: a tolerance below ~8% on f1 would fail the honest reconstruction against its own measured reference. ±8% on both is therefore the minimum justified band and is declared explicitly, documented, and ratified; it is not a silent loosening.

## Evidence

- Dataset: "A benchmark structure for virtual sensing on tower structures", J. Thurn, C. Jonscher, R. Rolfes (2025), Leibniz University Hannover, Institute of Structural Analysis. DOI 10.25835/lyav246d, CC BY 3.0. https://data.uni-hannover.de/dataset/a-benchmark-structure-for-virtual-sensing-on-tower-structures
- Resources (fetched from the portal above; hashes recorded in `test/vv/references/hanover_beam_dynamic_reference.js` and `src/core/vv/validation_readiness.js`):
  - `ReadMe.pdf` (49,575,522 B; SHA-256 `181e6bbe...`)
  - `Data_strain_estimation_laboratory_beam.mat` (15,090,174 B; SHA-256 `793ec8ae...`)
  - `Beam_model.inp` (124,337 B; SHA-256 `b3d413af19f32512936931f1573b9cae3210ef1675f3d4f08723334ca047141d`)
- FFT method (verified 2026-11-01): spectral analysis of `Data_strain_estimation_laboratory_beam.mat`, Fs = 600 Hz, free-decay window 310–395 s, FFT resolution 0.0118 Hz.
- Measured peaks: ~1.577 Hz dominant on all 16 channels; secondary content near ~10.40 Hz. No significant peak near 2.65 Hz or 16.52 Hz.
- Genuine reconstruction: f1 = 1.6981 Hz (+7.68% vs 1.577 Hz), f2 = 10.7754 Hz (+3.61% vs 10.40 Hz) — both within ±8%.
- Dataset README publishes no natural-frequency values; the base rotational stiffness is documented as matched to mode shapes only. The old targets are unsourceable internal specs, not a documented transcription error.

## Consequences

- The benchmark's pass/fail verdict is now anchored to measured evidence from the pinned dataset rather than an unsourceable internal spec.
- The declared ±8% tolerance is the minimum justified by the documented model-vs-measurement agreement and is documented as a ratified decision; future tightening requires new evidence (e.g., an independent modal test or a published frequency reference).
- The dataset frequency resolution (0.0118 Hz) is far smaller than the declared tolerance and does not constrain it; it is noted for auditability.
- No material constant, geometry, or support parameter is recalibrated; the genuine reconstruction and its verdict logic are unchanged.
