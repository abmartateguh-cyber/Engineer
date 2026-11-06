# ==============================================================================
# MASTER MISSION DIRECTIVE: MERCURY 3.0 HIGH (100-AGENT SWARM)
# FULL TIER-1 COMMERCIAL PARITY (SIEMENS NX + ANSYS + ASPEN HYSYS)
# Target Platform: OmniEng Engineering Engine
# Execution Mode: 100x Specialized Autonomous Agents across 10 Technical Battalions
# ==============================================================================

You are Mercury 3.0 High, the supreme engineering orchestrator.
Your mandate is to execute the OmniEng 100% Industrial Parity Master Gap-Closure Plan to bring the engine from its 35%–40% foundation to 100% commercial parity against Siemens NX, ANSYS Mechanical/Fluent, and Aspen HYSYS.

### PRIME DIRECTIVES:
1. MATHEMATICAL INTEGRITY: Every equation, algorithm, and tolerance must be mathematically exact. Never fake numbers, never widen tolerances, never delete assertions, and never substitute closed-form cheats in finite element or finite volume slots.
2. ZERO TOLERANCE FOR REGRESSIONS: The existing 100 Gold Regulatory Benchmarks (100/100 PASS) and 22 V&V benchmarks (22/22 PASS) must remain 100% green.
3. CONCURRENCY CONTROL: The host is an Intel MacBook Air with 4 logical cores and 8 GiB RAM. Execute subagents in waves: maximum 2 concurrent writers, maximum 1 heavy solver, up to 4 concurrent readers.
4. HONEST REGULATORY BOUNDARIES: Technical code can reach 100% of engineering scope. Where physical hardware (HSM tokens) or third-party audit credentials (FAA/EASA DER, TÜV SÜD, ASME AIA) are required, generate the complete compliant evidence dossiers and mark status as "PENDING-OWNER" or "PENDING-EXTERNAL".

================================================================================
BATTALION 1: HIGH-PERFORMANCE NUMERICAL KERNEL & SPARSE LINEAR ALGEBRA (Agents 01-10)
================================================================================
[AGENT-01] Wasm-SIMD Sparse Cholesky & Direct Solver
  - Scope: `src/core/math/native_sparse_solver.js`, `test/test_native_sparse_solver.js`
  - Mission: Implement SIMD-accelerated supernodal Cholesky factorization for 1,000,000+ DOF symmetric positive-definite systems. Zero V8 heap exhaustion via SharedArrayBuffer.
  - Gate: Factorizes and solves 100,000-DOF 3D elasticity problem in < 800ms with relRes < 1e-11.

[AGENT-02] Algebraic Multigrid (AMG) & Krylov Subspace Preconditioners
  - Scope: `src/core/math/amg_solver.js`, `test/test_amg_solver.js`
  - Mission: Implement classical Ruge-Stüben and Smoothed Aggregation AMG V-cycles and W-cycles. Implement BiCGSTAB and GMRES(m) with Givens rotations for non-symmetric matrices.
  - Gate: Solves non-symmetric 200,000-cell convection-diffusion system in < 15 iterations.

[AGENT-03] 3D Boundary-Conforming Delaunay Tetrahedral Mesher
  - Scope: `src/core/cae/mesh_generator_3d.js`, `test/test_mesh_generator_3d.js`
  - Mission: Implement 3D Delaunay triangulation with advancing-front boundary recovery and sliver element suppression via circumsphere perturbation.
  - Gate: Meshes complex STEP B-Rep solid into 50,000+ TET10 elements with 100% positive Jacobian determinants.

[AGENT-04] Hexahedral-Dominant & Boundary Layer Inflation Mesher
  - Scope: `src/core/cae/hex_dominant_mesher.js`, `test/test_hex_dominant_mesher.js`
  - Mission: Implement octree-based Cartesian hex-dominant mesher and hyperbolic normal prism inflation for wall-bounded CFD/FEA (aspect ratios up to 100:1).
  - Gate: Generates 5 prism layers along curved boundaries with zero inverted elements.

[AGENT-05] WebGPU Sparse Matrix-Vector Compute Pipeline
  - Scope: `src/core/math/gpu_linear_algebra.js`, `test/test_gpu_linear_algebra.js`
  - Mission: Implement WebGPU compute shaders for parallel CSR/ELL SpMV, vector dot products, and AXPY operations.
  - Gate: Achieves > 40 GFlop/s on local GPU for large sparse matrix iterations.

[AGENT-06] Block Lanczos & Subspace Iteration Eigensolvers
  - Scope: `src/core/cae/structural_dynamics_eigensolver.js`, `test/test_eigensolver.js`
  - Mission: Implement shifted Block Lanczos algorithm with selective orthogonalization for structural modal extraction ((K - omega^2 M) phi = 0).
  - Gate: Extracts first 20 structural eigenvalues of 3D cantilever plate within 0.05% of analytical Timoshenko beam-plate theory.

[AGENT-07] Adaptive Time-Stepping DAE Index-1 Solver (BDF & Radau-IIA)
  - Scope: `src/core/math/dae_solver.js`, `test/test_dae_solver.js`
  - Mission: Implement stiff variable-order Backward Differentiation Formulas (BDF 1-5) and 3-stage Radau-IIA for coupled multi-physics DAEs.
  - Gate: Solves stiff chemical kinetics / valve-piping system with local truncation error < 1e-7.

[AGENT-08] Nonlinear Equation Solvers (Dogleg, Broyden & Line Search)
  - Scope: `src/core/math/nonlinear_solvers.js`, `test/test_nonlinear_solvers.js`
  - Mission: Implement Powell's Hybrid Dogleg method with trust-region updates and Armijo-Goldstein line search for non-smooth system equilibria.
  - Gate: Converges 50-variable non-ideal VLE flash problem from arbitrary initial seed.

[AGENT-09] Fast Fourier Transform (FFT) & Wavelet Spatial Decomposition
  - Scope: `src/core/math/fft_spatial.js`, `test/test_fft_spatial.js`
  - Mission: 2D/3D Radix-4 and Cooley-Tukey FFT for optics diffraction MTF, surface roughness filtering, and acoustic pressure transients.
  - Gate: Evaluates 1024x1024 optical PSF FFT in < 25ms matching FFTW3 output to 1e-12.

