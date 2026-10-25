'use strict';

const CONTACT_MECHANICS_SCHEMA = Object.freeze({
  type: 'object',
  required: ['radius', 'load', 'E1', 'nu1', 'E2', 'nu2'],
  properties: {
    radius: { type: 'number', min: Number.MIN_VALUE },
    load: { type: 'number', min: Number.MIN_VALUE },
    E1: { type: 'number', min: Number.MIN_VALUE },
    nu1: { type: 'number', min: -0.999999999, max: 0.499999999 },
    E2: { type: 'number', min: Number.MIN_VALUE },
    nu2: { type: 'number', min: -0.999999999, max: 0.499999999 }
  }
});

const NONLINEAR_CANTILEVER_ESTIMATE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['length', 'width', 'height', 'E', 'P', 'lengthUnit', 'modulusUnit', 'forceUnit'],
  properties: {
    length: { type: 'number', min: Number.MIN_VALUE, max: 1e9 },
    width: { type: 'number', min: Number.MIN_VALUE, max: 1e9 },
    height: { type: 'number', min: Number.MIN_VALUE, max: 1e9 },
    E: { type: 'number', min: Number.MIN_VALUE, max: 1e12 },
    P: { type: 'number', min: Number.MIN_VALUE, max: 1e15 },
    lengthUnit: { type: 'string', enum: ['mm'], maxLength: 2 },
    modulusUnit: { type: 'string', enum: ['MPa'], maxLength: 3 },
    forceUnit: { type: 'string', enum: ['N'], maxLength: 1 }
  }
});

module.exports = { CONTACT_MECHANICS_SCHEMA, NONLINEAR_CANTILEVER_ESTIMATE_SCHEMA };
