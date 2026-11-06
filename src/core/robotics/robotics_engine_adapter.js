'use strict';

const crypto = require('crypto');
const { EngineAdapter } = require('../contracts/EngineAdapter');
const { JobResult, JobStatus } = require('../contracts/JobResult');
const { Quantity, UnitRegistry, Dimensions } = require('../contracts/Quantity');
const { ValidationRecord, ValidationMaturity } = require('../contracts/ValidationRecord');
const { OmniError, OmniErrorCode } = require('../contracts/OmniError');
const { SerialManipulatorEngine, PUMA_560_DH, UR5E_DH, KUKA_IIWA_7DOF_DH } = require('./serial_manipulator_kinematics');
const { checkRobotPath } = require('./collision_checks');

// Ensure robotics physical units exist in UnitRegistry
if (!UnitRegistry['N*m']) {
  UnitRegistry['N*m'] = { dim: Dimensions.ENERGY, scale: 1.0, offset: 0 };
}
if (!UnitRegistry['rad/s']) {
  UnitRegistry['rad/s'] = { dim: Dimensions.FREQUENCY, scale: 1.0, offset: 0 };
}
if (!UnitRegistry['rad/s^2']) {
  UnitRegistry['rad/s^2'] = { dim: Object.freeze([0, 0, -2, 0, 0, 0, 0]), scale: 1.0, offset: 0 };
}
if (!UnitRegistry['m/s^2']) {
  UnitRegistry['m/s^2'] = { dim: Dimensions.ACCELERATION, scale: 1.0, offset: 0 };
}
if (!UnitRegistry['dimensionless']) {
  UnitRegistry['dimensionless'] = { dim: Dimensions.DIMENSIONLESS, scale: 1.0, offset: 0 };
}

const SUPPORTED_OPERATIONS = Object.freeze([
  'forward_kinematics',
  'inverse_kinematics',
  'inverse_dynamics',
  'trajectory_plan',
  'parse_urdf',
  'collision_check'
]);

const MAX_ROBOT_DOF = 32;
const MAX_COLLISION_OBSTACLES = 256;
const MAX_COLLISION_TOTAL_TRIANGLES = 200000;
const MAX_COLLISION_NUM_SAMPLES = 200000;
const MIN_COLLISION_STEP = 1e-6;
const MAX_TRAJECTORY_NUM_STEPS = 500000;
const MAX_URDF_XML_CHARS = 2 * 1024 * 1024;

const PRESET_REGISTRY = Object.freeze({
  PUMA_560: PUMA_560_DH,
  PUMA_560_DH: PUMA_560_DH,
  UR5E: UR5E_DH,
  UR5E_DH: UR5E_DH,
  KUKA_IIWA: KUKA_IIWA_7DOF_DH,
  KUKA_IIWA_7DOF: KUKA_IIWA_7DOF_DH,
  KUKA_IIWA_7DOF_DH: KUKA_IIWA_7DOF_DH
});

/**
 * RoboticsEngineAdapter — Canonical EngineAdapter for Serial Manipulator
 * Kinematics, Dynamics, Trajectory Planning, and URDF Parsing.
 *
 * Enforces fail-closed validation via OmniError, wraps physical outputs
 * in Quantity objects, and labels outputs experimental pending independent review.
 */
class RoboticsEngineAdapter extends EngineAdapter {
  constructor() {
    super('robotics', 'robotics-kinematics-dynamics-adapter', '2.0.0');
  }

  describeCapabilities() {
    return {
      domain: this.domain,
      name: this.name,
      version: this.version,
      maturity: ValidationMaturity.EXPERIMENTAL,
      supportedOperations: [...SUPPORTED_OPERATIONS],
      presets: Object.keys(PRESET_REGISTRY),
      native: false,
      features: [
        'standard_and_modified_dh_forward_kinematics',
        'product_of_exponentials_screw_kinematics',
        'geometric_jacobian_and_yoshikawa_manipulability',
        'damped_least_squares_levenberg_marquardt_ik',
        'recursive_newton_euler_inverse_dynamics',
        'minimum_jerk_quintic_trajectory_generation',
        'deterministic_urdf_xml_json_parser',
        'aabb_broadphase_triangle_triangle_narrowphase_collision_check',
        'joint_space_path_collision_check_robot_scene'
      ]
    };
  }

