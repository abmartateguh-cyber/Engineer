/**
 * OmniEng procedural visual material helper.
 * Generated textures are illustrative rendering effects, not material-property data.
 *
 * Provides:
 * - Directional brushed-metal normal maps
 * - Micro-scratch roughness maps for visual variation
 * - Illustrative metallic and optical-surface rendering styles
 */

(function (root, factory) {
  const THREE =
    typeof window !== 'undefined' && window.THREE
      ? window.THREE
      : typeof global !== 'undefined' && global.THREE
        ? global.THREE
        : typeof require !== 'undefined'
          ? (function () {
              try {
                return require('three');
              } catch (e) {
                return null;
              }
            })()
          : null;
  const instance = factory(THREE);
  if (typeof module === 'object' && module.exports) {
    module.exports = instance;
  }
  if (typeof root !== 'undefined') {
    root.ProceduralPbrMaterials = instance;
  }
  if (typeof window !== 'undefined') {
    window.ProceduralPbrMaterials = instance;
  }
})(typeof self !== 'undefined' ? self : this, function (THREE) {
  'use strict';

  if (!THREE) {
    console.warn('ProceduralPbrMaterials requires Three.js');
  }

  /**
   * Helper: create an in-memory 2D canvas texture
   */
  function createProceduralCanvas(width, height, drawFn) {
    if (typeof document === 'undefined') {
      return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx && typeof drawFn === 'function') {
      drawFn(ctx, width, height);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  /**
   * 1. Linear Brushed Metal Normal Map
   * Simulates directional abrasive grain (lathe turning / belt sander)
   */
  function createBrushedMetalNormalMap(options = {}) {
    const width = options.width || 256;
    const height = options.height || 256;
    const grainScale = options.grainScale || 1.0;

    return createProceduralCanvas(width, height, (ctx, w, h) => {
      const imgData = ctx.createImageData(w, h);
      const data = imgData.data;

      // Fill with neutral normal (128, 128, 255)
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 128;
        data[i + 1] = 128;
        data[i + 2] = 255;
        data[i + 3] = 255;
      }

      // Add high-frequency horizontal grain striations
      for (let y = 0; y < h; y++) {
        const noise = (Math.sin(y * 1.8 * grainScale) * 0.5 + Math.random() * 0.5) * 35;
        const ny = Math.min(255, Math.max(0, 128 + Math.floor(noise)));
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          data[idx + 1] = ny; // Perturb Y normal component
        }
      }
      ctx.putImageData(imgData, 0, 0);
    });
  }

  /**
   * 2. Micro-Scratch Roughness Map
   * Adds illustrative scratch variation to a roughness texture
   */
  function createMicroScratchRoughnessMap(options = {}) {
    const width = options.width || 256;
    const height = options.height || 256;
    const baseRoughness = typeof options.baseRoughness === 'number' ? options.baseRoughness : 0.35;

    return createProceduralCanvas(width, height, (ctx, w, h) => {
      // Base roughness tone
      const baseVal = Math.floor(baseRoughness * 255);
      ctx.fillStyle = `rgb(${baseVal}, ${baseVal}, ${baseVal})`;
      ctx.fillRect(0, 0, w, h);

      // Random hairline scratches
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 0.75;
      const scratchCount = options.scratchCount || 60;

      for (let i = 0; i < scratchCount; i++) {
        ctx.beginPath();
        const sx = Math.random() * w;
        const sy = Math.random() * h;
        const len = 10 + Math.random() * 30;
        const angle = Math.random() * Math.PI * 2;
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.cos(angle) * len, sy + Math.sin(angle) * len);
        ctx.stroke();
      }
    });
  }

  /**
   * 3. Brushed-metal visual style (not alloy, temper, or finish data)
   */
  function createAnodizedAluminumMaterial(color = 0x334155, roughness = 0.32) {
    const normalMap = createBrushedMetalNormalMap({ grainScale: 1.2 });
    const roughnessMap = createMicroScratchRoughnessMap({ baseRoughness: roughness });

    const mat = new THREE.MeshStandardMaterial({
      color: color,
      metalness: 0.88,
      roughness: roughness,
      normalMap: normalMap,
      normalScale: new THREE.Vector2(0.18, 0.18),
      roughnessMap: roughnessMap
    });

    mat.userData = {
      pbrType: 'Procedural brushed-metal appearance (not material data)',
      hasDirectionalNormalMap: true,
      isIllustrativeOnly: true
    };
    return mat;
  }

  /**
   * 4. Turned-metal visual style (not alloy or finish data)
   */
  function createTurnedStainlessSteelMaterial(color = 0x94a3b8) {
    const normalMap = createBrushedMetalNormalMap({ grainScale: 2.5 });
    const roughnessMap = createMicroScratchRoughnessMap({ baseRoughness: 0.22, scratchCount: 80 });

    const mat = new THREE.MeshStandardMaterial({
      color: color,
      metalness: 0.94,
      roughness: 0.25,
      normalMap: normalMap,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughnessMap: roughnessMap
    });

    mat.userData = {
      pbrType: 'Procedural turned-metal appearance (not material data)',
      hasDirectionalNormalMap: true,
      isIllustrativeOnly: true
    };
    return mat;
  }

  /**
   * 5. Illustrative optical-surface appearance; no coating stack or transmission is calculated.
   */
  function createOpticalArCoatingMaterial(baseGlassIndex) {
    if (!Number.isFinite(baseGlassIndex) || baseGlassIndex <= 0) {
      throw new TypeError('Provide an explicit positive finite rendering index.');
    }
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x0284c7,
      metalness: 0.1,
      roughness: 0.05,
      transmission: 0.92,
      ior: baseGlassIndex,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
      specularColor: new THREE.Color(0x38bdf8),
      specularIntensity: 0.85
    });

    mat.userData = {
      pbrType: 'Illustrative optical-surface appearance (not coating data)',
      isIllustrativeOnly: true
    };
    return mat;
  }

  return {
    createBrushedMetalNormalMap,
    createMicroScratchRoughnessMap,
    createAnodizedAluminumMaterial,
    createTurnedStainlessSteelMaterial,
    createOpticalArCoatingMaterial
  };
});
