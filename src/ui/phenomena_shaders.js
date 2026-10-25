/**
 * OmniEng Decorative WebGL Effects
 * These shaders animate interface visuals; they do not simulate physical phenomena.
 * 
 * Provides:
 * - Animated plume-like visual effect
 * - Decorative beam and color-fringe effect
 * - Animated shimmer effect
 */

(function (root, factory) {
  const THREE = (typeof window !== 'undefined' && window.THREE) ? window.THREE : ((typeof global !== 'undefined' && global.THREE) ? global.THREE : (typeof require !== 'undefined' ? (function () { try { return require('three'); } catch (e) { return null; } })() : null));
  const instance = factory(THREE);
  if (typeof module === 'object' && module.exports) {
    module.exports = instance;
  }
  if (typeof root !== 'undefined') {
    root.PhenomenaShaders = instance;
  }
  if (typeof window !== 'undefined') {
    window.PhenomenaShaders = instance;
  }
}(typeof self !== 'undefined' ? self : this, function (THREE) {
  'use strict';

  if (!THREE) {
    console.warn('PhenomenaShaders requires Three.js');
  }

  /** Create an animated plume-like effect for illustrative scenes. */
  function createSupersonicPlumeMaterial(options = {}) {
    const legacyFrequency = typeof options.shockCount === 'number' ? options.shockCount : 4.0;
    const visualFrequency = Number.isFinite(options.visualFrequency) ? options.visualFrequency : legacyFrequency;
    const uTime = { value: 0.0 };

    const uniforms = {
      uTime: uTime,
      u_time: uTime,
      u_coreColor: { value: new THREE.Color(options.accentColor || options.coreColor || 0x38bdf8) },
      u_flameColor: { value: new THREE.Color(options.flameColor || 0x0284c7) },
      u_shockColor: { value: new THREE.Color(options.shockColor || 0xffffff) },
      u_visualFrequency: { value: options.visualFrequency || options.machFrequency || legacyFrequency },
      u_intensity: { value: options.intensity || 1.4 }
    };

    const vertexShader = `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `;

    const fragmentShader = `
      uniform float u_time;
      uniform vec3 u_coreColor;
      uniform vec3 u_flameColor;
      uniform vec3 u_shockColor;
      uniform float u_visualFrequency;
      uniform float u_intensity;

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        // y is axial direction (0 at nozzle, 1 at plume tip)
        float axial = vUv.y;
        float radial = abs(vUv.x - 0.5) * 2.0;

        // Radial bell Gaussian envelope
        float coreRadius = (1.0 - axial * 0.45);
        float radialEnvelope = smoothstep(1.0, 0.0, radial / coreRadius);

        // Axial fading envelope (soft entrance, smooth trailing fade)
        float axialFade = smoothstep(0.0, 0.08, axial) * smoothstep(1.0, 0.35, axial);

        // Repeating decorative bands
        float bandWave = sin(axial * u_visualFrequency * 6.28318 - u_time * 2.5);
        float bandCore = pow(max(0.0, bandWave), 4.0) * (1.0 - radial);

        // Decorative edge motion
        float jitter = sin(axial * 42.0 + u_time * 18.0) * 0.08 * axial;
        radialEnvelope = clamp(radialEnvelope + jitter, 0.0, 1.0);

        // Blend plume gradient
        vec3 col = mix(u_flameColor, u_coreColor, radialEnvelope * (1.0 - axial * 0.5));
        col = mix(col, u_shockColor, bandCore * 0.9 * (1.0 - axial));

        float alpha = (radialEnvelope * 0.85 + bandCore * 0.6) * axialFade * u_intensity;
        alpha = clamp(alpha, 0.0, 0.92);

        gl_FragColor = vec4(col, alpha);
      }
    `;

    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });
  }

  /** Builds synthetic plume-like geometry for interface visualization only. */
  function createIllustrativePlume(options = {}) {
    const plumeLength = options.plumeLength || 100;
    const coreRadius = options.coreRadius || 16;
    const geom = new THREE.CylinderGeometry(coreRadius * 0.35, coreRadius, plumeLength, 32, 1, true);
    geom.translate(0, -plumeLength * 0.5, 0);

    const mat = createSupersonicPlumeMaterial(options);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData = {
      type: 'Illustrative Plume Visual Effect',
      isSyntheticExample: true,
      physicsSimulation: false
    };
    return mesh;
  }

  // Backward-compatible alias; this does not calculate a supersonic flow.
  const createSupersonicPlume = createIllustrativePlume;

  /**
   * 2. Volumetric Optical Laser Beam & Caustic Ray Dispersion Shader
   */
  function createCausticBeamShaderMaterial(color = 0x38bdf8, dispersion = 2.0) {
    const uTime = { value: 0.0 };
    const beamColor = (typeof color === 'number' || (color && color.isColor)) ? color : 0x38bdf8;
    const dispVal = typeof dispersion === 'number' ? dispersion : 2.0;

    const uniforms = {
      uTime: uTime,
      u_time: uTime,
      uDispersion: { value: dispVal },
      u_beamColor: { value: new THREE.Color(beamColor) },
      u_fringeColor: { value: new THREE.Color(0x818cf8) },
      u_intensity: { value: 1.2 }
    };

    const vertexShader = `
      varying vec2 vUv;
      varying vec3 vNormal;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      uniform float u_time;
      uniform vec3 u_beamColor;
      uniform vec3 u_fringeColor;
      uniform float u_intensity;
      uniform float uDispersion;

      varying vec2 vUv;
      varying vec3 vNormal;

      void main() {
        // Radial beam intensity
        float radial = abs(vUv.x - 0.5) * 2.0;
        float core = exp(-radial * radial * (2.5 + uDispersion));

        // Longitudinal wave packet interference
        float interference = sin(vUv.y * 80.0 - u_time * 12.0) * 0.12 + 0.9;

        // Chromatic fringe dispersion on boundary
        vec3 col = mix(u_fringeColor, u_beamColor, core);

        // Axial soft fade
        float axialFade = smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
        float alpha = core * interference * axialFade * u_intensity;

        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.85));
      }
    `;

    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });
  }

  function createCausticBeamMaterial(options = {}) {
    const col = options.beamColor || 0x38bdf8;
    const disp = options.dispersion || 2.0;
    return createCausticBeamShaderMaterial(col, disp);
  }

  /**
   * 3. Thermal Gradient Mirage / Heat-Shimmer Material
   */
  function createThermalMirageMaterial(color = 0xf59e0b, freq = 30.0) {
    const uTime = { value: 0.0 };
    const heatColor = (typeof color === 'number' || (color && color.isColor)) ? color : 0xf59e0b;
    const frequency = typeof freq === 'number' ? freq : 30.0;

    const uniforms = {
      uTime: uTime,
      u_time: uTime,
      uFrequency: { value: frequency },
      u_heatColor: { value: new THREE.Color(heatColor) },
      u_intensity: { value: 0.6 }
    };

    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      uniform float u_time;
      uniform vec3 u_heatColor;
      uniform float u_intensity;
      uniform float uFrequency;
      varying vec2 vUv;

      void main() {
        float shimmer = sin(vUv.y * uFrequency + u_time * 8.0) * cos(vUv.x * 20.0 - u_time * 6.0);
        float alpha = smoothstep(1.0, 0.0, abs(vUv.x - 0.5) * 2.0) * (0.3 + 0.2 * shimmer) * u_intensity;
        gl_FragColor = vec4(u_heatColor, clamp(alpha, 0.0, 0.5));
      }
    `;

    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });
  }

  function createThermalShimmerMaterial(options = {}) {
    const col = options.heatColor || 0xf59e0b;
    const freq = options.frequency || 30.0;
    return createThermalMirageMaterial(col, freq);
  }

  return {
    createIllustrativePlume,
    createSupersonicPlume,
    createSupersonicPlumeMaterial,
    createCausticBeamShaderMaterial,
    createCausticBeamMaterial,
    createThermalMirageMaterial,
    createThermalShimmerMaterial
  };
}));