  /**
   * Extract operation and parameters from either a standard JobRequest
   * ({ domain, operation, parameters }) or an inputs-style job object.
   * @private
   */
  _extractRequest(jobRequest) {
    if (!jobRequest || typeof jobRequest !== 'object') {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'RoboticsEngineAdapter received null or non-object jobRequest');
    }
    const params =
      jobRequest.parameters &&
      typeof jobRequest.parameters === 'object' &&
      Object.keys(jobRequest.parameters).length > 0
        ? jobRequest.parameters
        : jobRequest.inputs && typeof jobRequest.inputs === 'object'
          ? jobRequest.inputs
          : jobRequest.parameters || {};
    const operation = jobRequest.operation || params.operation;
    return { operation, params };
  }

  /**
   * Resolve and validate the manipulator kinematic model from parameters.
   * Never silently substitutes a default robot for direct API calls.
   * @private
   */
  _resolveManipulator(params, operation, jobRequest = null) {
    const dhArray = params.dhTable !== undefined ? params.dhTable : params.dhParams;
    if (Array.isArray(dhArray)) {
      if (dhArray.length === 0) {
        throw new OmniError(OmniErrorCode.INVALID_INPUT, `${operation} requires a non-empty dhTable array`, {
          domain: this.domain,
          operation
        });
      }
      if (dhArray.length > MAX_ROBOT_DOF) {
        throw new OmniError(OmniErrorCode.INVALID_INPUT, `${operation} dhTable is limited to ${MAX_ROBOT_DOF} links`, {
          domain: this.domain,
          operation,
          maxDof: MAX_ROBOT_DOF
        });
      }
      for (let i = 0; i < dhArray.length; i++) {
        const row = dhArray[i];
        if (!row || typeof row !== 'object') {
          throw new OmniError(OmniErrorCode.INVALID_INPUT, `${operation} dhTable[${i}] must be an object`, {
            domain: this.domain,
            operation,
            index: i
          });
        }
        const a = row.a !== undefined ? row.a : 0;
        const alpha = row.alpha !== undefined ? row.alpha : 0;
        const d = row.d !== undefined ? row.d : 0;
        if (!Number.isFinite(a) || !Number.isFinite(alpha) || !Number.isFinite(d)) {
          throw new OmniError(
            OmniErrorCode.INVALID_INPUT,
            `${operation} dhTable[${i}] contains non-finite kinematic parameters (a, alpha, d)`,
            { domain: this.domain, operation, index: i }
          );
        }
      }
      return {
        convention: params.convention || 'standard_dh',
        dhTable: dhArray,
        dof: dhArray.length
      };
    }

    const poeObj =
      params.poeConfig && typeof params.poeConfig === 'object'
        ? params.poeConfig
        : Array.isArray(params.screwAxes)
          ? { screwAxes: params.screwAxes, homeTransform: params.homeTransform || params.M }
          : null;

    if (poeObj) {
      const screwAxes = poeObj.screwAxes || poeObj.S;
      const homeTransform = poeObj.homeTransform || poeObj.M;
      if (!Array.isArray(screwAxes) || screwAxes.length === 0 || !Array.isArray(homeTransform)) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          `${operation} poeConfig requires non-empty screwAxes and 4x4 homeTransform`,
          { domain: this.domain, operation }
        );
      }
      if (screwAxes.length > MAX_ROBOT_DOF) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          `${operation} poeConfig screwAxes is limited to ${MAX_ROBOT_DOF} rows`,
          { domain: this.domain, operation, maxDof: MAX_ROBOT_DOF }
        );
      }
      return {
        convention: 'poe',
        poeConfig: poeObj,
        dof: screwAxes.length
      };
    }

    const presetName = params.preset || params.robotPreset || params.manipulator;
    if (presetName !== undefined) {
      if (typeof presetName !== 'string' || !PRESET_REGISTRY[presetName.toUpperCase()]) {
        throw new OmniError(OmniErrorCode.UNSUPPORTED, `Unsupported manipulator preset: '${presetName}'`, {
          domain: this.domain,
          operation,
          supportedPresets: Object.keys(PRESET_REGISTRY)
        });
      }
      const table = PRESET_REGISTRY[presetName.toUpperCase()];
      return {
        convention: params.convention || 'standard_dh',
        dhTable: table,
        dof: table.length,
        preset: presetName.toUpperCase()
      };
    }

    if (params.urdf !== undefined || params.urdfXml !== undefined) {
      const parsed = this._parseUrdfFailClosed(params.urdf !== undefined ? params.urdf : params.urdfXml, operation);
      if (!Array.isArray(parsed.dhTable) || parsed.dhTable.length === 0) {
        throw new OmniError(OmniErrorCode.INVALID_INPUT, `${operation} URDF model contains no actuated joints`, {
          domain: this.domain,
          operation
        });
      }
      if (parsed.dhTable.length > MAX_ROBOT_DOF) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          `${operation} URDF model is limited to ${MAX_ROBOT_DOF} actuated joints`,
          { domain: this.domain, operation, maxDof: MAX_ROBOT_DOF }
        );
      }
      return {
        convention: 'standard_dh',
        dhTable: parsed.dhTable,
        dof: parsed.dof,
        urdfModel: parsed
      };
    }

    // Allow Stenographer natural-language proposals (steno_*) that only pass jointAnglesRad to use UR5E_DH
    if (jobRequest && typeof jobRequest.jobId === 'string' && jobRequest.jobId.startsWith('steno_')) {
      return {
        convention: 'standard_dh',
        dhTable: UR5E_DH,
        dof: UR5E_DH.length,
        preset: 'UR5E_DH'
      };
    }

    throw new OmniError(
      OmniErrorCode.INVALID_INPUT,
      `${operation} requires an explicit manipulator specification (dhTable, poeConfig, preset, or urdf)`,
      { domain: this.domain, operation }
    );
  }

  /**
   * Parse URDF with fail-closed OmniError mapping.
   * @private
   */
  _parseUrdfFailClosed(urdfInput, operation) {
    if (
      urdfInput === null ||
      urdfInput === undefined ||
      (typeof urdfInput === 'string' && urdfInput.trim().length === 0)
    ) {
      throw new OmniError(
        OmniErrorCode.INVALID_INPUT,
        `${operation} requires a non-empty URDF XML string or JSON object`,
        { domain: this.domain, operation }
      );
    }

    if (typeof urdfInput === 'string') {
      if (urdfInput.length > MAX_URDF_XML_CHARS) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          `${operation} URDF XML is limited to ${MAX_URDF_XML_CHARS} characters`,
          { domain: this.domain, operation }
        );
      }
      const trimmed = urdfInput.trim();
      if (!trimmed.startsWith('{') && !/<robot\b/i.test(trimmed)) {
        throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Invalid URDF XML: missing <robot> root element', {
          domain: this.domain,
          operation
        });
      }
      const jointTypeRegex = /<joint\b[^>]*\btype\s*=\s*["']([^"']+)["']/gi;
      let match;
      const supportedTypes = new Set(['revolute', 'continuous', 'prismatic', 'fixed']);
      while ((match = jointTypeRegex.exec(trimmed)) !== null) {
        const jType = match[1].toLowerCase();
        if (!supportedTypes.has(jType)) {
          throw new OmniError(OmniErrorCode.UNSUPPORTED, `Unsupported URDF joint type: '${jType}'`, {
            domain: this.domain,
            operation,
            jointType: jType
          });
        }
      }
    } else if (typeof urdfInput === 'object') {
      if (Array.isArray(urdfInput.joints)) {
        const supportedTypes = new Set(['revolute', 'continuous', 'prismatic', 'fixed']);
        for (const j of urdfInput.joints) {
          if (j && j.type && !supportedTypes.has(String(j.type).toLowerCase())) {
            throw new OmniError(OmniErrorCode.UNSUPPORTED, `Unsupported URDF joint type: '${j.type}'`, {
              domain: this.domain,
              operation,
              jointType: j.type
            });
          }
        }
      }
    } else {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, `${operation} urdf input must be a string or object`, {
        domain: this.domain,
        operation
      });
    }

    try {
      const parsed = SerialManipulatorEngine.parseURDF(urdfInput);
      if (!Array.isArray(parsed.links) || parsed.links.length === 0) {
        throw new OmniError(OmniErrorCode.INVALID_INPUT, 'URDF contains no valid <link> definitions', {
          domain: this.domain,
          operation
        });
      }
      return parsed;
    } catch (err) {
      if (err instanceof OmniError) throw err;
      throw new OmniError(OmniErrorCode.INVALID_INPUT, `URDF parse error: ${err.message}`, {
        domain: this.domain,
        operation
      });
    }
  }

  /**
   * Validate a numeric vector of expected length.
   * @private
   */
  _validateNumericArray(arr, name, expectedLength, operation) {
    if (!Array.isArray(arr)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, `${operation} requires '${name}' as a numeric array`, {
        domain: this.domain,
        operation,
        parameter: name
      });
    }
    if (expectedLength !== null && arr.length !== expectedLength) {
      throw new OmniError(
        OmniErrorCode.INVALID_INPUT,
        `${operation} parameter '${name}' length (${arr.length}) does not match DOF (${expectedLength})`,
        { domain: this.domain, operation, parameter: name, expectedLength, actualLength: arr.length }
      );
    }
    if (arr.length === 0) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, `${operation} parameter '${name}' must not be empty`, {
        domain: this.domain,
        operation,
        parameter: name
      });
    }
    for (let i = 0; i < arr.length; i++) {
      if (typeof arr[i] !== 'number' || !Number.isFinite(arr[i])) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          `${operation} parameter '${name}[${i}]' must be a finite number`,
          { domain: this.domain, operation, parameter: name, index: i }
        );
      }
    }
  }

  /**
   * Validate a collision-check obstacle list: non-empty, each entry exposing
   * triangles, mesh.triangles, or a SolidBody-compatible toTriangles().
   * @private
   */
  _validateObstacles(obstacles, operation) {
    if (!Array.isArray(obstacles) || obstacles.length === 0) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, `${operation} requires a non-empty obstacles array`, {
        domain: this.domain,
        operation
      });
    }
    if (obstacles.length > MAX_COLLISION_OBSTACLES) {
      throw new OmniError(
        OmniErrorCode.INVALID_INPUT,
        `${operation} is limited to ${MAX_COLLISION_OBSTACLES} obstacles`,
        { domain: this.domain, operation, maxObstacles: MAX_COLLISION_OBSTACLES }
      );
    }
    let totalTriangles = 0;
    obstacles.forEach((o, i) => {
      const triangles = o && typeof o === 'object' ? (o.triangles ?? o.mesh?.triangles) : undefined;
      const hasMesh =
        o &&
        typeof o === 'object' &&
        (Array.isArray(triangles) ||
          typeof o.toTriangles === 'function' ||
          (o.solid && typeof o.solid.toTriangles === 'function'));
      if (!hasMesh) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          `${operation} obstacles[${i}] must expose triangles, mesh.triangles, or a SolidBody`,
          { domain: this.domain, operation, index: i }
        );
      }
      if (Array.isArray(triangles)) {
        totalTriangles += triangles.length;
        if (totalTriangles > MAX_COLLISION_TOTAL_TRIANGLES) {
          throw new OmniError(
            OmniErrorCode.INVALID_INPUT,
            `${operation} total triangle count is limited to ${MAX_COLLISION_TOTAL_TRIANGLES}`,
            { domain: this.domain, operation, maxTriangles: MAX_COLLISION_TOTAL_TRIANGLES }
          );
        }
      }
    });
  }

  validate(jobRequest) {
    if (!jobRequest || typeof jobRequest !== 'object') {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'EngineAdapter.validate received null request');
    }
    if (jobRequest.domain !== this.domain) {
      throw new OmniError(
        OmniErrorCode.UNSUPPORTED,
        `Domain mismatch: adapter handles "${this.domain}", received "${jobRequest.domain}"`
      );
    }

    const { operation, params } = this._extractRequest(jobRequest);

    if (!operation || typeof operation !== 'string') {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'RoboticsEngineAdapter requires a valid string operation', {
        domain: this.domain,
        supportedOperations: SUPPORTED_OPERATIONS
      });
    }

    if (!SUPPORTED_OPERATIONS.includes(operation)) {
      throw new OmniError(OmniErrorCode.UNSUPPORTED, `Unsupported robotics operation: '${operation}'`, {
        domain: this.domain,
        operation,
        supportedOperations: SUPPORTED_OPERATIONS
      });
    }

    if (operation === 'forward_kinematics') {
      const model = this._resolveManipulator(params, operation, jobRequest);
      const q =
        params.q !== undefined
          ? params.q
          : params.jointAngles !== undefined
            ? params.jointAngles
            : params.jointAnglesRad;
      this._validateNumericArray(q, 'q', model.dof, operation);
      if (params.qd !== undefined || params.jointVelocities !== undefined) {
        const qd = params.qd !== undefined ? params.qd : params.jointVelocities;
        this._validateNumericArray(qd, 'qd', model.dof, operation);
      }
    } else if (operation === 'inverse_kinematics') {
      const model = this._resolveManipulator(params, operation, jobRequest);
      if (!model.dhTable) {
        throw new OmniError(
          OmniErrorCode.UNSUPPORTED,
          'inverse_kinematics requires a DH-parameterized manipulator (dhTable, preset, or urdf)',
          { domain: this.domain, operation }
        );
      }
      const targetPose =
        params.targetPose !== undefined
          ? params.targetPose
          : Array.isArray(params.targetPosition)
            ? { position: params.targetPosition, rotation: params.targetOrientation }
            : undefined;
      if (!targetPose || (typeof targetPose !== 'object' && !Array.isArray(targetPose))) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          'inverse_kinematics requires targetPose (4x4 matrix or { position, rotation/rpy/quaternion }) or targetPosition',
          { domain: this.domain, operation }
        );
      }
      if (Array.isArray(targetPose)) {
        const is4x4 =
          targetPose.length === 4 &&
          targetPose.every(
            (r) => Array.isArray(r) && r.length === 4 && r.every((v) => typeof v === 'number' && Number.isFinite(v))
          );
        const isVec3 = targetPose.length === 3 && targetPose.every((v) => typeof v === 'number' && Number.isFinite(v));
        if (!is4x4 && !isVec3) {
          throw new OmniError(
            OmniErrorCode.INVALID_INPUT,
            'inverse_kinematics targetPose array must be a finite 4x4 homogeneous transform or 3D position vector',
            { domain: this.domain, operation }
          );
        }
      } else {
        if (
          !Array.isArray(targetPose.position) ||
          targetPose.position.length !== 3 ||
          !targetPose.position.every((v) => typeof v === 'number' && Number.isFinite(v))
        ) {
          throw new OmniError(
            OmniErrorCode.INVALID_INPUT,
            'inverse_kinematics targetPose.position must be a finite [x, y, z] array',
            { domain: this.domain, operation }
          );
        }
      }
      const q0 =
        params.q0 !== undefined
          ? params.q0
          : params.initialGuess !== undefined
            ? params.initialGuess
            : params.jointAngles;
      if (q0 !== undefined) {
        this._validateNumericArray(q0, 'q0', model.dof, operation);
      }
    } else if (operation === 'inverse_dynamics') {
      const model = this._resolveManipulator(params, operation, jobRequest);
      if (!model.dhTable) {
        throw new OmniError(
          OmniErrorCode.UNSUPPORTED,
          'inverse_dynamics requires a DH-parameterized manipulator (dhTable, preset, or urdf)',
          { domain: this.domain, operation }
        );
      }
      const q =
        params.q !== undefined
          ? params.q
          : params.jointAngles !== undefined
            ? params.jointAngles
            : params.jointAnglesRad;
      const qd = params.qd !== undefined ? params.qd : params.jointVelocities;
      const qdd = params.qdd !== undefined ? params.qdd : params.jointAccelerations;
      this._validateNumericArray(q, 'q', model.dof, operation);
      this._validateNumericArray(qd, 'qd', model.dof, operation);
      this._validateNumericArray(qdd, 'qdd', model.dof, operation);

      const linkDynamics =
        params.linkDynamics || params.linkInertias || params.links || (model.urdfModel && model.urdfModel.linkDynamics);
      if (!Array.isArray(linkDynamics) || linkDynamics.length !== model.dof) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          `inverse_dynamics requires linkDynamics (or linkInertias) array of length ${model.dof}`,
          { domain: this.domain, operation, expectedLength: model.dof }
        );
      }
      for (let i = 0; i < linkDynamics.length; i++) {
        const ld = linkDynamics[i];
        if (!ld || typeof ld.mass !== 'number' || !Number.isFinite(ld.mass) || ld.mass < 0) {
          throw new OmniError(
            OmniErrorCode.INVALID_INPUT,
            `inverse_dynamics linkDynamics[${i}].mass must be a finite non-negative number`,
            { domain: this.domain, operation, index: i }
          );
        }
      }
      this._validateNumericArray(params.gravity, 'gravity', 3, operation);
      const wrench = params.fTip !== undefined ? params.fTip : params.externalWrench;
      this._validateNumericArray(wrench, 'externalWrench', 6, operation);
    } else if (operation === 'trajectory_plan') {
      const q0 = params.q0 || params.qStart || params.startPositions || params.startAngles;
      const qf = params.qf || params.qEnd || params.endPositions || params.goalAngles;
      this._validateNumericArray(q0, 'q0', null, operation);
      this._validateNumericArray(qf, 'qf', q0.length, operation);
      const duration = params.duration !== undefined ? params.duration : params.T;
      if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
        throw new OmniError(OmniErrorCode.INVALID_INPUT, 'trajectory_plan requires a finite positive duration (s)', {
          domain: this.domain,
          operation,
          duration
        });
      }
      const v0 = params.v0 || params.vStart;
      const vf = params.vf || params.vEnd;
      const a0 = params.a0 || params.aStart;
      const af = params.af || params.aEnd;
      if (v0 !== undefined) this._validateNumericArray(v0, 'v0', q0.length, operation);
      if (vf !== undefined) this._validateNumericArray(vf, 'vf', q0.length, operation);
      if (a0 !== undefined) this._validateNumericArray(a0, 'a0', q0.length, operation);
      if (af !== undefined) this._validateNumericArray(af, 'af', q0.length, operation);
      const numSteps = params.numSteps !== undefined ? params.numSteps : params.steps;
      if (
        numSteps !== undefined &&
        (!Number.isInteger(numSteps) || numSteps < 2 || numSteps > MAX_TRAJECTORY_NUM_STEPS)
      ) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          `trajectory_plan numSteps must be an integer from 2 through ${MAX_TRAJECTORY_NUM_STEPS}`,
          { domain: this.domain, operation }
        );
      }
    } else if (operation === 'parse_urdf') {
      const urdfPayload =
        params.urdf !== undefined
          ? params.urdf
          : params.urdfXml !== undefined
            ? params.urdfXml
            : params.xml !== undefined
              ? params.xml
              : params.json;
      this._parseUrdfFailClosed(urdfPayload, operation);
    } else if (operation === 'collision_check') {
      const model = this._resolveManipulator(params, operation, jobRequest);
      if (!model.dhTable) {
        throw new OmniError(
          OmniErrorCode.UNSUPPORTED,
          'collision_check requires a DH-parameterized manipulator (dhTable, preset, or urdf)',
          { domain: this.domain, operation }
        );
      }
      const qStart = params.qStart !== undefined ? params.qStart : params.q0;
      const qEnd = params.qEnd !== undefined ? params.qEnd : params.qf;
      this._validateNumericArray(qStart, 'qStart', model.dof, operation);
      this._validateNumericArray(qEnd, 'qEnd', model.dof, operation);
      this._validateObstacles(params.obstacles, operation);
      if (params.step !== undefined && (!Number.isFinite(params.step) || params.step < MIN_COLLISION_STEP)) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          `collision_check opts.step must be a finite number at least ${MIN_COLLISION_STEP}`,
          { domain: this.domain, operation }
        );
      }
      if (
        params.numSamples !== undefined &&
        (!Number.isInteger(params.numSamples) || params.numSamples < 2 || params.numSamples > MAX_COLLISION_NUM_SAMPLES)
      ) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          `collision_check opts.numSamples must be an integer from 2 through ${MAX_COLLISION_NUM_SAMPLES}`,
          { domain: this.domain, operation }
        );
      }
      if (params.linkRadius !== undefined && (!Number.isFinite(params.linkRadius) || params.linkRadius < 0)) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          'collision_check opts.linkRadius must be a finite non-negative number',
          { domain: this.domain, operation }
        );
      }
    }

    return true;
  }

  async execute(jobRequest) {
    this.validate(jobRequest);
    const startTime = Date.now();
    const { operation, params } = this._extractRequest(jobRequest);

    // Deterministic SHA-256 input artifact hash
    const inputHash = crypto.createHash('sha256').update(JSON.stringify({ operation, params })).digest('hex');

    let outputData = {};
    let residualHistoryObjs = [];
    let residualScalars = [];

    try {
      if (operation === 'forward_kinematics') {
        const model = this._resolveManipulator(params, operation, jobRequest);
        const q =
          params.q !== undefined
            ? params.q
            : params.jointAngles !== undefined
              ? params.jointAngles
              : params.jointAnglesRad;
        const qd = params.qd !== undefined ? params.qd : params.jointVelocities;

        const fkConfig = model.convention === 'poe' ? model.poeConfig : model.dhTable;
        const fk = SerialManipulatorEngine.forwardKinematics(fkConfig, q, model.convention);

        let linearSpeed = null;
        let angularSpeed = null;
        const manipulability = fk.manipulabilityIndex;
        const conditionNumber = fk.conditionNumber;
        const jacobian = fk.jacobian || null;

        if (jacobian && qd) {
          const twist = new Array(6).fill(0);
          for (let r = 0; r < 6; r++) {
            for (let c = 0; c < model.dof; c++) {
              twist[r] += jacobian[r][c] * qd[c];
            }
          }
          linearSpeed = Math.hypot(twist[0], twist[1], twist[2]);
          angularSpeed = Math.hypot(twist[3], twist[4], twist[5]);
        }

        const posMag = Math.hypot(fk.position[0], fk.position[1], fk.position[2]);
        if (!Number.isFinite(posMag)) {
          throw new OmniError(
            OmniErrorCode.NUMERICAL_FAILURE,
            'Non-finite end-effector position in forward_kinematics',
            { domain: this.domain, operation }
          );
        }

        // Genuine FK residual: if a target pose was supplied, measure the
        // end-effector position (and orientation, when given) error against the
        // computed pose. For pure forward kinematics without a target there is
        // nothing to measure, so the residual is null (documented).
        const targetPos =
          params.targetPosition !== undefined
            ? params.targetPosition
            : params.targetPose && Array.isArray(params.targetPose) && params.targetPose.length === 3
              ? params.targetPose
              : params.targetPose && Array.isArray(params.targetPose) && params.targetPose.length === 4
                ? [params.targetPose[0][3], params.targetPose[1][3], params.targetPose[2][3]]
                : params.targetPose &&
                    typeof params.targetPose === 'object' &&
                    Array.isArray(params.targetPose.position)
                  ? params.targetPose.position
                  : null;
        let fkResidual = null;
        let fkResidualDetail = null;
        if (Array.isArray(targetPos) && targetPos.length === 3 && targetPos.every((v) => Number.isFinite(v))) {
          const posErr = Math.hypot(
            fk.position[0] - targetPos[0],
            fk.position[1] - targetPos[1],
            fk.position[2] - targetPos[2]
          );
          let oriErr = 0;
          const targetOrientation =
            params.targetOrientation ||
            (params.targetPose && typeof params.targetPose === 'object'
              ? params.targetPose.rotation || params.targetPose.rotationMatrix || params.targetPose.quaternion || null
              : null);
          if (targetOrientation) {
            const Rdes = SerialManipulatorEngine._parseTargetOrientation(targetOrientation);
            oriErr = Math.hypot(...SerialManipulatorEngine.computeOrientationError(fk.rotationMatrix, Rdes));
          }
          fkResidualDetail = { positionError: posErr, orientationError: oriErr };
          fkResidual = Math.hypot(posErr, oriErr);
        }
        residualScalars = [fkResidual];
        residualHistoryObjs = [{ iteration: 0, residual: fkResidual, step: 0, ...fkResidualDetail }];

        outputData = {
          operation,
          convention: fk.convention,
          dof: Quantity.from(model.dof, 'dimensionless'),
          position: {
            x: Quantity.from(fk.position[0], 'm'),
            y: Quantity.from(fk.position[1], 'm'),
            z: Quantity.from(fk.position[2], 'm'),
            magnitude: Quantity.from(posMag, 'm')
          },
          eulerRPY: {
            roll: Quantity.from(fk.eulerRPY.roll, 'rad'),
            pitch: Quantity.from(fk.eulerRPY.pitch, 'rad'),
            yaw: Quantity.from(fk.eulerRPY.yaw, 'rad')
          },
          jointAngles: q.map((angle, idx) => {
            const jType = model.dhTable && model.dhTable[idx] && model.dhTable[idx].type === 'prismatic' ? 'm' : 'rad';
            return Quantity.from(angle, jType);
          }),
          endEffectorLinearSpeed: linearSpeed === null ? null : Quantity.from(linearSpeed, 'm/s'),
          endEffectorAngularSpeed: angularSpeed === null ? null : Quantity.from(angularSpeed, 'rad/s'),
          manipulabilityIndex:
            model.dof >= 6 && Number.isFinite(manipulability) ? Quantity.from(manipulability, 'dimensionless') : null,
          conditionNumber:
            model.dof >= 6 && Number.isFinite(conditionNumber) ? Quantity.from(conditionNumber, 'dimensionless') : null,
          endEffectorPose: fk.endEffectorPose,
          endEffectorTransform: fk.endEffectorTransform,
          endEffectorPosition: fk.position,
          positionVector: fk.position,
          rotationMatrix: fk.rotationMatrix,
          quaternion: fk.quaternion,
          jacobian,
          jointFrames: fk.jointFrames,
          inputSha256: inputHash,
          backendVersion: this.version,
          residualHistory: residualScalars
        };
      } else if (operation === 'inverse_kinematics') {
        const model = this._resolveManipulator(params, operation, jobRequest);
        const q0 =
          params.q0 !== undefined
            ? params.q0
            : params.initialGuess !== undefined
              ? params.initialGuess
              : params.jointAngles || new Array(model.dof).fill(0.1);
        const targetPose =
          params.targetPose !== undefined
            ? params.targetPose
            : { position: params.targetPosition, rotation: params.targetOrientation };

        const options = {
          ...(params.options || {}),
          convention: model.convention === 'modified_dh' ? 'modified_dh' : 'standard_dh',
          maxIterations: params.maxIterations || (params.options && params.options.maxIterations) || 200,
          positionTolerance:
            params.positionTolerance ||
            params.tolerance ||
            (params.options && params.options.positionTolerance) ||
            1e-6,
          orientationTolerance:
            params.orientationTolerance || (params.options && params.options.orientationTolerance) || 1e-5,
          damping: params.damping || (params.options && params.options.damping) || 0.05
        };

        const ik = SerialManipulatorEngine.inverseKinematics(model.dhTable, targetPose, q0, options);

        if (
          !Number.isFinite(ik.positionError) ||
          !Number.isFinite(ik.orientationError) ||
          ik.q.some((v) => !Number.isFinite(v))
        ) {
          throw new OmniError(
            OmniErrorCode.NUMERICAL_FAILURE,
            'Numerical divergence (NaN/Infinity) during damped least-squares inverse kinematics',
            { domain: this.domain, operation }
          );
        }

        if (!ik.converged) {
          throw new OmniError(
            OmniErrorCode.NUMERICAL_FAILURE,
            `Inverse kinematics failed to converge within ${ik.iterations} iterations (posErr=${ik.positionError.toExponential(3)} m, oriErr=${ik.orientationError.toExponential(3)} rad)`,
            {
              domain: this.domain,
              operation,
              iterations: ik.iterations,
              positionError: ik.positionError,
              orientationError: ik.orientationError
            }
          );
        }

        residualScalars = ik.residualHistory.map((h) => h.residualNorm);
        residualHistoryObjs = ik.residualHistory.map((h, idx) => ({
          iteration: h.iteration !== undefined ? h.iteration : idx,
          residual: h.residualNorm,
          positionError: h.positionError,
          orientationError: h.orientationError,
          step: idx
        }));
        const finalResidual = residualScalars.length > 0 ? residualScalars[residualScalars.length - 1] : 0;

        outputData = {
          operation,
          converged: ik.converged,
          iterations: ik.iterations,
          jointAngles: ik.q.map((angle, idx) => {
            const unit = model.dhTable[idx] && model.dhTable[idx].type === 'prismatic' ? 'm' : 'rad';
            return Quantity.from(angle, unit);
          }),
          qValues: ik.q,
          positionError: Quantity.from(ik.positionError, 'm'),
          orientationError: Quantity.from(ik.orientationError, 'rad'),
          residualNorm: Quantity.from(finalResidual, 'dimensionless'),
          manipulabilityIndex: Quantity.from(ik.manipulability, 'dimensionless'),
          endEffectorPosition: {
            x: Quantity.from(ik.achievedPose.position[0], 'm'),
            y: Quantity.from(ik.achievedPose.position[1], 'm'),
            z: Quantity.from(ik.achievedPose.position[2], 'm')
          },
          achievedPose: ik.achievedPose,
          detailedResidualHistory: ik.residualHistory,
          residualHistory: residualScalars,
          inputSha256: inputHash,
          backendVersion: this.version
        };
      } else if (operation === 'inverse_dynamics') {
        const model = this._resolveManipulator(params, operation, jobRequest);
        const q =
          params.q !== undefined
            ? params.q
            : params.jointAngles !== undefined
              ? params.jointAngles
              : params.jointAnglesRad;
        const qd = params.qd !== undefined ? params.qd : params.jointVelocities;
        const qdd = params.qdd !== undefined ? params.qdd : params.jointAccelerations;
        const linkDynamics =
          params.linkDynamics ||
          params.linkInertias ||
          params.links ||
          (model.urdfModel && model.urdfModel.linkDynamics);
        const gravity = params.gravity;
        const fTip = params.fTip !== undefined ? params.fTip : params.externalWrench;

        const rnea = SerialManipulatorEngine.inverseDynamics(model.dhTable, q, qd, qdd, linkDynamics, gravity, fTip);

        const zeroVec = new Array(model.dof).fill(0);
        const gravityOnly = SerialManipulatorEngine.inverseDynamics(
          model.dhTable,
          q,
          zeroVec,
          zeroVec,
          linkDynamics,
          gravity,
          [0, 0, 0, 0, 0, 0]
        );

        const maxTorqueVal = rnea.torques.reduce((acc, v) => Math.max(acc, Math.abs(v)), 0);
        const rmsTorqueVal = Math.sqrt(rnea.torques.reduce((acc, v) => acc + v * v, 0) / rnea.torques.length);

        if (!Number.isFinite(maxTorqueVal)) {
          throw new OmniError(
            OmniErrorCode.NUMERICAL_FAILURE,
            'Non-finite joint torque computed in RNEA inverse_dynamics',
            { domain: this.domain, operation }
          );
        }

        const jacInfo = SerialManipulatorEngine.computeGeometricJacobian(model.dhTable, q);
        const tipLinVel = [0, 0, 0];
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < model.dof; c++) {
            tipLinVel[r] += jacInfo.jacobian[r][c] * qd[c];
          }
        }
        const tipSpeed = Math.hypot(tipLinVel[0], tipLinVel[1], tipLinVel[2]);

        // Genuine joint-torque equilibrium residual:
        //   R = max_i | tau_i - (M(q)*qdd + bias(q,qd))_i | / max|tau|
        // where M(q) and the bias (gravity + Coriolis + external wrench) terms
        // are assembled independently via RNEA mass-matrix decomposition.
        let dynamicsResidual = 0;
        const Mmat = SerialManipulatorEngine.computeMassMatrix(model.dhTable, linkDynamics, q);
        const biasTau = SerialManipulatorEngine.inverseDynamics(
          model.dhTable,
          q,
          qd,
          zeroVec,
          linkDynamics,
          gravity,
          fTip
        ).torques;
        let maxAbsTau = 0;
        for (let i = 0; i < model.dof; i++) {
          let rhs = 0;
          for (let j = 0; j < model.dof; j++) rhs += Mmat[i][j] * qdd[j];
          const diff = Math.abs(rnea.torques[i] - (rhs + biasTau[i]));
          dynamicsResidual = Math.max(dynamicsResidual, diff);
          maxAbsTau = Math.max(maxAbsTau, Math.abs(rnea.torques[i]));
        }
        if (maxAbsTau > 0) dynamicsResidual /= maxAbsTau;

        residualScalars = [dynamicsResidual];
        residualHistoryObjs = [{ iteration: 0, residual: dynamicsResidual, step: 0 }];

        outputData = {
          operation,
          dof: Quantity.from(model.dof, 'dimensionless'),
          torques: rnea.torques.map((t) => Quantity.from(t, 'N*m')),
          torqueValues: rnea.torques,
          gravityTorques: gravityOnly.torques.map((t) => Quantity.from(t, 'N*m')),
          gravityTorqueValues: gravityOnly.torques,
          maxTorque: Quantity.from(maxTorqueVal, 'N*m'),
          rmsTorque: Quantity.from(rmsTorqueVal, 'N*m'),
          jointAngles: q.map((v) => Quantity.from(v, 'rad')),
          jointVelocities: qd.map((v) => Quantity.from(v, 'rad/s')),
          jointAccelerations: qdd.map((v) => Quantity.from(v, 'rad/s^2')),
          tipLinearSpeed: Quantity.from(tipSpeed, 'm/s'),
          linkAccelerations: rnea.linkAccelerations,
          jointWrenches: rnea.jointWrenches,
          inputSha256: inputHash,
          backendVersion: this.version,
          residualHistory: residualScalars
        };
      } else if (operation === 'trajectory_plan') {
        const q0 = params.q0 || params.qStart || params.startPositions || params.startAngles;
        const qf = params.qf || params.qEnd || params.endPositions || params.goalAngles;
        const duration = params.duration !== undefined ? params.duration : params.T;

        const traj = SerialManipulatorEngine.planQuinticTrajectory({
          q0,
          qf,
          v0: params.v0 || params.vStart,
          vf: params.vf || params.vEnd,
          a0: params.a0 || params.aStart,
          af: params.af || params.aEnd,
          duration,
          numSteps: params.numSteps || params.steps,
          dt: params.dt,
          velocityLimits: params.velocityLimits,
          accelerationLimits: params.accelerationLimits,
          torqueLimits: params.torqueLimits
        });

        const lastSample = traj.samples[traj.samples.length - 1];
        const posBoundaryErr = Math.hypot(...lastSample.q.map((v, i) => v - qf[i]));
        const velTarget = params.vf || params.vEnd || new Array(q0.length).fill(0);
        const velBoundaryErr = Math.hypot(...lastSample.qd.map((v, i) => v - velTarget[i]));
        const accTarget = params.af || params.aEnd || new Array(q0.length).fill(0);
        const accBoundaryErr = Math.hypot(...lastSample.qdd.map((v, i) => v - accTarget[i]));
        const totalBoundaryResidual = posBoundaryErr + velBoundaryErr + accBoundaryErr;

        let maxCartesianSpeed = 0;
        let endEffectorDisplacement = 0;
        if (params.dhTable || params.dhParams || params.preset || params.robotPreset || params.manipulator) {
          const model = this._resolveManipulator(params, operation, jobRequest);
          if (model.dhTable && model.dof === q0.length) {
            const fkStart = SerialManipulatorEngine.forwardKinematics(model.dhTable, q0);
            const fkEnd = SerialManipulatorEngine.forwardKinematics(model.dhTable, qf);
            endEffectorDisplacement = Math.hypot(
              fkEnd.position[0] - fkStart.position[0],
              fkEnd.position[1] - fkStart.position[1],
              fkEnd.position[2] - fkStart.position[2]
            );
            for (const s of traj.samples) {
              const jac = SerialManipulatorEngine.computeGeometricJacobian(model.dhTable, s.q).jacobian;
              let vx = 0,
                vy = 0,
                vz = 0;
              for (let c = 0; c < model.dof; c++) {
                vx += jac[0][c] * s.qd[c];
                vy += jac[1][c] * s.qd[c];
                vz += jac[2][c] * s.qd[c];
              }
              const speed = Math.hypot(vx, vy, vz);
              if (speed > maxCartesianSpeed) maxCartesianSpeed = speed;
            }
          }
        }

        const maxPos = Math.max(...traj.maxPosition);
        const maxVel = Math.max(...traj.maxVelocity);
        const maxAcc = Math.max(...traj.maxAcceleration);

        residualScalars = [totalBoundaryResidual];
        residualHistoryObjs = [{ iteration: 0, residual: totalBoundaryResidual, step: traj.samples.length }];

        outputData = {
          operation,
          dof: Quantity.from(traj.dof, 'dimensionless'),
          duration: Quantity.from(traj.duration, 's'),
          maxJointPosition: Quantity.from(maxPos, 'rad'),
          maxJointVelocity: Quantity.from(maxVel, 'rad/s'),
          maxJointAcceleration: Quantity.from(maxAcc, 'rad/s^2'),
          maxCartesianSpeed: Quantity.from(maxCartesianSpeed, 'm/s'),
          endEffectorDisplacement: Quantity.from(endEffectorDisplacement, 'm'),
          boundaryResidual: Quantity.from(totalBoundaryResidual, 'dimensionless'),
          perJointMaxPosition: traj.maxPosition.map((v) => Quantity.from(v, 'rad')),
          perJointMaxVelocity: traj.maxVelocity.map((v) => Quantity.from(v, 'rad/s')),
          perJointMaxAcceleration: traj.maxAcceleration.map((v) => Quantity.from(v, 'rad/s^2')),
          coefficients: traj.coefficients,
          samples: traj.samples,
          waypoints: traj.waypoints,
          withinLimits: traj.withinLimits,
          inputSha256: inputHash,
          backendVersion: this.version,
          residualHistory: residualScalars
        };
      } else if (operation === 'parse_urdf') {
        const urdfPayload =
          params.urdf !== undefined
            ? params.urdf
            : params.urdfXml !== undefined
              ? params.urdfXml
              : params.xml !== undefined
                ? params.xml
                : params.json;
        const parsed = this._parseUrdfFailClosed(urdfPayload, operation);

        const hasCompleteMass = parsed.links.every((l) => l.inertial && Number.isFinite(l.inertial.mass));
        const totalMass = hasCompleteMass ? parsed.links.reduce((acc, l) => acc + l.inertial.mass, 0) : null;
        const reach = parsed.dhTable.reduce((acc, row) => acc + Math.hypot(row.a || 0, row.d || 0), 0);

        // Genuine URDF residual: verify that the parsed kinematic chain's FK at
        // the zero configuration reproduces the directly composed <origin>
        // transforms (Frobenius norm of the pose difference). If the chain does
        // not expose origin data, there is nothing independent to measure and
        // the residual is null.
        let urdfResidual = null;
        const dhRows = parsed.dhTable;
        if (Array.isArray(dhRows) && dhRows.length > 0 && dhRows.every((r) => r && r.urdfOrigin)) {
          const mat4Mul = (A, B) => {
            const C = [
              [0, 0, 0, 0],
              [0, 0, 0, 0],
              [0, 0, 0, 0],
              [0, 0, 0, 0]
            ];
            for (let r = 0; r < 4; r++) {
              for (let k = 0; k < 4; k++) {
                const aik = A[r][k];
                if (aik === 0) continue;
                for (let c = 0; c < 4; c++) C[r][c] += aik * B[k][c];
              }
            }
            return C;
          };
          const rpyMat = (roll, pitch, yaw) => {
            const cr = Math.cos(roll),
              sr = Math.sin(roll);
            const cp = Math.cos(pitch),
              sp = Math.sin(pitch);
            const cy = Math.cos(yaw),
              sy = Math.sin(yaw);
            return [
              [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
              [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
              [-sp, cp * sr, cp * cr]
            ];
          };
          let T = [
            [1, 0, 0, 0],
            [0, 1, 0, 0],
            [0, 0, 1, 0],
            [0, 0, 0, 1]
          ];
          for (const row of dhRows) {
            const o = row.urdfOrigin || {};
            const xyz = o.xyz || [0, 0, 0];
            const rpy = o.rpy || [0, 0, 0];
            const R = rpyMat(rpy[0], rpy[1], rpy[2]);
            const Tj = [
              [R[0][0], R[0][1], R[0][2], xyz[0]],
              [R[1][0], R[1][1], R[1][2], xyz[1]],
              [R[2][0], R[2][1], R[2][2], xyz[2]],
              [0, 0, 0, 1]
            ];
            T = mat4Mul(T, Tj);
          }
          const zeros = new Array(parsed.dof).fill(0);
          const fkChain = SerialManipulatorEngine.forwardKinematics(dhRows, zeros);
          let frob = 0;
          for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 4; c++) {
              const d = T[r][c] - fkChain.endEffectorTransform[r][c];
              frob += d * d;
            }
          }
          urdfResidual = Math.sqrt(frob);
        }
        residualScalars = [urdfResidual];
        residualHistoryObjs = [{ iteration: 0, residual: urdfResidual, step: 0 }];

        outputData = {
          operation,
          name: parsed.name,
          dof: Quantity.from(parsed.dof, 'dimensionless'),
          dofCount: parsed.dof,
          totalMass: totalMass === null ? null : Quantity.from(totalMass, 'kg'),
          characteristicReach: Quantity.from(reach, 'm'),
          jointLimits: parsed.kinematicChain.map((j) => ({
            name: j.name,
            type: j.type,
            lower: Number.isFinite(j.limits.lower)
              ? Quantity.from(j.limits.lower, j.type === 'prismatic' ? 'm' : 'rad')
              : null,
            upper: Number.isFinite(j.limits.upper)
              ? Quantity.from(j.limits.upper, j.type === 'prismatic' ? 'm' : 'rad')
              : null,
            effort: Number.isFinite(j.limits.effort) ? Quantity.from(j.limits.effort, 'N*m') : null,
            velocity: Number.isFinite(j.limits.velocity)
              ? Quantity.from(j.limits.velocity, j.type === 'prismatic' ? 'm/s' : 'rad/s')
              : null
          })),
          links: parsed.links,
          joints: parsed.joints,
          kinematicChain: parsed.kinematicChain,
          dhTable: parsed.dhTable,
          linkDynamics: parsed.linkDynamics,
          linkInertias: parsed.linkInertias,
          inputSha256: inputHash,
          backendVersion: this.version,
          residualHistory: residualScalars
        };
      } else if (operation === 'collision_check') {
        const model = this._resolveManipulator(params, operation, jobRequest);
        const qStart = params.qStart !== undefined ? params.qStart : params.q0;
        const qEnd = params.qEnd !== undefined ? params.qEnd : params.qf;
        const collisionOpts = {
          step: params.step,
          numSamples: params.numSamples,
          linkRadius: params.linkRadius,
          linkGeometry: params.linkGeometry,
          swept: params.swept
        };
        const collision = checkRobotPath(model.dhTable, qStart, qEnd, params.obstacles, collisionOpts);
        const collided = collision !== null;
        residualScalars = [collided ? 1 : 0];
        residualHistoryObjs = [{ iteration: 0, residual: collided ? 1 : 0, step: 0 }];
        outputData = {
          operation,
          collided,
          collision,
          dof: Quantity.from(model.dof, 'dimensionless'),
          inputSha256: inputHash,
          backendVersion: this.version,
          residualHistory: residualScalars
        };
      }
    } catch (err) {
      if (err instanceof OmniError) throw err;
      throw new OmniError(
        OmniErrorCode.NUMERICAL_FAILURE,
        `RoboticsEngineAdapter execution error in '${operation}': ${err.message}`,
        { domain: this.domain, operation }
      );
    }

    const validationRecord = new ValidationRecord({
      maturity: ValidationMaturity.EXPERIMENTAL,
      benchmarkSet: `ROBOTICS-${operation.toUpperCase()}-EXPERIMENTAL`,
      errors: {
        finalResidual: residualScalars.length > 0 ? residualScalars[residualScalars.length - 1] : 0,
        steps: residualScalars.length
      },
      reviewer: '',
      referenceArtifacts: []
    });

    outputData.validation = validationRecord;

    const jobHash = typeof jobRequest.computeContentHash === 'function' ? jobRequest.computeContentHash() : inputHash;

    const runMs = Math.max(1, Date.now() - startTime);
    const inputHashes = Array.from(
      new Set([
        inputHash,
        jobHash,
        ...(Array.isArray(jobRequest.inputArtifactHashes) ? jobRequest.inputArtifactHashes : [])
      ])
    );

    return new JobResult({
      jobId: jobRequest.jobId || `job_robotics_${Date.now()}`,
      status: JobStatus.COMPLETED,
      output: outputData,
      residualHistory: residualHistoryObjs,
      timing: {
        queuedMs: 0,
        runMs,
        totalMs: runMs
      },
      backendName: this.name,
      backendVersion: this.version,
      backendVersions: {
        [this.name]: this.version,
        SerialManipulatorEngine: '2.0.0'
      },
      inputArtifactHashes: inputHashes,
      resultArtifactHashes: [],
      validationMaturity: ValidationMaturity.EXPERIMENTAL
    });
  }
}

module.exports = {
  RoboticsEngineAdapter,
  SUPPORTED_OPERATIONS,
  PRESET_REGISTRY
};
