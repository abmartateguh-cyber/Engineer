'use strict';

const CAD_PROFILE_POINT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y'],
  properties: {
    x: { type: 'number' },
    y: { type: 'number' }
  }
});

const CAD_PROFILE_SCHEMA = Object.freeze({
  type: 'array',
  minItems: 2,
  maxItems: 1000,
  items: CAD_PROFILE_POINT_SCHEMA
});

const CAD_EXTRUDE_PROFILE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['profile', 'depth', 'draftAngleDeg', 'lengthUnit'],
  properties: {
    profile: { ...CAD_PROFILE_SCHEMA, minItems: 3 },
    depth: { type: 'number', min: Number.MIN_VALUE, max: 1e6 },
    draftAngleDeg: { type: 'number', min: -89, max: 89 },
    lengthUnit: { type: 'string', enum: ['mm'], maxLength: 2 }
  }
});

const CAD_REVOLVE_PROFILE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['profile', 'angleDeg', 'axis', 'segments', 'lengthUnit'],
  properties: {
    profile: CAD_PROFILE_SCHEMA,
    angleDeg: { type: 'number', min: 10, max: 360 },
    axis: { type: 'string', enum: ['Y', 'Z'], maxLength: 1 },
    segments: { type: 'number', integer: true, min: 3, max: 512 },
    lengthUnit: { type: 'string', enum: ['mm'], maxLength: 2 }
  }
});

const CAD_SHELL_BODY_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['width', 'height', 'depth', 'wallThickness', 'openFaceIndex', 'lengthUnit'],
  properties: {
    width: { type: 'number', min: Number.MIN_VALUE, max: 1e6 },
    height: { type: 'number', min: Number.MIN_VALUE, max: 1e6 },
    depth: { type: 'number', min: Number.MIN_VALUE, max: 1e6 },
    wallThickness: { type: 'number', min: Number.MIN_VALUE, max: 1e6 },
    openFaceIndex: { type: 'number', integer: true, min: 0, max: 5 },
    lengthUnit: { type: 'string', enum: ['mm'], maxLength: 2 }
  }
});

module.exports = {
  CAD_EXTRUDE_PROFILE_SCHEMA,
  CAD_REVOLVE_PROFILE_SCHEMA,
  CAD_SHELL_BODY_SCHEMA
};
