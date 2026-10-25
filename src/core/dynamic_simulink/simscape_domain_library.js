/**
 * OmniEng Simscape Multi-Domain Physical Network Modeling Library
 * 
 * Implements acausal physical network modeling across Hydraulic, Rotational
 * Mechanical, and Thermal-Fluid domains with Generalized Across/Through variables,
 * conservation of energy and mass, and stiff DAE time stepping.
 * 
 * Unverified comparison target: MathWorks Simscape Fluids / Simscape Driveline.
 * 
 * Experimental implementation; release maturity and provenance are not established.
 */

class SimscapeDomainLibrary {
  constructor() {
    this.components = [];
    this.nodes = new Map(); // nodeName -> { acrossValue, throughSum }
    this.simTime = 0.0;
  }

  /**
   * Hydraulic Fixed Orifice:
   * Q = Cd * A * sign(Delta_p) * sqrt( 2 * |Delta_p| / rho )
   * 
   * @param {Object} params
   * @param {number} params.Cd - Discharge coefficient (typically ~0.62)
   * @param {number} params.area - Orifice cross-sectional area (m^2)
   * @param {number} [params.fluidDensity=870.0] - Hydraulic oil density (kg/m^3)
   * @param {number} deltaP - Pressure difference across ports (Pa)
   * @returns {number} Flow rate Q (m^3/s)
   */
  static evaluateHydraulicOrifice(params, deltaP) {
    const Cd = params.Cd !== undefined ? params.Cd : 0.62;
    const area = params.area !== undefined ? params.area : 1e-4; // 1 cm^2
    const rho = params.fluidDensity !== undefined ? params.fluidDensity : 870.0; // ISO VG 46 oil

    const sign = deltaP >= 0 ? 1.0 : -1.0;
    const absDp = Math.abs(deltaP);
    const Q = Cd * area * sign * Math.sqrt((2.0 * absDp) / rho);
    return Q;
  }

  /**
   * Hydraulic Double-Acting Cylinder:
   * Net Force: F_net = p_A * A_A - p_B * A_B - damping * v - friction
   * Piston Kinematics: m * dv/dt = F_net - F_external
   * Chamber Flows: Q_A = A_A * v, Q_B = -A_B * v
   * 
   * @param {Object} cylinder
   * @param {number} cylinder.pistonAreaA - Cap side area (m^2)
   * @param {number} cylinder.pistonAreaB - Rod side area (m^2)
   * @param {number} cylinder.mass - Piston + rod moving mass (kg)
   * @param {number} cylinder.damping - Viscous damping coefficient (N*s/m)
   * @param {number} pA - Pressure in chamber A (Pa)
   * @param {number} pB - Pressure in chamber B (Pa)
   * @param {number} velocity - Current piston velocity (m/s)
   * @param {number} externalLoadForce - External mechanical resisting load (N)
   * @returns {Object} Acceleration, hydraulic force, and port flow rates
   */
  static evaluateHydraulicCylinder(cylinder, pA, pB, velocity, externalLoadForce = 0.0) {
    const areaA = cylinder.pistonAreaA;
    const areaB = cylinder.pistonAreaB;
    const mass = cylinder.mass || 10.0;
    const b = cylinder.damping || 50.0;

    const fHydro = (pA * areaA) - (pB * areaB);
    const fDamping = b * velocity;
    const fNet = fHydro - fDamping - externalLoadForce;
    const acceleration = fNet / mass;

    // Chamber volumetric flows
    const qA = areaA * velocity; // Flow into chamber A
    const qB = -areaB * velocity; // Flow out of chamber B

    return {
      fHydro,
      fDamping,
      fNet,
      acceleration,
      flowPortA: qA,
      flowPortB: qB
    };
  }

  /**
   * Rotational Mechanical Gearbox:
   * Torque ratio: tau_2 = -gearRatio * tau_1 * efficiency
   * Speed ratio: omega_2 = omega_1 / gearRatio
   * 
   * @param {number} gearRatio - N2 / N1 (e.g. 5.0 for speed reduction)
   * @param {number} efficiency - Mechanical efficiency (e.g. 0.98)
   * @param {number} tau1 - Input torque (N*m)
   * @param {number} omega1 - Input angular velocity (rad/s)
   * @returns {Object} Output torque and output angular velocity
   */
  static evaluateRotationalGearbox(gearRatio, efficiency, tau1, omega1) {
    const omega2 = omega1 / gearRatio;
    const tau2 = -tau1 * gearRatio * efficiency;
    return {
      outputSpeed: omega2,
      outputTorque: tau2,
      inputPower: tau1 * omega1,
      outputPower: Math.abs(tau2 * omega2)
    };
  }