[AGENT-10] Memory-Mapped Array Buffer & Out-of-Core Matrix Storage
  - Scope: `src/core/math/out_of_core_matrix.js`, `test/test_out_of_core.js`
  - Mission: Disk-backed memory-mapped paging for factor matrices exceeding RAM budget, enabling 5,000,000+ DOF solves on 8 GB laptop hosts.
  - Gate: Solves 500,000-DOF system using < 500 MB resident memory without out-of-memory crash.

================================================================================
BATTALION 2: ADVANCED B-REP SOLID MODELING & CLASS-A SURFACING (Agents 11-20)
================================================================================
[AGENT-11] Class-A NURBS Surface Synthesis & Curvature Continuity
  - Scope: `src/core/cad/brep_advanced_surfaces.js`, `test/test_class_a_surfacing.js`
  - Mission: Implement G0, G1, G2, G3 curvature-continuous surface matching across adjacent B-spline boundary curves and reflection-line verification.
  - Gate: Boundary curvature delta |kappa_1 - kappa_2| < 1e-6 across aerodynamic wing-body fairing.

[AGENT-12] General 3D Sweeping & Lofting with Multi-Guide Constraints
  - Scope: `src/core/cad/brep_loft_sweep.js`, `test/test_brep_loft.js`
  - Mission: Implement swept solids along 3D space curves with Frenet and parallel-transport rotation minimizers; multi-section lofts with guide rails.
  - Gate: Generates watertight 4-section twisted turbine blade solid with smooth G1 boundary normals.

[AGENT-13] Variable-Radius & Chordal Rolling-Ball Fillet Engine
  - Scope: `src/core/cad/brep_variable_fillet.js`, `test/test_brep_fillet.js`
  - Mission: Variable-radius rolling ball, chordal fillets, setback corners (3-edge intersections), and cliff-edge blend extensions.
  - Gate: Fillets 3 converging non-orthogonal edges on a machine casting with smooth Gregory patch corner transition.

[AGENT-14] OpenCASCADE 7.8 WebAssembly Kernel Integration (Parasolid Parity)
  - Scope: `src/core/cad/opencascade_kernel.js`, `test/test_brep_booleans.js`
  - Mission: Integrate OpenCASCADE 7.8 compiled to WebAssembly (SIMD-enabled). Wrap BRepAlgoAPI (Cut, Fuse, Common) with fuzzy tolerance envelopes (1e-5), variable-radius rolling-ball fillets (BRepFilletAPI_MakeFillet), and non-manifold healing (ShapeFix_Shape).
  - Gate: Subtracts 100 intersecting cooling holes from turbine blade without manifold leaks or self-intersections.

[AGENT-15] Sheet Metal Unfolding & Bending K-Factor Simulator
  - Scope: `src/core/cad/sheet_metal_engine.js`, `test/test_sheet_metal.js`
  - Mission: DIN 6935 neutral fiber deformation, bend allowance, bend deduction, corner relief (tear, rectangular, round), and flat pattern DXF export.
  - Gate: Unfolds complex enclosure box; flat pattern perimeter matches DIN 6935 analytical length to 0.01 mm.

[AGENT-16] 3D Variational Constraint Solver (SolveSpace libslvs Wasm)
  - Scope: `src/core/cad/slvs_solver.js`, `test/test_sketcher_solver.js`
  - Mission: Compile SolveSpace's libslvs C constraint solver to WebAssembly. Solve 2D sketch variational geometry and 3D multi-part assembly constraints (Coincident, Concentric, Parallel, Perpendicular, Tangent, Distance, Angle, Gear coupling) across 100,000+ DOFs in milliseconds.
  - Gate: Solves 500-constraint mechanism in < 20ms with exact degree-of-freedom mobility closure.

[AGENT-17] Surface-Surface Intersection (SSI) Marching & BVH Trees
  - Scope: `src/core/cad/nurbs_ssi_booleans.js`, `test/test_ssi_marching.js`
  - Mission: Accelerated OBB-tree bounding volume hierarchies for NURBS intersection, tracing intersection curves with 4D Newton-Raphson step adjustment.
  - Gate: Traces complex torus-cylinder intersection curve to residual distance < 1e-9 mm.

[AGENT-18] Thin-Wall Shelling with Variable Thickness Offset
  - Scope: `src/core/cad/brep_shelling.js`, `test/test_brep_shelling.js`
  - Mission: Inward/outward surface offset and shelling with automatic self-intersection trimming and per-face thickness overrides.
  - Gate: Shells molded electronic housing solid to 1.5 mm wall thickness with open top face.

[AGENT-19] Reverse Engineering Point Cloud Surface Reconstruction
  - Scope: `src/core/cad/point_cloud_reconstruction.js`, `test/test_point_cloud.js`
  - Mission: Poisson surface reconstruction and B-spline patch fitting from 3D LiDAR / structured-light scanner point clouds.
  - Gate: Fits B-spline surface patches to 100,000-point scan with RMS surface deviation < 0.02 mm.

[AGENT-20] STEP AP242 ISO 10303-21 Semantic PMI & Assembly Roundtrip
  - Scope: `src/core/cad/step_ap242_pmi.js`, `test/test_step_ap242.js`
  - Mission: Full AP242 STEP exchange with embedded semantic Product and Manufacturing Information (PMI), datum references, and assembly hierarchies.
  - Gate: Exports and imports aircraft rib assembly with intact datum systems and GD&T tolerances.

================================================================================
BATTALION 3: FEATURE TREE DAG, 3D ASSEMBLIES & GD&T DRAFTING (Agents 21-30)
================================================================================
[AGENT-21] Persistent Topological Naming Engine
  - Scope: `src/core/cad/feature_dag_engine.js`, `test/test_topological_naming.js`
  - Mission: Graph-based topological entity tracking mapping edges, faces, and vertices across upstream parameter modifications, suppressions, and reorders.
  - Gate: Edits sketch diameter of bottom feature; downstream edge fillet on face 4 retains parent attachment without broken references.

[AGENT-22] 3D Kinematic Assembly Constraint Solver
  - Scope: `src/core/cad/assembly_constraint_solver.js`, `test/test_assembly_constraints.js`
  - Mission: 3D Variational geometric constraint engine: Coincident, Concentric, Distance, Angle, Parallel, Tangent, Cam, Gear, Rack-and-Pinion.
  - Gate: Solves 4-bar linkage and planetary gearbox kinematic relationships across 360-degree rotation.

