/**
 * OmniEng Interactive Cinematic Storytelling Rails Engine
 * Inspired by wheresryan22/anatomy step-by-step breakdown & interactive inspect tours.
 * 
 * Provides:
 * - 5-Stage narrative CAD article breakdown choreography
 * - Discrete keyframes: Overview -> Section Cut -> Exploded Internals -> Micro Fasteners -> Dynamics
 * - Tactile spring camera transitions and clip plane interpolation
 * - Automated tour playback with pause/resume and keyboard shortcuts
 */

(function (root, factory) {
  const instance = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = instance;
  }
  if (typeof root !== 'undefined') {
    root.StorytellingRails = instance;
  }
  if (typeof window !== 'undefined') {
    window.StorytellingRails = instance;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_STAGES = [
    {
      id: 'overview',
      index: 0,
      title: 'Stage 1: Engineering Spec Overview',
      subtitle: 'Complete exterior assembly with ISO dimensional boundary envelope',
      cameraTarget: { x: 0, y: 0, z: 0 },
      cameraPos: { x: 120, y: 90, z: 180 },
      explodeFactor: 0.0,
      clippingEnabled: false,
      phenomenaActive: false
    },
    {
      id: 'section_cut',
      index: 1,
      title: 'Stage 2: Longitudinal Section Cutaway',
      subtitle: 'Internal bore clearance, wall thickness, and sealing gasket seats',
      cameraTarget: { x: 0, y: 0, z: 0 },
      cameraPos: { x: 0, y: 40, z: 150 },
      explodeFactor: 0.0,
      clippingEnabled: true,
      clipPlaneConstant: 0.0,
      phenomenaActive: false
    },
    {
      id: 'exploded_view',
      index: 2,
      title: 'Stage 3: Exploded Subassembly Trajectory',
      subtitle: 'Kinematic fastener separation and hierarchical bill of materials',
      cameraTarget: { x: 0, y: 10, z: 0 },
      cameraPos: { x: 140, y: 120, z: 220 },
      explodeFactor: 1.0,
      clippingEnabled: false,
      phenomenaActive: false
    },
    {
      id: 'micro_inspection',
      index: 3,
      title: 'Stage 4: Precision Micro-Hardware Inspection',
      subtitle: 'Macro focus on ISO 4762 cap screws, knurls, and Bourdon gauge needle',
      cameraTarget: { x: 15, y: 25, z: 10 },
      cameraPos: { x: 35, y: 40, z: 45 },
      explodeFactor: 0.35,
      clippingEnabled: false,
      phenomenaActive: false
    },
    {
      id: 'operational_dynamics',
      index: 4,
      title: 'Stage 5: Operational Physical Dynamics',
      subtitle: 'Supersonic Mach shock diamonds, transient vibration, and thermal telemetry',
      cameraTarget: { x: 0, y: -20, z: 0 },
      cameraPos: { x: 160, y: -30, z: 190 },
      explodeFactor: 0.0,
      clippingEnabled: false,
      phenomenaActive: true
    }
  ];

  class StorytellingRailsController {
    /**
     * @param {Object} options
     * @param {Object} [options.viewport3d] Viewport3D instance to drive
     * @param {Array} [options.stages] Custom stage array
     */
    constructor(options = {}) {
      this.viewport3d = options.viewport3d || null;
      this.stages = options.stages || DEFAULT_STAGES;
      this.currentStageIndex = 0;
      this.isPlayingTour = false;
      this.tourTimer = null;
      this.stageChangeCallbacks = [];
      this.tourIntervalMs = options.tourIntervalMs || 4500;
    }

    setViewport(vp) {
      this.viewport3d = vp;
    }

    getStages() {
      return this.stages;
    }

    getCurrentStage() {
      return this.stages[this.currentStageIndex];
    }

    getCurrentStageIndex() {
      return this.currentStageIndex;
    }

    /**
     * Jump smoothly to a specific stage
     */
    setStage(indexOrId) {
      let targetIndex = -1;
      if (typeof indexOrId === 'number') {
        targetIndex = Math.max(0, Math.min(this.stages.length - 1, indexOrId));
      } else if (typeof indexOrId === 'string') {
        targetIndex = this.stages.findIndex(s => s.id === indexOrId);
      }

      if (targetIndex < 0) return;
      this.currentStageIndex = targetIndex;
      const stage = this.stages[this.currentStageIndex];

      // Drive Viewport3D camera and states
      if (this.viewport3d) {
        if (this.viewport3d.cameraFollower && stage.cameraPos) {
          this.viewport3d.cameraFollower.setTarget(stage.cameraPos.x, stage.cameraPos.y, stage.cameraPos.z);
        }
        if (this.viewport3d.controls && stage.cameraTarget) {
          if (this.viewport3d.controls.target) {
            this.viewport3d.controls.target.set(stage.cameraTarget.x, stage.cameraTarget.y, stage.cameraTarget.z);
          }
        }
        if (typeof stage.explodeFactor === 'number' && this.viewport3d.currentMesh?.userData?.updateExplode) {
          this.viewport3d.currentMesh.userData.updateExplode(stage.explodeFactor);
        }
        if (typeof this.viewport3d.toggleSectionCut === 'function') {
          if (this.viewport3d.sectionCutEnabled !== stage.clippingEnabled) {
            this.viewport3d.toggleSectionCut(stage.clippingEnabled);
          }
        }
      }

      // Notify registered UI listeners
      this._notifyStageChange(stage);
      return stage;
    }

    nextStage() {
      const nextIdx = (this.currentStageIndex + 1) % this.stages.length;
      return this.setStage(nextIdx);
    }

    prevStage() {
      const prevIdx = (this.currentStageIndex - 1 + this.stages.length) % this.stages.length;
      return this.setStage(prevIdx);
    }

    scrubToStage(stageIndexOrId) {
      return this.setStage(stageIndexOrId);
    }

    startTour(intervalMs = null) {
      if (intervalMs) this.tourIntervalMs = intervalMs;
      this.isPlayingTour = true;
      this._clearTourTimer();

      this.tourTimer = setInterval(() => {
        this.nextStage();
      }, this.tourIntervalMs);

      this._notifyTourState();
    }

    pauseTour() {
      this.isPlayingTour = false;
      this._clearTourTimer();
      this._notifyTourState();
    }

    toggleTour() {
      if (this.isPlayingTour) {
        this.pauseTour();
      } else {
        this.startTour();
      }
      return this.isPlayingTour;
    }

    _clearTourTimer() {
      if (this.tourTimer) {
        clearInterval(this.tourTimer);
        this.tourTimer = null;
      }
    }

    loadStagePreset(presetName = 'default') {
      if (presetName === 'nasa_rocket') {
        this.stages = NASA_ROCKET_STAGES;
      } else {
        this.stages = DEFAULT_STAGES;
      }
      this.currentStageIndex = 0;
      this.setStage(0);
      return this.stages;
    }

    onStageChange(callback) {
      if (typeof callback === 'function') {
        this.stageChangeCallbacks.push(callback);
      }
    }

    _notifyStageChange(stage) {
      this.stageChangeCallbacks.forEach(cb => {
        try { cb(stage, this.currentStageIndex, this.stages.length); } catch (e) { /* ignore */ }
      });
    }

    _notifyTourState() {
      const btn = typeof document !== 'undefined' ? document.getElementById('btn-storytelling-play') : null;
      if (btn) {
        btn.classList.toggle('active', this.isPlayingTour);
        btn.title = this.isPlayingTour ? 'Pause Cinematic Breakdown Tour' : 'Play Cinematic Breakdown Tour';
      }
    }
  }

  const NASA_ROCKET_STAGES = [
    {
      id: 'nasa_launch_pad',
      index: 0,
      title: 'Chapter 1: NASA Space Launch System WBS Overview',
      subtitle: 'Complete 2-stage orbital vehicle with isogrid tanks, grid fins, and octaweb propulsion cluster',
      cameraTarget: { x: 0, y: 55, z: 0 },
      cameraPos: { x: 140, y: 75, z: 230 },
      explodeFactor: 0.0,
      clippingEnabled: false,
      phenomenaActive: false
    },
    {
      id: 'nasa_max_q',
      index: 1,
      title: 'Chapter 2: Transonic Max-Q Aerodynamics & Staging Frangible Ring',
      subtitle: '1976 Standard Atmosphere peak dynamic pressure (38.5 kPa) and linear shaped charge separation',
      cameraTarget: { x: 0, y: 95, z: 0 },
      cameraPos: { x: 60, y: 105, z: 120 },
      explodeFactor: 0.15,
      clippingEnabled: false,
      phenomenaActive: true
    },
    {
      id: 'nasa_staging_cut',
      index: 2,
      title: 'Chapter 3: Interstage Separation & Vacuum Engine Ignition',
      subtitle: 'Stage 1 booster separation and Stage 2 C-103 high-expansion niobium nozzle deployment',
      cameraTarget: { x: 0, y: 115, z: 0 },
      cameraPos: { x: 90, y: 125, z: 150 },
      explodeFactor: 0.65,
      clippingEnabled: false,
      phenomenaActive: true
    },
    {
      id: 'nasa_payload_orbit',
      index: 3,
      title: 'Chapter 4: Fairing Jettison & Satellite Payload Accommodation',
      subtitle: 'Bisector fairing acoustic blankets release, Marmon low-shock clampband, and triple-junction solar panels',
      cameraTarget: { x: 0, y: 155, z: 0 },
      cameraPos: { x: 45, y: 165, z: 80 },
      explodeFactor: 0.40,
      clippingEnabled: false,
      phenomenaActive: false
    },
    {
      id: 'nasa_macro_engine',
      index: 4,
      title: 'Chapter 5: Deep Macro Engine Anatomy & Narloy-Z Milled Channels',
      subtitle: '42,000 RPM methane turbopump impellers, coaxial swirl injector dome, and Bartz cooling channels',
      cameraTarget: { x: 0, y: 10, z: 0 },
      cameraPos: { x: 25, y: 25, z: 50 },
      explodeFactor: 0.0,
      clippingEnabled: false,
      phenomenaActive: true
    }
  ];

  return {
    DEFAULT_STAGES,
    NASA_ROCKET_STAGES,
    StorytellingRailsController,
    createController: (options) => new StorytellingRailsController(options)
  };
}));