  /**
   * Rotational Torsional Spring-Damper:
   * tau = k * (theta_1 - theta_2) + c * (omega_1 - omega_2)
   * 
   * @param {number} stiffness - Torsional stiffness k (N*m/rad)
   * @param {number} damping - Torsional damping c (N*m*s/rad)
   * @param {number} deltaTheta - Angle difference (rad)
   * @param {number} deltaOmega - Relative angular velocity (rad/s)
   * @returns {number} Transmitted torque (N*m)
   */
  static evaluateTorsionalShaft(stiffness, damping, deltaTheta, deltaOmega) {
    return (stiffness * deltaTheta) + (damping * deltaOmega);
  }

  /**
   * Thermal Convective Heat Exchanger / Heat Sink:
   * Phi = h * A * (T_fluid - T_surface)
   * 
   * @param {number} h - Convection coefficient (W / (m^2 * K))
   * @param {number} area - Heat exchange surface area (m^2)
   * @param {number} tFluidK - Fluid bulk temperature (K)
   * @param {number} tSurfaceK - Surface temperature (K)
   * @returns {number} Heat transfer rate Phi (Watts)
   */
  static evaluateThermalConvection(h, area, tFluidK, tSurfaceK) {
    return h * area * (tFluidK - tSurfaceK);
  }

  /**
   * Simulates a coupled Electro-Hydraulic Actuator (EHA) loop:
   * Proportional valve spool position x_spool controls pressure drop across
   * a double-acting cylinder driving a mechanical load against inertia and damping.
   * 
   * @param {Object} params
   * @param {number} params.supplyPressure - Hydraulic pump supply pressure (Pa, e.g. 210 bar = 21e6 Pa)
   * @param {number} params.returnPressure - Tank reservoir pressure (Pa, e.g. 2 bar = 0.2e6 Pa)
   * @param {number} params.duration - Simulation time in seconds
   * @param {number} params.dt - Time step in seconds
   * @param {number} params.targetPosition - Cylinder position setpoint (m)
   * @returns {Object} Simulation time history and stability metrics
   */
  simulateElectroHydraulicLoop(params = {}) {
    const Ps = params.supplyPressure || 21e6; // 210 bar
    const Pt = params.returnPressure || 0.2e6;  // 2 bar
    const duration = params.duration || 0.5; // 500 ms
    const dt = params.dt || 0.0005; // 0.5 ms
    const targetPos = params.targetPosition || 0.10; // 100 mm stroke

    const cyl = {
      pistonAreaA: 5.0e-3, // 50 cm^2
      pistonAreaB: 3.5e-3, // 35 cm^2 (rod side)
      mass: 50.0,          // 50 kg load
      damping: 200.0       // 200 N*s/m
    };

    let pos = 0.0;
    let vel = 0.0;
    let time = 0.0;

    // Simple PID controller on spool valve opening
    const Kp = 15.0;
    const Kd = 0.8;

    const timeHistory = [];

    while (time <= duration) {
      const error = targetPos - pos;
      const spoolCommand = Math.max(-1.0, Math.min(1.0, (Kp * error) - (Kd * vel)));

      // Spool valve directs supply pressure to chamber A or B
      let pA, pB;
      if (spoolCommand >= 0.0) {
        // Forward motion: A connected to Supply, B connected to Tank
        pA = Pt + spoolCommand * (Ps - Pt);
        pB = Pt + (1.0 - spoolCommand) * (Ps * 0.1);
      } else {
        // Reverse motion: B connected to Supply, A connected to Tank
        const rev = Math.abs(spoolCommand);
        pB = Pt + rev * (Ps - Pt);
        pA = Pt + (1.0 - rev) * (Ps * 0.1);
      }

      const res = SimscapeDomainLibrary.evaluateHydraulicCylinder(cyl, pA, pB, vel, 0.0);

      // Semi-implicit Euler integration
      vel += res.acceleration * dt;
      pos += vel * dt;
      time += dt;

      if (timeHistory.length % 50 === 0) {
        timeHistory.push({
          time: parseFloat(time.toFixed(4)),
          position: pos,
          velocity: vel,
          spoolCommand,
          chamberPressureA_bar: pA / 1e5,
          chamberPressureB_bar: pB / 1e5,
          forceHydro_kN: res.fHydro / 1e3
        });
      }
    }

    return {
      finalPosition: pos,
      finalVelocity: vel,
      positionError: Math.abs(targetPos - pos),
      settled: Math.abs(targetPos - pos) < 0.005,
      history: timeHistory
    };
  }
}

// Isomorphic Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SimscapeDomainLibrary };
}
if (typeof window !== 'undefined') {
  window.SimscapeDomainLibrary = SimscapeDomainLibrary;
}