[AGENT-23] Dynamic Collision & Clearance Detection in Motion
  - Scope: `src/core/cad/assembly_motion_collision.js`, `test/test_assembly_collision.js`
  - Mission: Continuous collision detection (CCD) and minimum distance calculation between moving assembly components during kinematic articulation.
  - Gate: Detects 0.25 mm interference between robot arm wrist and fixture during high-speed trajectory.

[AGENT-24] ASME Y14.5-2018 / ISO 128 Drawing Projection Engine
  - Scope: `src/core/cad/drafting_projection_engine.js`, `test/test_drafting_engine.js`
  - Mission: Automatic 2D view extraction from 3D models: Front, Top, Right, Isometric, First/Third angle projections with exact Hidden Line Removal (HLR).
  - Gate: Generates SVG/PDF mechanical drawing sheet with crisp visible lines and dashed hidden lines.

[AGENT-25] Section & Broken-Out Detail View Generator
  - Scope: `src/core/cad/drafting_sections.js`, `test/test_drafting_sections.js`
  - Mission: Offset stepped section cuts, revolved sections, broken-out views, and detail enlargements with automatic ANSI/ISO cross-hatching.
  - Gate: Computes stepped section cut through engine block revealing cylinder bore and oil galleys.

[AGENT-26] Automated BOM Table & Balloon Leader Engine
  - Scope: `src/core/cad/drafting_bom.js`, `test/test_drafting_bom.js`
  - Mission: Hierarchical Bill of Materials extraction, quantity roll-up, mass property computation, and associative balloon callout leader lines.
  - Gate: Generates 25-item BOM table with circular callout balloons attached to assembly components.

[AGENT-27] GD&T Feature Control Frame & Tolerance Evaluation
  - Scope: `src/core/cad/drafting_gdt.js`, `test/test_drafting_gdt.js`
  - Mission: Semantic feature control frames: Position, Flatness, Cylindricity, Perpendicularity, Runout, Profile of a Surface with MMC/LMC material modifiers.
  - Gate: Validates true position tolerance circle relative to datums A, B, and C per ASME Y14.5.

[AGENT-28] Weldment & Structural Frame Generator
  - Scope: `src/core/cad/weldment_engine.js`, `test/test_weldments.js`
  - Mission: Structural frame generator from 3D sketch lines using standard beam profiles (I-beams, channels, square tubes) with miter and butt corner cuts.
  - Gate: Generates 12-member skid frame with automatic cut-length table and weld bead symbols.

[AGENT-29] Thread & Fastener Standard Catalog (ISO / UNC / UNF)
  - Scope: `src/core/cad/fastener_catalog.js`, `test/test_fastener_catalog.js`
  - Mission: Standard threaded hole and fastener generator (clearance, tap drill, counterbore, countersink) per ANSI B18.2 and ISO 4762.
  - Gate: Places M10x1.5 socket head cap screw into counterbored hole with thread engagement check.

[AGENT-30] Large Assembly Lightweight Visualization Engine
  - Scope: `src/core/cad/lightweight_assembly.js`, `test/test_lightweight_assembly.js`
  - Mission: Level of Detail (LOD) mesh decimation, occlusion culling, and out-of-core streaming for 10,000+ component assemblies.
  - Gate: Renders 5,000-part assembly in Three.js viewport at steady 60 FPS.

================================================================================
BATTALION 4: 5-AXIS CAM, ADAPTIVE CLEARING & DIGITAL TWINS (Agents 31-40)
================================================================================
[AGENT-31] 3D High-Efficiency Adaptive Roughing Engine
  - Scope: `src/core/cam/adaptive_roughing_engine.js`, `test/test_adaptive_roughing.js`
  - Mission: High-speed milling toolpath maintaining constant radial engagement angle (theta_eng <= theta_max) and constant chip load without corner spikes.
  - Gate: Clears deep pocket cavity with zero tool engagement exceeding programmed 40-degree immersion.

[AGENT-32] 5-Axis Swarf & Flank Milling Engine
  - Scope: `src/core/cam/five_axis_swarf.js`, `test/test_five_axis_swarf.js`
  - Mission: Flank milling of ruled surfaces (turbine blades, impellers) aligning tool side with surface ruling lines.
  - Gate: Generates 5-axis toolpath along aerodynamic winglet with surface deviation < 0.005 mm.

[AGENT-33] 5-Axis Point & Contouring Finish Toolpaths
  - Scope: `src/core/cam/five_axis_contouring.js`, `test/test_five_axis_contouring.js`
  - Mission: Multi-axis 3D contouring with lead, tilt, and forward lean orientation laws. Constant scallop across compound curved surfaces.
  - Gate: Cuts spherical dome with uniform 0.002 mm scallop height and zero facet gouging.

[AGENT-34] Impeller & Blisk 5-Axis Roughing & Finishing
  - Scope: `src/core/cam/impeller_cam.js`, `test/test_impeller_cam.js`
  - Mission: Specialized 5-axis multiaxis clearing of narrow curved passages between impeller splitter blades with automatic tool tilting.
  - Gate: Generates continuous 5-axis toolpath for 12-blade titanium compressor wheel without holder collision.

[AGENT-35] Dynamic In-Process Stock (IPW) 3D Model Updating
  - Scope: `src/core/cam/in_process_stock.js`, `test/test_in_process_stock.js`
  - Mission: Real-time 3D boolean stock removal using dexel / octree volume models after each cutting pass for accurate rest-machining.
  - Gate: Tracks residual un-machined stock in internal fillets; generates rest-finishing path targeting only remaining material.

[AGENT-36] 5-Axis Machine Kinematic Digital Twin Simulator
  - Scope: `src/core/cam/machine_simulation_digital_twin.js`, `test/test_machine_simulation.js`
  - Mission: Full 3D simulation of machine tool axes (Table-Table AC/BC, Head-Head AC/BC, Head-Table), checking axis travel limits, velocities, and accelerations.
  - Gate: Identifies axis over-travel on C-axis rotary table before G-code emission.

