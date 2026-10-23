/**
 * OmniEng Tactile Spring & Exponential Physics Engine
 * Inspired by wheresryan22/anatomy "Time-based eased motion" rules.
 * 
 * Provides:
 * - Second-order damped harmonic oscillator: m*x'' + c*x' + k*(x - x0) = 0
 * - Exponential follow: x += (target - x) * (1 - exp(-dt / tau))
 * - 3D vector spring follower with rotational angle wrapping
 */

(function (root, factory) {
  const instance = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = instance;
  }
  if (typeof root !== 'undefined') {
    root.TactileSpringPhysics = instance;
  }
  if (typeof window !== 'undefined') {
    window.TactileSpringPhysics = instance;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class TactileSpring1D {
    /**
     * @param {Object} options
     * @param {number} [options.mass=1.0] Mass (kg)
     * @param {number} [options.stiffness=180.0] Spring constant k (N/m)
     * @param {number} [options.damping=24.0] Damping coefficient c (N*s/m)
     * @param {number} [options.initialValue=0.0] Initial position
     */
    constructor(options = {}) {
      this.mass = Math.max(0.001, options.mass || 1.0);
      this.k = options.stiffness !== undefined ? options.stiffness : 180.0;
      this.c = options.damping !== undefined ? options.damping : 24.0;
      this.value = options.initialValue || 0.0;
      this.target = options.initialValue || 0.0;
      this.velocity = 0.0;
      this.settledThreshold = options.settledThreshold || 0.0005;
      this.velocityThreshold = options.velocityThreshold || 0.0005;
    }

    setTarget(target) {
      this.target = target;
    }

    getTarget() {
      return this.target;
    }

    setValue(value) {
      this.value = value;
      this.velocity = 0.0;
    }

    getValue() {
      return this.value;
    }

    getVelocity() {
      return this.velocity;
    }

    setPreset(name) {
      if (name === 'CRITICALLY_DAMPED') {
        // c = 2 * sqrt(m * k)
        this.k = 220.0;
        this.c = 2 * Math.sqrt(this.mass * this.k);
      } else if (name === 'SPRINGY_SNAP') {
        this.k = 240.0;
        this.c = 14.0; // Under-damped (zeta ~ 0.45)
      } else if (name === 'HEAVY_INSTRUMENT') {
        this.mass = 2.5;
        this.k = 120.0;
        this.c = 34.0;
      }
    }

    update(dt) {
      // Clamp dt to avoid numerical divergence
      const step = Math.min(Math.max(dt, 0.001), 0.05);

      const displacement = this.value - this.target;
      const springForce = -this.k * displacement;
      const dampingForce = -this.c * this.velocity;
      const acceleration = (springForce + dampingForce) / this.mass;

      this.velocity += acceleration * step;
      this.value += this.velocity * step;

      // Check if settled
      if (Math.abs(displacement) < this.settledThreshold && Math.abs(this.velocity) < this.velocityThreshold) {
        this.value = this.target;
        this.velocity = 0.0;
        return true; // settled
      }
      return false; // still moving
    }

    isSettled() {
      return (Math.abs(this.value - this.target) < this.settledThreshold) && (Math.abs(this.velocity) < this.velocityThreshold);
    }
  }

  class TactileSpringFollower3D {
    /**
     * @param {Object} options
     * @param {number} [options.stiffness=180.0]
     * @param {number} [options.damping=24.0]
     */
    constructor(options = {}) {
      this.x = new TactileSpring1D({ stiffness: options.stiffness || 180.0, damping: options.damping || 24.0 });
      this.y = new TactileSpring1D({ stiffness: options.stiffness || 180.0, damping: options.damping || 24.0 });
      this.z = new TactileSpring1D({ stiffness: options.stiffness || 180.0, damping: options.damping || 24.0 });
    }

    setTarget(x, y, z) {
      this.x.setTarget(x);
      this.y.setTarget(y);
      this.z.setTarget(z);
    }

    setValue(x, y, z) {
      this.x.setValue(x);
      this.y.setValue(y);
      this.z.setValue(z);
    }

    setPreset(name) {
      this.x.setPreset(name);
      this.y.setPreset(name);
      this.z.setPreset(name);
    }

    update(dt) {
      const sx = this.x.update(dt);
      const sy = this.y.update(dt);
      const sz = this.z.update(dt);
      return sx && sy && sz;
    }

    getValues() {
      return { x: this.x.value, y: this.y.value, z: this.z.value };
    }

    isSettled() {
      return this.x.isSettled() && this.y.isSettled() && this.z.isSettled();
    }
  }

  /**
   * Exponential Follow helper:
   * x += (target - x) * (1 - exp(-dt / tau))
   */
  function exponentialFollow(current, target, dt, tau = 0.08) {
    if (Math.abs(target - current) < 1e-6) return target;
    const factor = 1.0 - Math.exp(-Math.max(dt, 0.001) / Math.max(tau, 0.001));
    return current + (target - current) * factor;
  }

  /**
   * Exponential Follow for 3D coordinates
   */
  function exponentialFollow3D(current, target, dt, tau = 0.08) {
    return {
      x: exponentialFollow(current.x, target.x, dt, tau),
      y: exponentialFollow(current.y, target.y, dt, tau),
      z: exponentialFollow(current.z, target.z, dt, tau)
    };
  }

  return {
    TactileSpring1D,
    TactileSpringFollower3D,
    exponentialFollow,
    exponentialFollow3D
  };
}));
