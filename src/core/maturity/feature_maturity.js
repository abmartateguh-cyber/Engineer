'use strict';

const DOMAIN_MATURITY = Object.freeze({
  cad: Object.freeze({ state: 'experimental', releaseApproved: false }),
  cam: Object.freeze({ state: 'experimental', releaseApproved: false }),
  cae: Object.freeze({ state: 'experimental', releaseApproved: false }),
  cfd: Object.freeze({ state: 'experimental', releaseApproved: false }),
  eda: Object.freeze({ state: 'experimental', releaseApproved: false }),
  optics: Object.freeze({ state: 'experimental', releaseApproved: false }),
  plant: Object.freeze({ state: 'experimental', releaseApproved: false }),
  controls: Object.freeze({ state: 'experimental', releaseApproved: false }),
  aerospace: Object.freeze({ state: 'experimental', releaseApproved: false }),
  pdm: Object.freeze({ state: 'experimental', releaseApproved: false }),
  hpc: Object.freeze({ state: 'experimental', releaseApproved: false }),
  ai: Object.freeze({ state: 'experimental', releaseApproved: false }),
  system: Object.freeze({ state: 'experimental', releaseApproved: false })
});

const UNKNOWN_DOMAIN = Object.freeze({ state: 'experimental', releaseApproved: false });

function getFeatureMaturity(domain) {
  return DOMAIN_MATURITY[domain] || UNKNOWN_DOMAIN;
}

function listFeatureMaturity() {
  return Object.fromEntries(Object.entries(DOMAIN_MATURITY).map(([domain, maturity]) => [domain, { ...maturity }]));
}

module.exports = { DOMAIN_MATURITY, getFeatureMaturity, listFeatureMaturity };