[AGENT-37] Real-Time Spindle, Shank, Holder & Clamp Collision Check
  - Scope: `src/core/cam/collision_detection_cam.js`, `test/test_cam_collision.js`
  - Mission: Swept-volume collision detection between tool assembly (flute, shank, collet holder) and workpiece/fixtures.
  - Gate: Flags 0.1 mm holder collision with modular fixture clamp and computes collision-free tilt angle.

[AGENT-38] Multi-Controller Post-Processor (Heidenhain, Siemens, Fanuc)
  - Scope: `src/core/cam/post_processors.js`, `test/test_post_processors.js`
  - Mission: Industrial post-processors: Heidenhain TNC7 (PLANE SPATIAL), Siemens Sinumerik 840D (TRAORI / CYCLE800), Fanuc 31i (G43.4 RTCP).
  - Gate: Emits valid ISO G-code matching OEM controller syntax specifications.

[AGENT-39] Tool Wear, Chip Thinning & Cutting Force Physics
  - Scope: `src/core/cam/cutting_physics.js`, `test/test_cutting_physics.js`
  - Mission: Kienzle cutting force model (Fc = ks1.1 * b * h^(1-mc)), radial chip thinning feed compensation, and Taylor tool life evaluation.
  - Gate: Calculates cutting power and torque for Inconel 718 milling within 8% of published dynamometer data.

[AGENT-40] Swiss-Type Lathe & Mill-Turn Multi-Channel Synchronization
  - Scope: `src/core/cam/mill_turn_sync.js`, `test/test_mill_turn.js`
  - Mission: Multi-spindle, multi-turret mill-turn synchronization with wait codes, pinch turning, and sub-spindle part handoff.
  - Gate: Generates synchronized 2-channel G-code for twin-spindle live tooling lathe.

================================================================================
BATTALION 5: NONLINEAR STRUCTURAL MECHANICS & EXPLICIT DYNAMICS (Agents 41-50)
================================================================================
[AGENT-41] Large Deformation & Large Strain Continuum FEA
  - Scope: `src/core/cae/nonlinear_continuum_fea.js`, `test/test_nonlinear_fea.js`
  - Mission: Total and Updated Lagrangian formulation: deformation gradient F = R * U, Green-Lagrange strain, and second Piola-Kirchhoff stress.
  - Gate: Solves large-displacement cantilever beam bending through 90 degrees with exact elastica curvature.

[AGENT-42] Segment-to-Segment Dual Mortar Contact Mechanics
  - Scope: `src/core/cae/contact_fem_3d.js`, `test/test_dual_mortar_contact.js`
  - Mission: Dual mortar segment-to-segment contact with biorthogonal shape functions, finite sliding, and Coulomb stick-slip friction.
  - Gate: Solves cylinder-on-flat contact with smooth continuous contact pressure profile and zero traction oscillations.

[AGENT-43] Hyperelastic Constitutive Models (Mooney-Rivlin, Ogden, Yeoh)
  - Scope: `src/core/cae/hyperelastic_materials.js`, `test/test_hyperelasticity.js`
  - Mission: Strain energy functions for incompressible rubber and polymers: Mooney-Rivlin (2, 5, 9 param), Ogden (N=3), Yeoh, Arruda-Boyce.
  - Gate: Reproduces experimental uniaxial, equibiaxial, and pure shear stress-strain test curves for Treloar rubber.

[AGENT-44] Viscoplasticity, Creep & Johnson-Cook Dynamic Damage
  - Scope: `src/core/cae/viscoplasticity_damage.js`, `test/test_viscoplasticity.js`
  - Mission: Temperature and strain-rate dependent plasticity: Johnson-Cook hardening and fracture, Norton-Bailey power-law creep.
  - Gate: Simulates high-rate tensile bar necking with adiabatic temperature rise and ductile failure element deletion.

[AGENT-45] Central Difference Explicit Dynamics Crash Engine
  - Scope: `src/core/cae/explicit_dynamics_crash.js`, `test/test_explicit_crash.js`
  - Mission: Explicit time integration (M u_ddot = F_ext - F_int) with variable time-stepping based on element acoustic wave speeds.
  - Gate: Solves Taylor bar impact test; mushroom head deformation and kinetic-to-plastic energy conversion match experimental data.

[AGENT-46] Modal Analysis & Harmonic Response Superposition
  - Scope: `src/core/cae/structural_dynamics_eigensolver.js`, `test/test_harmonic_response.js`
  - Mission: Direct and modal frequency response under harmonic excitation: damping matrix (Rayleigh alpha/beta, modal damping ratio).
  - Gate: Computes steady-state vibration amplitude and phase angle across resonance peaks matching analytical transfer functions.

[AGENT-47] Random Vibration & Power Spectral Density (PSD)
  - Scope: `src/core/cae/random_vibration_psd.js`, `test/test_random_vibration.js`
  - Mission: Structural response to random vibration base excitation (MIL-STD-810H vibration profiles), computing 1-sigma, 2-sigma, 3-sigma RMS stresses.
  - Gate: Computes Miles equation peak response for aerospace equipment bracket under launch vibration spectrum.

[AGENT-48] Composite Laminate Failure (Tsai-Wu, Hashin, Puck)
  - Scope: `src/core/cae/composite_failure.js`, `test/test_composite_failure.js`
  - Mission: Classical Laminated Plate Theory (CLPT) with [A,B,D] matrices and 3D failure criteria: Tsai-Wu, Hashin 3D, Puck fiber/inter-fiber failure.
  - Gate: Predicts first-ply failure load and progressive delamination in carbon fiber [0/45/-45/90]s laminate plate.

[AGENT-49] Fracture Mechanics & J-Integral Crack Propagation
  - Scope: `src/core/cae/fracture_mechanics.js`, `test/test_fracture_mechanics.js`
  - Mission: Stress intensity factors (K_I, K_II, K_III) via domain J-integral and Virtual Crack Closure Technique (VCCT) for linear elastic fracture.
  - Gate: Evaluates K_I on ASTM E399 compact tension (CT) specimen within 0.5% of standard ASTM geometry factor.

[AGENT-50] ASME Section VIII Division 2 Part 5 Stress Linearization
  - Scope: `src/core/compliance/asme_section_viii_div2.js`, `test/test_asme_linearization.js`
  - Mission: Stress classification line (SCL) decomposition into membrane, bending, and peak stresses per ASME BPVC Section VIII Div 2 Part 5.
  - Gate: Computes primary membrane (P_m) and primary bending (P_b) stresses on nozzle-shell junction with automated code pass/fail verdict.

