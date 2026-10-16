# OmniEng — Universal Multi-Industry Engineering & Simulation Platform

OmniEng is a unified, production-grade engineering platform built with Electron, Three.js, and clean computational engines. It brings together industrial-grade modeling and physics across four major technology sectors:

1. **Consumer Electronics:** PTC Creo & Siemens NX CAD packaging, SolidWorks modular chassis, Ansys Mechanical explicit drop tests, Ansys Icepak conjugate heat transfer (CHT) vapor chamber thermal simulation, and Altium/Allegro multi-layer PCB design.
2. **Semiconductor & EDA:** Synopsys Design Compiler RTL logic synthesis, standard cell technology mapping, static timing analysis (STA), Cadence Virtuoso custom IC layout, and Siemens Calibre physical verification (DRC & LVS).
3. **Drone & Aerospace Robotics:** CATIA aerodynamic surfacing, Fusion 360 generative airframes, Ansys Fluent / STAR-CCM+ Navier-Stokes rotor CFD, and MATLAB/Simulink 6-DOF quaternion flight dynamics autopilot.
4. **Oil & Gas Process Infrastructure:** AutoCAD Plant 3D & Aveva E3D piping/P&ID schematics, Aspen HYSYS Peng-Robinson thermodynamics & crude distillation fractionation, and Bentley AutoPIPE / Caesar II ASME B31.3 piping flexibility & thermal expansion loop stress analysis.

---

## Key Architecture & Features

### 1. Universal Triad
- **Parametric B-Rep CAD Kernel:** Exact topological entities (`Vertex`, `Edge`, `Face`, `SolidBody`), boundary representation volume calculation, and Wavefront `.obj` export.
- **Multiphysics CAE Solvers:** 3D tetrahedral TET4 structural finite element stiffness assembly, explicit central-difference dynamic drop impact, 2D incompressible Navier-Stokes FVM fluid grid solver, and heterogeneous 2D thermal conduction with harmonic mean interface conductivity.
- **Dynamic Simulink Math Engine:** Visual block-diagram dataflow engine (Integrators, PID Controllers, Sums, Transfer Functions, Scopes) and high-order ODE integrators (RK4, Dormand-Prince RK45, BDF1).

### 2. Dual Editing Paradigm (Manual + AI Co-Pilot)
- **Manual Parameter Sliders & Dropdowns:** Real-time inspectors on the right panel allow engineers to adjust dimensions, drop heights, material properties, pipe schedules, and PID gains with instantaneous 3D/2D viewport updates.
- **OmniAI Autonomous Co-Pilot:** Built on code-gated Model Context Protocol (MCP) tool execution. Prompts like *"Run a 2m drop test on smartphone"* or *"Synthesize 32-bit ALU"* execute exact computational physics without hallucinated calculations, simultaneously synchronizing suggested manual slider values to the inspector.

### 3. Deployment Modes
- **Local Workstation:** 100% self-contained, air-gapped, zero external cloud dependencies.
- **Cloud-Native HPC Tier:** Configurable remote dispatch for distributed cluster solves.

---

## Project Structure

```
Engineering engine/
├── main.js                          # Electron main process & IPC handlers
├── preload.js                       # Secure contextBridge API
├── package.json                     # Scripts & dependencies
├── src/
│   ├── index.html                   # Master UI, studio switchers, viewports & AI panel
│   ├── styles/
│   │   └── main.css                 # Dark mode engineering design system
│   ├── core/
│   │   ├── math/
│   │   │   ├── linear_algebra.js    # Vector3, Quaternion, Gaussian & CG solvers
│   │   │   └── ode_solvers.js       # RK4, adaptive RK45, and BDF1 stiff solvers
│   │   ├── cad/
│   │   │   ├── brep_topology.js     # Topological B-Rep kernel & primitives
│   │   │   └── feature_tree.js      # Procedural feature tree DAG
│   │   ├── cae/
│   │   │   ├── fea_structural.js    # 3D TET4 structural FEA & von Mises
│   │   │   ├── drop_test.js         # Explicit dynamic phone drop impact
│   │   │   ├── thermal_cht.js       # Conjugate heat transfer & vapor chamber
│   │   │   └── cfd_navier_stokes.js # Navier-Stokes FVM & rotor aerodynamics
│   │   ├── eda/
│   │   │   ├── logic_synthesis.js   # Verilog synthesis, tech mapping & STA
│   │   │   └── drc_engine.js        # Calibre nanometer DRC & LVS checks
│   │   ├── dynamic_simulink/
│   │   │   ├── block_graph.js       # MATLAB/Simulink block diagram execution
│   │   │   └── drone_flight_dynamics.js # 6-DOF quaternion drone flight model
│   │   ├── plant/
│   │   │   ├── thermodynamics.js    # Aspen HYSYS Peng-Robinson & distillation
│   │   │   └── piping_stress.js     # ASME B31.3 piping flexibility & stress
│   │   └── ai/
│   │       └── omni_ai_engine.js    # Code-gated MCP tool catalog & NLP router
│   ├── samples/
│   │   └── community_samples.js     # 8 turnkey reference projects
│   └── ui/
│       ├── viewport3d.js            # Three.js 3D CAD/CAE renderer
│       ├── block_diagram_ui.js      # 2D Simulink canvas editor
│       ├── schematic_layout_ui.js   # 2D EDA layout & P&ID renderer
│       └── app.js                   # Application state & studio controller
└── test/
    └── run_all_tests.js             # Comprehensive automated verification suite
```

---

## Verification & Testing

OmniEng includes a complete 22-part automated test suite that validates every mathematical algorithm, physics solver, EDA compiler, and AI handler:

```bash
npm test
```

### Verified Test Matrix:
- **Linear Algebra:** Vector3 operations, Quaternion axis-angle rotations, Gaussian Elimination & Conjugate Gradient solvers.
- **ODE Solvers:** Explicit RK4 and Adaptive Dormand-Prince (RK45) trajectory accuracy.
- **B-Rep CAD:** Parametric Box, Cylinder, Sphere primitives, bounding boxes, volumes, and OBJ generation.
- **Feature Tree DAG:** History rollback, parameter mutation, and JSON serialization.
- **Structural FEA:** 3D TET4 assembly, Dirichlet boundary conditions, nodal force load cases, and von Mises stress.
- **Drop Test Dynamics:** Explicit central-difference time stepping, contact stiffness, deceleration Gs, and aluminosilicate glass fracture.
- **Thermal CHT:** Heterogeneous 2D FVM heat conduction with harmonic interface conductance, vapor chamber heat spreading, and battery protection.
- **Logic Synthesis:** Verilog RTL tokenization, gate-level netlist generation, cell area, and static timing delay.
- **DRC & LVS:** Min width, spacing, area violation detection, and schematic-layout graph equivalence.
- **Dynamic Simulink:** Continuous-discrete closed-loop PID step response.
- **Drone 6-DOF GNC:** Quaternion kinematics, Newton-Euler body dynamics, altitude hold autopilot, and wind gust rejection.
- **Thermodynamics:** Peng-Robinson EOS parameters, Rachford-Rice VLE flash equilibrium, and crude fractionation column fractionation.
- **Piping Stress:** ASME B31.3 thermal expansion elongation, hoop stress, and expansion loop compliance.
- **OmniAI Co-Pilot:** Natural language intent routing and dual-edit synchronization.
- **Community Catalog:** 8 turnkey reference projects validated across all 4 industries.

---

## Launching the Desktop Application

To launch the native desktop application in Electron:

```bash
npm start
```
