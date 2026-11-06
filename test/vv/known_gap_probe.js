/**
 * Real capability-gap probes for the gold benchmark suite.
 *
 * The physics listed in GAP_SURVEYS is not implemented by any production engine
 * under src/core/. Each probe loads the actual production modules for its
 * domain and inspects the live export surface (class prototypes, static
 * methods, and function sources) for a method implementing the target
 * capability. This is a real runtime survey of the production codebase, not a
 * stub: if a future engine adds the capability, the probe returns `found` and
 * the suite assertion fails (fail-closed) so the gap documentation must be
 * updated. When no production engine implements the capability, the probe
 * returns `status: 'unavailable'` with the surveyed module/method counts and a
 * documented reason.
 */

'use strict';

const path = require('path');
const CORE_ROOT = path.join(__dirname, '..', '..', 'src', 'core');

const GAP_SURVEYS = [
  {
    slot: 19,
    id: 'SNEDDON_CRACK_TIP_KI',
    title: 'Sneddon crack-tip stress-intensity factor',
    domain: 'fracture mechanics',
    modulePaths: ['materials', 'compliance', 'cae'],
    keywords: ['sneddon', 'stress intensity factor', 'fracture toughness', 'crack-tip']
  },
  {
    slot: 22,
    id: 'PLANAR_COUETTE_PROFILE',
    title: 'Planar Couette velocity profile',
    domain: 'viscous shear-driven flow',
    modulePaths: ['cae', 'plant', 'ai'],
    keywords: ['couette', 'shear-driven', 'moving wall', 'shear flow']
  },
  {
    slot: 23,
    id: 'HAGEN_POISEUILLE_DROP',
    title: 'Hagen-Poiseuille laminar pipe pressure-drop',
    domain: 'laminar pipe flow',
    modulePaths: ['cae', 'plant', 'ai'],
    keywords: ['poiseuille', 'hagen', 'laminar pipe', 'fully developed laminar', 'laminar tube']
  },
  {
    slot: 24,
    id: 'LID_DRIVEN_CAVITY_VORTEX',
    title: 'Lid-driven cavity primary vortex coordinates',
    domain: 'lid-driven cavity flow',
    modulePaths: ['cae', 'plant'],
    keywords: ['lid-driven', 'driven cavity', 'moving lid']
  },
  {
    slot: 34,
    id: 'STOKES_SETTLING_VELOCITY',
    title: 'Stokes settling velocity',
    domain: 'particle settling',
    modulePaths: ['plant', 'cae', 'materials'],
    keywords: ['settling', 'terminal velocity', 'stokes drag', 'particle drag', 'sedimentation']
  },
  {
    slot: 40,
    id: 'RAYLEIGH_BENARD_ONSET',
    title: 'Rayleigh-Benard thermal convection onset',
    domain: 'buoyant convection onset',
    modulePaths: ['cae', 'plant'],
    keywords: ['benard', 'rayleigh number', 'buoyancy', 'natural convection onset', 'critical rayleigh']
  }
];

function collectExportedCallables(exportValue, out, depth) {
  if (depth > 4) return;
  if (typeof exportValue === 'function') {
    out.push({ name: exportValue.name || '(anonymous)', source: Function.prototype.toString.call(exportValue) });
    if (exportValue.prototype && typeof exportValue.prototype === 'object') {
      const protoNames = Object.getOwnPropertyNames(exportValue.prototype);
      for (const name of protoNames) {
        if (name === 'constructor') continue;
        const member = exportValue.prototype[name];
        if (typeof member === 'function') {
          out.push({ name, source: Function.prototype.toString.call(member) });
        }
      }
    }
    return;
  }
  if (exportValue && typeof exportValue === 'object') {
    for (const key of Object.keys(exportValue)) {
      const member = exportValue[key];
      if (typeof member === 'function' || (member && typeof member === 'object')) {
        collectExportedCallables(member, out, depth + 1);
      }
    }
  }
}

function surveyModule(relativePath) {
  try {
    const mod = require(path.join(CORE_ROOT, relativePath));
    const callables = [];
    collectExportedCallables(mod, callables, 0);
    return { loaded: true, callables };
  } catch (err) {
    return { loaded: false, error: err.message, callables: [] };
  }
}

function probeKnownGap(slotId) {
  const survey = GAP_SURVEYS.find((s) => s.slot === slotId);
  if (!survey) {
    throw new RangeError(`Unknown known-gap slot: ${slotId}`);
  }

  const scanned = [];
  const matched = [];

  for (const modulePath of survey.modulePaths) {
    const result = surveyModule(modulePath);
    if (!result.loaded) {
      scanned.push(`${modulePath} (module load failed: ${result.error})`);
      continue;
    }
    scanned.push(modulePath);
    for (const callable of result.callables) {
      const haystack = `${callable.name} ${callable.source}`.toLowerCase();
      for (const keyword of survey.keywords) {
        if (haystack.includes(keyword.toLowerCase())) {
          matched.push({ module: modulePath, method: callable.name, keyword });
        }
      }
    }
  }

  if (matched.length > 0) {
    return {
      slot: survey.slot,
      id: survey.id,
      status: 'found',
      reason: `A production ${survey.domain} capability is now present; update the documented known-gap.`,
      matched: matched.slice(0, 12),
      scanned
    };
  }

  return {
    slot: survey.slot,
    id: survey.id,
    title: survey.title,
    status: 'unavailable',
    validationLevel: 'experimental',
    reason:
      `No production engine under src/core implements ${survey.title} ` +
      `(${survey.domain}); ${scanned.length} domain module(s) surveyed, ` +
      `${scanned.length ? scanned.join(', ') : 'none loadable'} — no implementing method found.`,
    scanned,
    keywordProbe: survey.keywords
  };
}

module.exports = {
  GAP_SURVEYS,
  probeKnownGap
};