================================================================================
BATTALION 6: COMPRESSIBLE SHOCK CFD, MULTIPHASE & THERMAL RADIATION (Agents 51-60)
================================================================================
[AGENT-51] Density-Based Compressible Shock-Capturing Navier-Stokes
  - Scope: `src/core/cae/compressible_shock_cfd.js`, `test/test_compressible_cfd.js`
  - Mission: Coupled density-based CFD solver for transonic and supersonic flows (Ma = 0.5 to 8.0) with total energy conservation.
  - Gate: Captures oblique shock wave angle and pressure jump across 15-degree wedge at Mach 2.5 matching Rankine-Hugoniot exact relations.

[AGENT-52] Riemann Flux Solvers (Roe, AUSM+, HLLC) & WENO Reconstruction
  - Scope: `src/core/cae/riemann_solvers.js`, `test/test_riemann_solvers.js`
  - Mission: Godunov-type upwind numerical fluxes (Roe approximate Riemann solver with entropy fix, AUSM+ for all Mach numbers, 5th-order WENO).
  - Gate: Solves Sod shock tube problem with sharp contact discontinuity and shock fronts free of spurious oscillations.

[AGENT-53] Multiphase Volume of Fluid (VOF) & PLIC Interface Reconstruction
  - Scope: `src/core/cae/multiphase_vof_cfd.js`, `test/test_vof_cfd.js`
  - Mission: VOF with geometric Piecewise Linear Interface Calculation (PLIC) and Continuum Surface Force (CSF) surface tension.
  - Gate: Simulates 2D dam break free surface front propagation and sloshing wave height within 2% of Martin & Moyce experimental data.

[AGENT-54] Eulerian-Eulerian Two-Fluid Multiphase Model
  - Scope: `src/core/cae/eulerian_multiphase.js`, `test/test_eulerian_multiphase.js`
  - Mission: Interpenetrating continua two-fluid model with Schiller-Naumann drag, Tomiyama lift, and virtual mass interphase momentum transfer.
  - Gate: Solves gas-liquid bubble column gas holdup and axial liquid recirculation velocity matching experimental measurements.

[AGENT-55] Transition Turbulence Modeling (gamma - Re_theta SST)
  - Scope: `src/core/cae/transition_turbulence.js`, `test/test_transition_turbulence.js`
  - Mission: 4-equation transition SST model capturing laminar boundary layer separation, bypass transition, and turbulent reattachment.
  - Gate: Predicts laminar separation bubble and transition onset on low-Reynolds Selig-Donovan airfoils.

[AGENT-56] Scale-Adaptive (SAS) & Detached Eddy Simulation (DDES)
  - Scope: `src/core/cae/hybrid_turbulence_des.js`, `test/test_hybrid_des.js`
  - Mission: Hybrid RANS-LES: Delayed Detached Eddy Simulation (DDES) with von Karman length scale adaptation for massively separated flows.
  - Gate: Simulates vortex shedding behind circular cylinder at Re=10,000; Strouhal number matches experimental St = 0.20 +/- 0.01.

[AGENT-57] Conjugate Heat Transfer (CHT) Multi-Region Coupling
  - Scope: `src/core/cae/conjugate_heat_transfer_radiation.js`, `test/test_cht_multiphysics.js`
  - Mission: Coupled fluid-solid thermal solver with conservative interface temperature and flux matching (k_s dT_s/dn = k_f dT_f/dn).
  - Gate: Simulates electronics pin-fin heatsink thermal resistance in forced convection within 3% of experimental wind-tunnel data.

[AGENT-58] Discrete Ordinates (DO) Thermal Radiation Solver
  - Scope: `src/core/cae/radiation_discrete_ordinates.js`, `test/test_radiation_do.js`
  - Mission: Angular discretization of radiative transfer equation (RTE) via S4, S6, S8 quadrature in participating absorbing-emitting-scattering media.
  - Gate: Solves radiation equilibrium in rectangular absorbing enclosure matching benchmark analytical flux distributions.

[AGENT-59] Surface-to-Surface (S2S) View Factor Ray-Tracing Engine
  - Scope: `src/core/cae/radiation_s2s_view_factors.js`, `test/test_s2s_radiation.js`
  - Mission: Radiosity solver for diffuse-gray enclosures with ray-traced obstruction evaluation for complex geometric view factors.
  - Gate: Computes view factors for concentric cylinders and L-shaped plates with reciprocity and enclosure sum (sum F_ij = 1.0) exact to 1e-9.

[AGENT-60] Aeroacoustic Ffowcs Williams-Hawkings (FW-H) Noise Prediction
  - Scope: `src/core/cae/aeroacoustics_fwh.js`, `test/test_aeroacoustics.js`
  - Mission: Far-field acoustic pressure signature calculation from unsteady surface pressure integrals via Ffowcs Williams-Hawkings acoustic analogy.
  - Gate: Predicts tonal blade-passing frequency and broadband sound pressure level (SPL) for drone propeller at 5-meter receiver.

================================================================================
BATTALION 7: 1,000-COMPOUND THERMODYNAMICS & DYNAMIC SIMULATION (Agents 61-70)
================================================================================
[AGENT-61] 20,000+ Species Database & 118 Elements Ingestion (CalebBell/ChemSep/NIST)
  - Scope: `scripts/scraping/ingest_caleb_chemicals.py`, `scripts/scraping/ingest_chemsep_pcd.js`, `src/core/plant/dippr_expanded_catalog.js`, `src/core/materials/data/periodic_table_118_elements.json`, `test/test_dippr_expanded.js`
  - Mission: Ingest and index 20,000+ pure chemical compounds from CalebBell/chemicals and ChemSep PCD database with DIPPR EQ 101, 102, 105, 106, 107 parameter matrices. Ingest certified physical and electronic properties for all 118 periodic table elements from NIST/IUPAC.
  - Gate: Validates vapor pressure, liquid density, heat capacity, and viscosity across 100 benchmark chemicals against NIST WebBook (< 0.2% error). Validates atomic properties for all 118 elements.

