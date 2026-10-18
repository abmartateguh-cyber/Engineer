/**
 * OmniEng Penalty Contact Search & Enforcement Engine
 * Standard: Node-to-Surface Penalty Method with Coulomb Friction
 * Industrial Parity: LS-DYNA *CONTACT_AUTOMATIC_SURFACE_TO_SURFACE / Ansys Mechanical Contact.
 */

class PenaltyContact {
  constructor(opts = {}) {
    this.penaltyStiffness = opts.penaltyStiffness || 1e8; // N/m
    this.frictionCoeff = opts.frictionCoeff !== undefined ? opts.frictionCoeff : 0.35;
  }

  evaluateNodeContact(slaveNode, masterFacet) {
    const v0 = masterFacet.v0 || [0, 0, 0];
    const N = masterFacet.normal || [0, 0, 1];
    const pos = slaveNode.pos;
    const vel = slaveNode.vel || [0, 0, 0];

    const dx = pos[0] - v0[0];
    const dy = pos[1] - v0[1];
    const dz = pos[2] - v0[2];

    const gn = dx * N[0] + dy * N[1] + dz * N[2];
    if (gn < 0) {
      const delta = -gn; // Penetration depth in meters
      const fn = this.penaltyStiffness * delta;
      const vDotN = vel[0] * N[0] + vel[1] * N[1] + vel[2] * N[2];
      const vt = [vel[0] - vDotN * N[0], vel[1] - vDotN * N[1], vel[2] - vDotN * N[2]];
      const vtMag = Math.sqrt(vt[0]*vt[0] + vt[1]*vt[1] + vt[2]*vt[2]);
      const ft = this.frictionCoeff * fn;
      const strainEnergy = 0.5 * this.penaltyStiffness * delta * delta;

      return {
        inContact: true,
        penetrationM: delta,
        normalForceN: fn,
        frictionForceN: ft,
        strainEnergyJ: strainEnergy
      };
    }

    return {
      inContact: false,
      penetrationM: 0,
      normalForceN: 0,
      frictionForceN: 0,
      strainEnergyJ: 0
    };
  }

