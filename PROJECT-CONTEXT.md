# OmniEng Project Context & Baseline Specification

## 1. Project Name & Purpose
- **Project Name:** OmniEng (Universal Engineering & Simulation Engine)
- **Purpose:** A high-performance, air-gapped, multi-industry engineering and physical simulation workstation running as a native Electron desktop application. Integrates full CAD, CAE/FEA, EDA, dynamic controls/GNC, and chemical process engineering into one unified parametric DAG and dual manual/AI co-pilot interface.

## 2. Tech Stack
- **Desktop Runtime:** Electron (v41+), Node.js, WebGL/Three.js
- **Frontend Architecture:** Semantic HTML5, Vanilla Modern CSS Custom Properties, Canvas 2D/3D (Zemax Spot/MTF canvases, DSO 4-ch oscilloscope graticule, PFD stream tables)
- **Computational Core:** Pure algorithmic JavaScript (zero external numerical dependencies, zero mocks, zero web-assembly stubs)
- **Standards Conformance:**
  - ISO 10303-21 (STEP AP203/AP214) B-Rep CAD exchange
  - ISO 10110 Optical Drawing & Sellmeier Dispersion equations
  - Ucamco RS-274X Extended Gerber & Excellon NC Drill format
  - IEEE 1364 Verilog RTL synthesis and Static Timing Analysis (STA)
  - ASME B31.3 Process Piping & TEMA Shell & Tube thermal rating
  - Peng-Robinson (PR-EOS) Cubic Equation of State & Wegstein recycle tearing

## 3. Current Phase
- **Phase:** Production Readiness Audit & Upgrade Master Plan Complete (Documented in `omnieng_production_upgrade_master_plan.md`).
- **Test Baseline:** 51/51 computational tests passing green; Electron UI integration verified with 0 console errors and 0 CSP violations.
- **Production Readiness Score:** ~43% against Tier-1 commercial benchmarks (Siemens NX, Ansys Multiphysics, Cadence Virtuoso, Aspen HYSYS, Zemax OpticStudio, MATLAB/Simulink).

## 4. Key Constraints & Strategic Mandates
- **100% Proprietary Intellectual Property:** Zero open-source model weights or third-party cloud AI dependencies. All solvers, meshers, matrix operations, and the OmniAI symbolic reasoning engine are engineered natively from scratch. Open-source repositories serve strictly as reference algorithms and validation baselines.
- **Universal Usability ("Make Sure Everyone Can Use It"):** 3-tier user interface (Apprentice/Student, Practitioner, Master/Chief Engineer) featuring step-by-step intent wizards, auto-physics detection, plain-English error remediation, and universal undo/redo history.
- **Zero Mocks & Zero Dead Code:** Every computational module evaluates true physical equations.
- **Air-Gapped & Secure:** Local workstation execution, strictly isolated contextBridge IPC, hardened Content-Security-Policy (CSP).
- **Single-File `.omni` Archive:** Lossless project container storing geometry, meshes, netlists, flowsheet states, and design journals.

## 5. What "Done" Looks Like
- Full 5-phase upgrade roadmap executed from `omnieng_production_upgrade_master_plan.md`.
- NAFEMS, NASA, ISCAS, and ASME benchmark suites matching commercial software tolerances (< 0.5% error).
- 100% test pass rate across all legacy and upgrade test suites.
- Ready for native multi-platform packaging (macOS, Windows, Linux) and industrial deployment.