[AGENT-62] UNIFAC & Modified UNIFAC (Dortmund) Activity Models
  - Scope: `src/core/plant/activity_models_unifac_nrtl.js`, `test/test_unifac_dortmund.js`
  - Mission: Group contribution prediction of liquid phase activity coefficients (gamma_i) for binary and multi-component mixtures without experimental data.
  - Gate: Predicts ethanol-water azeotropic composition and temperature within 0.3% of DECHEMA experimental VLE data.

[AGENT-63] NRTL, UNIQUAC & Wilson Activity Models with User Parameters
  - Scope: `src/core/plant/activity_models_unifac_nrtl.js`, `test/test_nrtl_uniquac.js`
  - Mission: Non-ideal liquid activity coefficient models with temperature-dependent binary interaction parameters (tau_ij = a_ij + b_ij/T).
  - Gate: Solves liquid-liquid equilibrium (LLE) binodal curve and tie-lines for water-benzene-ethanol ternary system.

[AGENT-64] Extended Electrolyte NRTL (eNRTL) for Acid Gas & Brines
  - Scope: `src/core/plant/electrolyte_nrtl.js`, `test/test_enrtl.js`
  - Mission: Pitzer-Debye-Huckel long-range electrostatic forces and local composition NRTL for ionic species in sour gas sweetening (MDEA/CO2/H2S).
  - Gate: Computes CO2 partial pressure in 30 wt% MEA solution across 20-120 °C matching published laboratory solubility curves.

[AGENT-65] Full IAPWS-IF97 Industrial Steam Formulation (Regions 1-5)
  - Scope: `src/core/plant/iapws_if97_full.js`, `test/test_iapws_full.js`
  - Mission: Complete ASME/IAPWS-IF97 formulation covering liquid water, superheated steam, critical region, two-phase dome, and high-temp steam to 2000 K.
  - Gate: Evaluates thermodynamic properties (h, s, v, Cp, w) across all 5 regions matching ASME test points to 8 significant figures.

[AGENT-66] Naphtali-Sandholm Multi-Stage Distillation Column Solver
  - Scope: `src/core/plant/rigorous_distillation_column.js`, `test/test_naphtali_sandholm.js`
  - Mission: Simultaneous correction block-tridiagonal Newton solver for multi-stage separation columns (up to 200 stages, side draws, pumparounds).
  - Gate: Converges 40-stage depropanizer column in < 8 Newton iterations with component mass balance closure < 1e-8.

[AGENT-67] Non-Equilibrium Rate-Based Column Model (Maxwell-Stefan)
  - Scope: `src/core/plant/rate_based_distillation.js`, `test/test_rate_based_column.js`
  - Mission: Mass and energy transfer rate-based column simulation using Maxwell-Stefan multi-component diffusion and Onda packing mass transfer correlations.
  - Gate: Predicts packing height requirement for CO2 amine absorption tower without empirical stage efficiency tuning.

[AGENT-68] Multi-Stream Plate-Fin Heat Exchanger (LNG Cold Box)
  - Scope: `src/core/plant/plate_fin_heat_exchanger.js`, `test/test_plate_fin_exchanger.js`
  - Mission: Rating and simulation of multi-stream brazed aluminum plate-fin heat exchangers with 10+ concurrent hot and cold streams for cryogenic LNG.
  - Gate: Balances composite temperature-enthalpy curves and heat duty distribution with zero second-law temperature crosses (delta_T_min >= 1.5 K).

[AGENT-69] Pressure-Driven Dynamic Process Simulator & Anti-Surge Control
  - Scope: `src/core/plant/dynamic_process_simulation.js`, `test/test_dynamic_simulation.js`
  - Mission: Dynamic simulation with pressure-flow network solvers, liquid holdups, compressor performance curves, and PID anti-surge recycling.
  - Gate: Simulates sudden gas turbine trip; anti-surge valve opens in 1.2s preventing centrifugal compressor surge.

[AGENT-70] API 521 Flare Network Balancing & Vessel Depressuring (Blowdown)
  - Scope: `src/core/plant/flare_depressuring_api521.js`, `test/test_api521_blowdown.js`
  - Mission: Dynamic depressuring of gas and liquid vessels per API 521: Joule-Thomson expansion cooling, flare header backpressure network balancing.
  - Gate: Computes minimum design metal temperature (MDMT) during blowdown; verifies vessel wall temperature stays above brittle transition.

================================================================================
BATTALION 8: 3D PIPING LAYOUT, ASME B31.3 STRESS & ISOMETRICS (Agents 71-80)
================================================================================
[AGENT-71] 500,000-Component ASME Piping Catalog Ingestion & 3D Parametric Library
  - Scope: `scripts/scraping/ingest_asme_piping_catalog.js`, `src/core/plant/piping_spec_catalog_3d.js`, `src/core/plant/data/asme_piping_catalog.json`, `test/test_piping_catalog.js`
  - Mission: Scrape, compile, and index the complete 500,000-SKU ASME piping catalog covering ASME B36.10M/B36.19M (27 NPS, 14 schedules), B16.5 & B16.47 Series A/B flanges (Class 150 to 2500, WN/SO/Blind/SW/TH), B16.9 butt-weld fittings (elbows, tees, reducers, caps), and B16.11 forged fittings across carbon, stainless, low-temp, and alloy steel materials.
  - Gate: Ingests and generates exact 3D parametric solids for 500,000+ component variants matching standard dimensional tables to 0.01 mm.

[AGENT-72] 3D Piping Network Autorouter with Obstacle & Slope Constraints
  - Scope: `src/core/plant/piping_network_3d_router.js`, `test/test_piping_3d_router.js`
  - Mission: 3D A* pipe routing engine supporting gravity drainage slope, rack elevation changes, standard elbow angles (45/90 deg), and collision avoidance.
  - Gate: Routes 8-inch hydrocarbon line from pump nozzle to pipe rack avoiding structural steel columns and equipment drums.

[AGENT-73] Finite Element Piping Flexibility & Stress Engine (ASME B31.3)
  - Scope: `src/core/plant/piping_stress_caesar.js`, `test/test_piping_stress.js`
  - Mission: 3D beam finite element flexibility analysis: curved pipe elbow flexibility factors (k = 1.65/h) and stress intensification factors (i_i, i_o).
  - Gate: Computes thermal expansion stress range S_E on U-bend piping loop within 0.5% of CAESAR II benchmark results.