  /**
   * Evaluates penalty contact force for a set of slave nodes against a master surface or rigid floor.
   * @param {Object[]} slaveNodes Array of nodes [{ id, pos: [x,y,z], vel: [vx,vy,vz], mass }]
   * @param {Object} masterSurface Surface definition:
   *   type: 'RIGID_PLANE', 'CONCAVE_HALFSPACE', 'MESH_FACETS'
   *   origin: [x,y,z]
   *   normal: [nx,ny,nz] (unit outward normal from target)
   *   frictionCoeff: Coulomb friction coefficient mu (e.g. 0.35 concrete/steel)
   *   penaltyStiffness: Spring stiffness k_p (N/mm)
   */
  static evaluateContact(slaveNodes, masterSurface) {
    const origin = masterSurface.origin || [0, 0, 0];
    const rawN = masterSurface.normal || [0, 0, 1];
    const nLen = Math.sqrt(rawN[0] * rawN[0] + rawN[1] * rawN[1] + rawN[2] * rawN[2]) || 1.0;
    const N = [rawN[0] / nLen, rawN[1] / nLen, rawN[2] / nLen];

    const mu = masterSurface.frictionCoeff !== undefined ? masterSurface.frictionCoeff : 0.35;
    const kp = masterSurface.penaltyStiffness || 5000.0; // N/mm (5 kN/mm default)

    const activeContacts = [];
    let totalNormalForce = 0.0;
    let totalFrictionForce = 0.0;
    let totalContactEnergy = 0.0;

    for (let i = 0; i < slaveNodes.length; i++) {
      const node = slaveNodes[i];
      const pos = node.pos || [0, 0, 0];
      const vel = node.vel || [0, 0, 0];

      // Vector from surface origin to slave node: d = x_s - x_0
      const dx = pos[0] - origin[0];
      const dy = pos[1] - origin[1];
      const dz = pos[2] - origin[2];

      // Gap function: gn = d . N
      const gn = dx * N[0] + dy * N[1] + dz * N[2];

      // If gn < 0, penetration has occurred!
      if (gn < 0.0) {
        const penetration = -gn; // Depth delta (mm)

        // 1. Normal Contact Force Fn = kp * delta * N
        const fnMag = kp * penetration;
        const Fn = [fnMag * N[0], fnMag * N[1], fnMag * N[2]];

        // 2. Relative Tangential Velocity Vt = V - (V . N) * N
        const vDotN = vel[0] * N[0] + vel[1] * N[1] + vel[2] * N[2];
        const vt = [
          vel[0] - vDotN * N[0],
          vel[1] - vDotN * N[1],
          vel[2] - vDotN * N[2]
        ];
        const vtMag = Math.sqrt(vt[0] * vt[0] + vt[1] * vt[1] + vt[2] * vt[2]);

        // 3. Coulomb Friction Force Ft = -min(kt * vt, mu * Fn) * (vt / |vt|)
        let Ft = [0, 0, 0];
        let ftMag = 0.0;

        if (vtMag > 1e-6) {
          const maxFriction = mu * fnMag;
          ftMag = maxFriction;
          Ft = [
            -maxFriction * (vt[0] / vtMag),
            -maxFriction * (vt[1] / vtMag),
            -maxFriction * (vt[2] / vtMag)
          ];
        }

        // 4. Elastic Strain Energy of Contact: Ec = 0.5 * kp * delta^2
        const contactEnergy = 0.5 * kp * penetration * penetration;

        totalNormalForce += fnMag;
        totalFrictionForce += ftMag;
        totalContactEnergy += contactEnergy;

        activeContacts.push({
          nodeId: node.id || `node_${i}`,
          penetrationMm: Number(penetration.toFixed(5)),
          normalForceN: [Number(Fn[0].toFixed(2)), Number(Fn[1].toFixed(2)), Number(Fn[2].toFixed(2))],
          normalMagnitudeN: Number(fnMag.toFixed(2)),
          frictionForceN: [Number(Ft[0].toFixed(2)), Number(Ft[1].toFixed(2)), Number(Ft[2].toFixed(2))],
          frictionMagnitudeN: Number(ftMag.toFixed(2)),
          totalForceN: [
            Number((Fn[0] + Ft[0]).toFixed(2)),
            Number((Fn[1] + Ft[1]).toFixed(2)),
            Number((Fn[2] + Ft[2]).toFixed(2))
          ],
          contactEnergyMilliJoules: Number(contactEnergy.toFixed(4))
        });
      }
    }

    return {
      hasContact: activeContacts.length > 0,
      activeContactCount: activeContacts.length,
      totalNormalForceN: Number(totalNormalForce.toFixed(2)),
      totalFrictionForceN: Number(totalFrictionForce.toFixed(2)),
      totalContactEnergyMilliJoules: Number(totalContactEnergy.toFixed(4)),
      contacts: activeContacts
    };
  }

  /**
   * Applies penalty contact acceleration updates to explicit time-marching nodal states.
   */
  static applyContactForces(nodes, contactResult) {
    if (!contactResult.hasContact) return nodes;

    const contactMap = new Map();
    for (const c of contactResult.contacts) {
      contactMap.set(c.nodeId, c.totalForceN);
    }

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const id = node.id || `node_${i}`;
      if (contactMap.has(id)) {
        const F = contactMap.get(id);
        const mass = Math.max(1e-6, node.mass || 1.0);
        // a_contact = F / m
        node.accel = node.accel || [0, 0, 0];
        node.accel[0] += F[0] / mass;
        node.accel[1] += F[1] / mass;
        node.accel[2] += F[2] / mass;
      }
    }

    return nodes;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PenaltyContact };
}
