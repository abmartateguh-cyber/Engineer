/**
 * DOM-only views for scalar optics and simplified piping estimates.
 *
 * These views treat engine responses as data, not markup, and keep their
 * experimental limitations visible beside the displayed values.
 */
'use strict';

(function attachEngineeringResultView(global) {
  function failure(error) {
    return { success: false, error };
  }

  function formatFinite(value, suffix = '') {
    return Number.isFinite(value) ? `${value}${suffix}` : 'Unavailable';
  }

  function formatFiniteOrInfinity(value, suffix = '') {
    if (Number.isFinite(value)) return `${value}${suffix}`;
    return value === 'Infinity' ? `Infinity${suffix}` : 'Unavailable';
  }

  function renderCard(documentRef, container, metrics, note) {
    if (!container || !documentRef?.createElement || typeof container.replaceChildren !== 'function') {
      return failure('The engineering result container is unavailable.');
    }

    const card = documentRef.createElement('div');
    card.className = 'telemetry-card';
    for (const [label, value] of metrics) {
      const row = documentRef.createElement('div');
      row.className = 'telemetry-row';
      const labelElement = documentRef.createElement('span');
      labelElement.className = 'telemetry-label';
      labelElement.textContent = label;
      const valueElement = documentRef.createElement('span');
      valueElement.className = 'telemetry-value';
      valueElement.textContent = value;
      row.appendChild(labelElement);
      row.appendChild(valueElement);
      card.appendChild(row);
    }

    const noteElement = documentRef.createElement('div');
    noteElement.className = 'status-indicator status-warn';
    noteElement.textContent = note;
    card.appendChild(noteElement);
    container.replaceChildren(card);
    return { success: true };
  }

  function renderOpticsEstimateResult(result, documentRef, container) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return failure('No scalar optics result was returned.');
    }

    const wavelength = formatFinite(result.wavelengthNm, ' nm');
    const airyDisk = Number.isFinite(result.diffractionAiryDiskDiameter_um)
      ? `${wavelength} · ${result.diffractionAiryDiskDiameter_um} µm`
      : 'Unavailable';
    const focusLimits =
      Number.isFinite(result.nearFocusLimit_m) &&
      (Number.isFinite(result.farFocusLimit_m) || result.farFocusLimit_m === 'Infinity')
        ? `${result.nearFocusLimit_m} m / ${formatFiniteOrInfinity(result.farFocusLimit_m, ' m')}`
        : 'Unavailable';

    return renderCard(
      documentRef,
      container,
      [
        ['Entrance Pupil Diameter (D)', formatFinite(result.entrancePupilDiameterMm, ' mm')],
        ['Numerical Aperture (NA)', formatFinite(result.numericalAperture)],
        ['Airy Disk Diameter', airyDisk],
        ['Circle of Confusion', formatFinite(result.circleOfConfusionMm, ' mm')],
        ['Hyperfocal Distance (H)', formatFinite(result.hyperfocalDistance_m, ' m')],
        ['Depth of Field (DoF)', formatFiniteOrInfinity(result.depthOfField_m, ' m')],
        ['Focus Limits (Near / Far)', focusLimits],
        ['Diffraction MTF50 Limit', formatFinite(result.mtf50ResolutionLimit_lp_per_mm, ' lp/mm')]
      ],
      'Experimental scalar optics estimates only. No prescription ray trace or independently validated image-quality result was calculated.'
    );
  }

  function renderPipingStressResult(result, documentRef, container) {
    if (result?.success !== true) return failure('No successful piping estimate was returned.');

    return renderCard(
      documentRef,
      container,
      [
        ['Illustrative pressure hoop stress', formatFinite(result.hoopStress_MPa, ' MPa')],
        ['Thermal elongation', formatFinite(result.thermalElongation_mm, ' mm')],
        ['Illustrative thermal stress response', formatFinite(result.expansionStress_MPa, ' MPa')]
      ],
      'Experimental simplified estimate using unverified user inputs. This is not a code allowable or compliance decision.'
    );
  }

  const api = Object.freeze({ renderOpticsEstimateResult, renderPipingStressResult });
  if (global) global.OmniEngineeringResultView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : window);