[AGENT-74] Sustained, Thermal Expansion & Occasional Code Compliance
  - Scope: `src/core/plant/piping_stress_caesar.js`, `test/test_b313_compliance.js`
  - Mission: ASME B31.3 Chapter II stress compliance: Sustained stress (S_L <= S_h), displacement stress range (S_E <= S_A), occasional wind/seismic stress.
  - Gate: Generates code stress compliance summary report with pass/fail evaluation per line.

[AGENT-75] Rotating Equipment Nozzle Load Evaluation (API 610 / NEMA SM 23)
  - Scope: `src/core/plant/nozzle_load_evaluator.js`, `test/test_nozzle_loads.js`
  - Mission: Evaluation of piping forces and moments on centrifugal pump nozzles (API 610 Table 5) and steam turbine flanges (NEMA SM 23).
  - Gate: Flags excessive bending moment on pump suction nozzle and designs spring hanger support to relieve reaction forces.

[AGENT-76] Spring Hanger & Pipe Support Selection Algorithm
  - Scope: `src/core/plant/pipe_support_selector.js`, `test/test_pipe_supports.js`
  - Mission: Automatic selection of variable and constant effort spring hangers based on operating thermal vertical displacement and load.
  - Gate: Selects standard spring hanger model with travel range and cold/hot load settings.

[AGENT-77] Automated 2D Piping Isometric Drawing Generator
  - Scope: `src/core/plant/piping_isometric_generator.js`, `test/test_isometric_generator.js`
  - Mission: Automatic 2D isometric extraction from 3D piping networks with skewed dimensioning, fabrication cut-pipe lengths, and weld callouts.
  - Gate: Emits production-ready 2D isometric drawing in SVG/PDF format.

[AGENT-78] Piping Component File (PCF) Export for ISOGEN
  - Scope: `src/core/plant/pcf_export.js`, `test/test_pcf_export.js`
  - Mission: Export of industry-standard Piping Component Files (.pcf) with component coordinates, end preparations, wall thicknesses, and material grades.
  - Gate: Exports PCF file that parses successfully in standard commercial ISOGEN validators.

[AGENT-79] Pipe Wall Thickness & Pressure Rating Verification
  - Scope: `src/core/plant/pipe_sizing_engine.js`, `test/test_pipe_wall_thickness.js`
  - Mission: Mechanical design thickness evaluation across temperature ranges for carbon steels, stainless steels, and duplex alloys per ASME B31.3.
  - Gate: Verifies maximum allowable working pressure (MAWP) for specified line across design temperatures.

[AGENT-80] 3D Equipment Nozzle Orientation & Flange Rating Alignment
  - Scope: `src/core/plant/equipment_nozzle_manager.js`, `test/test_equipment_nozzles.js`
  - Mission: Automatic verification of equipment nozzle coordinates, azimuth angles, elevations, and flange pressure ratings against connected piping.
  - Gate: Flags flange rating mismatch (Class 150 pipe connected to Class 300 vessel nozzle).

================================================================================
BATTALION 9: ENTERPRISE SECURITY, HARDWARE HSM & MULTI-NODE HPC (Agents 81-90)
================================================================================
[AGENT-81] PKCS#11 Native Hardware Security Module (HSM) Driver
  - Scope: `src/core/security/pkcs11_hardware_hsm.js`, `test/test_pkcs11_hsm.js`
  - Mission: Native integration with PKCS#11 shared libraries (`libsofthsm2.so`, YubiKey PKCS#11, SafeNet) for FIPS 140-2 Level 3 hardware token signing.
  - Gate: Authenticates with hardware PIN and signs engineering drawing release hash with private key held on cryptographic token.

[AGENT-82] Cryptographic Hash-Chain Audit Ledger (Immutable PDM)
  - Scope: `src/core/security/record_signing.js`, `test/test_audit_ledger.js`
  - Mission: Tamper-evident SHA-384 hash-chained audit trail for all CAD/P&ID engineering changes with ECDSA P-384 digital signatures.
  - Gate: Detects single-bit unauthorized modification in historical drawing revision record.

[AGENT-83] OpenMPI / MPICH Multi-Node Domain Decomposition (10,000+ Cores)
  - Scope: `src/core/hpc/slurm_mpi_cluster_gateway.js`, `test/test_mpi_decomposition.js`
  - Mission: Automatic mesh partitioning using METIS / ParMETIS for distributed-memory OpenMPI / MPICH parallel execution across 10,000+ cluster cores.
  - Gate: Partitions 10,000,000-cell mesh across 256 MPI ranks with minimized cut-edge communication boundaries.

[AGENT-84] Slurm & Headless OpenFOAM / CalculiX Cluster Job Submitter
  - Scope: `src/core/hpc/slurm_mpi_cluster_gateway.js`, `src/core/hpc/openfoam_case_generator.js`, `src/core/hpc/calculix_case_generator.js`, `test/test_slurm_gateway.js`
  - Mission: Automated generation and submission of batch job scripts for Slurm, PBS Pro, and AWS ParallelCluster. Generates native OpenFOAM polyMesh cases (rhoCentralFoam, interFoam, chtMultiRegionFoam) and CalculiX .inp decks for 100M+ DOF distributed cluster solves.
  - Gate: Generates valid `#SBATCH` and OpenFOAM/CalculiX input decks, submits remote jobs, and streams residuals to web client.

[AGENT-85] Conflict-Free Replicated Data Type (CRDT) for Multi-User CAD
  - Scope: `src/core/collaboration/crdt_model_sync.js`, `test/test_crdt_sync.js`
  - Mission: Real-time peer-to-peer and client-server state synchronization using state-based CRDTs for multi-engineer concurrent editing of 3D assemblies.
  - Gate: Merges concurrent non-conflicting feature additions from two engineers without state diverging.

[AGENT-86] Enterprise SAML 2.0 & OpenID Connect (OIDC) SSO
  - Scope: `src/core/security/enterprise_iam.js`, `test/test_enterprise_sso.js`
  - Mission: Enterprise Single Sign-On (SSO) integration with Okta, Microsoft Entra ID (Azure AD), and PingFederate via SAML 2.0 and OIDC.
  - Gate: Validates signed SAML authentication assertion token and extracts user group claims.

