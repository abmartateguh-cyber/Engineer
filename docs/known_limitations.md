# Known Limitations

**Release train:** R0. **Maturity:** all registered domains are experimental and not release-approved.

This document describes observed repository behavior. It is not a safety assessment or a substitute for engineering review.

## Engineering calculations and data

- No solver workflow has a complete, independently reviewed evidence package with production-engine results, immutable reference data, tolerances, convergence studies, and performance budgets.
- The legacy numerical, geometry, optics, EDA, controls, and plant modules are development implementations. Their unit labels or internal residuals do not establish accuracy for a real design.
- The former bundled engineering material-property catalog was removed because its source, redistribution rights, and applicability were not independently reviewed. Material listing and material-key mass/inertia routes report unavailable; no product material-property record is currently supplied. A separate experimental cuboid mass-properties helper accepts caller-supplied density and dimensions and does not identify or qualify a material. The composite-analysis IPC route also reports unavailable because its former handler embedded unreviewed ply properties and loads.
- The handset thermal model and AI action now report unavailable. Their former fixed material properties, geometry, heat loads, and boundary assumptions did not have independent source or validation evidence.
- The handset impact calculators are experimental single-degree-of-freedom examples. They require an explicit drop height, device mass, and impact orientation, and return their bundled contact and integration assumptions with the estimate. They do not model a device-specific assembly, material failure, or a validated test setup.
- The sparse direct solver uses a discrete sine-transform path only for the exact uniform 2D five-point Poisson matrix (diagonal 4, neighbor values -1). Other matrices use the general sparse Cholesky path. Performance on this structured case does not establish the same budget for arbitrary sparse matrices.
- The legacy propeller route can evaluate a static coefficient equation only when RPM, diameter, air density, thrust and torque coefficients, and a caller-declared coefficient source are supplied. The coefficient source is not verified; this is not a CFD solve or a validated propeller performance result.
- The production optical Sellmeier, glass, thermo-optic, and housing-property registries are empty. The old example records and 50 mm prescription are retained only in `test/support/experimental_optics_examples.js`, which is excluded from application packaging; their sources, applicability, and redistribution rights remain unreviewed. The product optical-glass catalog and optical-tolerancing routes return unavailable. Imported ZMX geometry is preserved, while its paraxial metrics remain unavailable unless the caller supplies material indices. The 3D lens views are synthetic geometry; their drawn ray paths are not computed and carry no measured optical performance.
- The plant-property examples have no reviewed source or redistribution-license records. They are not an AIChE DIPPR dataset; the product property-query and VLLE routes return unavailable.
- The Wilson/Rachford–Rice phase-envelope estimate requires caller-supplied pressure and temperature bounds plus component records. A saturation target not bracketed within those bounds is returned as unavailable; the remaining estimates are experimental and have no independent reference.
- The legacy distillation column routine and legacy transient water-hammer simulator are disabled. The column code used embedded K-value guesses and reported convergence without establishing it; the transient example supplied physical defaults. The explicit-input Plant water-hammer screening route remains experimental, emits no code verdict, and has no independent transient reference.
- The piping stress example requires explicit user-supplied dimensions and material properties. The reduced model is experimental, has no built-in material or schedule catalog, and does not produce an allowable stress or pass/fail result.
- CAD revision comparison accepts caller-supplied face centroids in millimeters and volumes in cubic millimeters, then applies an experimental nearest-centroid heuristic with explicit thresholds. It does not compare B-rep topology or assess wall thickness, materials, manufacturing changes, or structural integrity; the legacy API name does not imply Git integration.
- Structural self-healing through system IPC and the legacy AI macro is unavailable. The retained symbolic helper is a formula-based cantilever thickness estimate that requires explicit modulus, strength, current thickness, and search bounds; it does not verify a safety factor, assess failure, or propose an automatic design edit.
- EDA rectangle checks are a small user-input screening helper. They are not foundry DRC, LVS, timing, or tape-out signoff.
- The EDA, PCB, and plant canvases use synthetic geometry. No PDK, physical canvas scale, board stackup, sourced component specifications, or process-stream conditions are configured.
- The experimental GPU helper creates instancing descriptors but is not connected to a renderer. GPU frustum culling is unavailable, and rendered polygon counts and FPS are not measured.
- The legacy ASME-labeled stress-line screen requires ordered finite samples spanning both supplied wall surfaces, an explicit caller-supplied limit and source label, and an explicit declaration that no secondary thermal stress is present. Its source label is not verified. It uses experimental threshold multiples, does not derive secondary stress Q from a single stress line, and produces no code assessment, certificate, or professional engineering review.
- NAFEMS, discrete Hertz contact, NIST sparse robustness, and ISO 10110 references remain unavailable. A CC0 NASA TMR theoretical skin-friction curve is now bundled, but no compatible compressible RANS turbulence-model solver adapter is available; that comparison remains unavailable. `npm run report:vv` reports evidence availability only; it does not execute a validation run.
- The [Hannover laboratory beam dataset](https://data.uni-hannover.de/en/dataset/a-benchmark-structure-for-virtual-sensing-on-tower-structures) (DOI `10.25835/lyav246d`, CC BY 3.0) is registered with hashes for its README, measurement file, and Abaqus input. The downloaded Abaqus file contains model inputs but no result file; no production beam mass/modal-response adapter is available, and no static or dynamic solver comparison has been run.
- The product IPC routes for core and extended validation benchmarks return `UNSUPPORTED` unless a released validation service is configured. No such service is currently configured, and the local diagnostic suites do not constitute released product validation.

## Workstation and compute

- Full project open/save, autosave, recovery, revision history, undo, and redo workflows are not available. The UI can export an encrypted session snapshot and authenticate a user-selected snapshot up to 16 MiB; verification does not import it into the active project, and it is not a complete project archive.
- The legacy `loadOmniArchive` preload method name remains, but it now accepts bounded archive bytes instead of a renderer-supplied filesystem path. Existing path-only calls are rejected; a secure native file-dialog or file-handle workflow has not been implemented. The ZMX importer accepts bounded text, but its palette command has no file or text input UI yet.
- The calculation queues defer work through the JavaScript event loop. They do not provide worker isolation, CPU parallelism, enforced timeouts, or interruption of a running synchronous calculation.
- No local worker scheduler or remote compute provider is configured. Cluster state and remote execution are unavailable.
- Result artifacts do not yet carry the complete required provenance record: immutable input hashes, project revision, engine/backend and dependency versions, residual history, units, warnings, and validation record.
- There is no Stenographer daemon integration, approval center, or durable engineering recorder.

## Security and distribution

- IPC sender checks allow only the main frame for the local `src/index.html` entry point. Payload checks remain project-specific, and packaged Electron sender rejection has not been validated.
- The renderer content security policy still allows inline scripts and styles. Packaging is not signed or notarized.
- Electron 45.0.0 requires macOS 13+ (Ventura or later) when running the graphical GUI application bundle because Chromium links Apple's `SMAppService` framework class. On macOS 12 (Monterey) or earlier, the GUI app aborts on launch with `Symbol not found: (_OBJC_CLASS_$_SMAppService)`. The headless solver daemon, compute host, and all numerical and test suites run cleanly on Node 22/24.
- A legacy PKCS#11 module path remains as a fail-closed compatibility stub. Hardware signing is unavailable unless a provider is injected; the software signing fixture exists only under tests and is not a hardware token or validated cryptographic module.
- Authorization decisions are unavailable without an authenticated identity provider. The legacy IAM helper is not an enterprise access-control service.
- Dependency license and provenance review is incomplete. See the lockfile-derived SBOM and `docs/third_party_notices.md`.
- The package currently declares ISC while the industrialization plan requests a proprietary EULA. The conflict is recorded in the release status and must be resolved by the rights holder before distribution.

## Release evidence not yet collected

Cross-platform packaged smoke tests, p95 UI input latency under load, cancellation timing, eight-hour soak, forced-termination recovery, installer/update verification, penetration testing, and independent domain/software reviews have not been completed.