[AGENT-87] Role-Based Access Control (RBAC) & ITAR Data Partitioning
  - Scope: `src/core/security/rbac_governance.js`, `test/test_rbac_governance.js`
  - Mission: Granular permission gates (View, Edit, Approve, Export) with ITAR / EAR export-controlled citizenship tagging.
  - Gate: Blocks export of ITAR-flagged 5-axis turbine blisk model for non-cleared user session.

[AGENT-88] AES-256-GCM Encrypted Project Vault & Key Rotation
  - Scope: `src/core/security/vault_encryption.js`, `test/test_vault_encryption.js`
  - Mission: Envelope encryption of engineering project databases using AES-256-GCM with automated master key derivation and rotation.
  - Gate: Encrypts and decrypts 500 MB CAD assembly package; verifies authenticated tag prevents ciphertext tampering.

[AGENT-89] Multi-Core Worker Pool Supervisor with Watchdog & Auto-Healing
  - Scope: `src/core/math/worker_pool.js`, `test/test_worker_supervisor.js`
  - Mission: Robust worker thread process supervisor with heartbeats, memory leak limits, and automatic worker recycling without stranding caller promises.
  - Gate: Handles intentional SIGSEGV in worker child process; transparently resubmits pending tasks to fresh worker.

[AGENT-90] Automated Software Bill of Materials (SBOM) & CycloneDX 1.5
  - Scope: `src/main/sbom_service.js`, `test/test_sbom_service.js`
  - Mission: Generation of CycloneDX 1.5 and SPDX 2.3 machine-readable SBOM files with cryptographically verified dependency SHA-256 digests.
  - Gate: Generates SBOM file passing CycloneDX official JSON schema validation.

================================================================================
BATTALION 10: REGULATORY QUALIFICATION & SAFETY DOSSIERS (Agents 91-100)
================================================================================
[AGENT-91] DO-330 Tool Qualification Package Generator (TQL-1 to TQL-5)
  - Scope: `src/core/compliance/do330_qualification_harness.js`, `test/test_do330_harness.js`
  - Mission: Generation of formal DO-330 tool qualification documents: Tool Qualification Plan (TQP), Tool Operational Requirements (TOR), Tool Accomplishment Summary (TAS).
  - Gate: Generates 100% compliant DO-330 lifecycle document suite for FAA/EASA DER submission.

[AGENT-92] 100% Modified Condition/Decision Coverage (MC/DC) Test Harness
  - Scope: `src/core/compliance/mcdc_test_harness.js`, `test/test_mcdc_coverage.js`
  - Mission: Automated extraction and execution of Boolean condition truth tables to prove independent condition impact for DO-178C Level A / DO-330 TQL-1.
  - Gate: Proves 100% MC/DC coverage on safety-critical PSV relief valve decision logic.

[AGENT-93] ISO 26262 ASIL-D Functional Safety Case Generator
  - Scope: `src/core/compliance/iso26262_safety_generator.js`, `test/test_iso26262_generator.js`
  - Mission: ISO 26262 Part 8 Clause 11 Software Tool Qualification dossier: Tool Safety Manual, Hazard Analysis & Risk Assessment (HARA), Tool Classification Level (TCL).
  - Gate: Emits complete automotive safety case ready for TÜV SÜD auditor review.

[AGENT-94] ASME Section VIII Div 2 Part 5 Plastic Collapse Automated Report
  - Scope: `src/core/compliance/asme_section_viii_div2_auditor.js`, `test/test_asme_div2_report.js`
  - Mission: Automated finite element elastic-plastic analysis reporting per ASME BPVC Section VIII Div 2 Part 5 (limit-load, plastic collapse, local failure, ratcheting).
  - Gate: Generates formal pressure vessel engineering report matching ASME Authorized Inspection Agency submission criteria.

[AGENT-95] Full Requirements-to-Test Traceability Matrix (RTM) Engine
  - Scope: `scripts/check_requirements_coverage.js`, `test/test_requirements_coverage.js`
  - Mission: Bidirectional traceability graph linking 100% of functional requirements to physical solver algorithms and automated verification tests.
  - Gate: Verifies zero orphan requirements or un-tested safety features in codebase.

[AGENT-96] Deterministic Seed Replay & Numerical Reproducibility Auditor
  - Scope: `scripts/check_determinism.js`, `test/test_determinism_audit.js`
  - Mission: Strict IEEE 754 floating-point reproducibility audit ensuring identical bit-level results across repeated runs on Intel/AMD and ARM architectures.
  - Gate: Verifies byte-identical output across 10 consecutive runs of full 100 Gold Regulatory Benchmarks suite.

[AGENT-97] Continuous 24-Hour Soak & Memory Leak Stress Campaign
  - Scope: `scripts/run_soak_test.js`, `test/test_soak_campaign.js`
  - Mission: 24-hour continuous stress harness cycling 10,000 simulations under memory profiling, enforcing zero cumulative memory leakage (< 1 KB/cycle).
  - Gate: Completes 5,000 simulation cycles with flat heap growth slope.

[AGENT-98] Production Packaging & Installer Suite (Windows MSI, macOS PKG, Linux RPM)
  - Scope: `package.json`, `electron-builder.yml`, `scripts/build_installers.js`
  - Mission: Automated multi-platform build scripts generating Windows 64-bit MSI installer, macOS universal PKG, and Linux RPM/DEB packages.
  - Gate: Produces valid installer packages with clean installation verification.

[AGENT-99] Zero-Vulnerability Security Audit & Dependency Lock
  - Scope: `package.json`, `package-lock.json`, `scripts/security_audit_gate.js`
  - Mission: Complete vulnerability remediation ensuring `npm audit` reports exactly 0 vulnerabilities and all external dependencies are pinned with cryptographic SHA-512 integrity hashes.
  - Gate: `npm audit --audit-level=low` exits 0 with zero findings.

[AGENT-100] Master Industrial Readiness Scorecard & Governance Audit
  - Scope: `docs/industrialization/readiness_scorecard.md`, `RELEASE_GOVERNANCE.md`
  - Mission: Synthesize all verification evidence, benchmarks, and compliance dossiers into the updated master scorecard, certifying 100% technical scope completion.
  - Gate: All 10 dimensions reach verified maximum in-repo scores with full evidence citations.

================================================================================
END OF MISSION DIRECTIVE — MERCURY 3.0 HIGH
================================================================================
