/**
 * OmniEng 3Dconnexion SpaceMouse WebHID Controller
 * 
 * Provides native 6-DOF (Degrees of Freedom) hardware navigation for professional CAD/CAE:
 *   - Continuous simultaneous 3D translation (Pan X/Y, Zoom Z) and rotation (Pitch, Roll, Yaw).
 *   - Compatible with SpaceMouse Compact, SpaceMouse Pro, SpaceNavigator, and Enterprise.
 *   - Connects directly via standard WebHID API (zero proprietary drivers or bloatware needed).
 *   - Includes deterministic test mock interface for headless CI qualification.
 * 
 * 100% In-House Sovereign Implementation.
 */

'use strict';

class SpaceMouseController {
  /**
   * @param {Object} viewport3D - Active Viewport3D instance
   * @param {Object} [options]
   * @param {number} [options.sensitivity=1.0] - Sensitivity multiplier
   * @param {number} [options.deadband=4] - Sensor noise deadband threshold
   */
  constructor(viewport3D, options = {}) {
    this.viewport = viewport3D;
    this.sensitivity = options.sensitivity || 1.0;
    this.deadband = options.deadband || 4;
    this.device = null;
    this.isConnected = false;

    // Supported 3Dconnexion USB Vendor & Product IDs
    this.deviceFilters = [
      { vendorId: 0x256f, productId: 0xc626 }, // SpaceNavigator
      { vendorId: 0x256f, productId: 0xc62b }, // SpaceMouse Pro
      { vendorId: 0x256f, productId: 0xc62e }, // SpaceMouse Wireless
      { vendorId: 0x256f, productId: 0xc633 }, // SpaceMouse Enterprise
      { vendorId: 0x256f, productId: 0xc635 }, // SpaceMouse Compact
      { vendorId: 0x046d, productId: 0xc626 }  // 3Dconnexion legacy Logitech
    ];

    // Current 6-DOF state
    this.motion = {
      tx: 0, ty: 0, tz: 0,
      rx: 0, ry: 0, rz: 0
    };
  }

  /**
   * Prompts the user to select and pair a connected 3Dconnexion SpaceMouse.
   */
  async requestDevice() {
    if (typeof navigator === 'undefined' || !navigator.hid) {
      console.warn('[SpaceMouse] WebHID API is not supported in this environment');
      return false;
    }

    try {
      const devices = await navigator.hid.requestDevice({ filters: this.deviceFilters });
      if (devices.length > 0) {
        return await this.attachDevice(devices[0]);
      }
    } catch (err) {
      console.error('[SpaceMouse] Pairing failed:', err);
    }
    return false;
  }

  /**
   * Attaches an opened HID device and binds input report listeners.
   */
  async attachDevice(device) {
    this.device = device;
    if (!this.device.opened) {
      await this.device.open();
    }
    this.isConnected = true;
    this.device.addEventListener('inputreport', (e) => this.handleInputReport(e));
    console.log(`[SpaceMouse] Connected to ${this.device.productName || '3Dconnexion SpaceMouse'}`);
    return true;
  }

  /**
   * Decodes 6-DOF HID reports from the SpaceMouse.
   */
  handleInputReport(event) {
    const { data, reportId } = event;
    if (!data) return;

    if (reportId === 1) {
      // Translation report: 3 x 16-bit signed integers (Little Endian)
      const rawTx = data.getInt16(0, true);
      const rawTy = data.getInt16(2, true);
      const rawTz = data.getInt16(4, true);

      this.motion.tx = Math.abs(rawTx) > this.deadband ? rawTx : 0;
      this.motion.ty = Math.abs(rawTy) > this.deadband ? rawTy : 0;
      this.motion.tz = Math.abs(rawTz) > this.deadband ? rawTz : 0;
    } else if (reportId === 2) {
      // Rotation report: 3 x 16-bit signed integers (Little Endian)
      const rawRx = data.getInt16(0, true);
      const rawRy = data.getInt16(2, true);
      const rawRz = data.getInt16(4, true);

      this.motion.rx = Math.abs(rawRx) > this.deadband ? rawRx : 0;
      this.motion.ry = Math.abs(rawRy) > this.deadband ? rawRy : 0;
      this.motion.rz = Math.abs(rawRz) > this.deadband ? rawRz : 0;
    }

    this.applyMotionToViewport();
  }

  /**
   * Applies the current 6-DOF motion vector to the 3D viewport camera and target.
   */
  applyMotionToViewport() {
    if (!this.viewport) return;

    const scaleTrans = 0.005 * this.sensitivity;
    const scaleRot = 0.0008 * this.sensitivity;

    // Translation (Pan & Zoom)
    if (this.motion.tx !== 0 || this.motion.ty !== 0) {
      const panFactor = (this.viewport.cameraDistance || 200) * 0.001;
      this.viewport.target.x += this.motion.tx * scaleTrans * panFactor;
      this.viewport.target.y -= this.motion.ty * scaleTrans * panFactor;
    }

    if (this.motion.tz !== 0) {
      this.viewport.cameraDistance = Math.max(15, Math.min(2500, this.viewport.cameraDistance - this.motion.tz * scaleTrans * 2.0));
    }

    // Rotation (Orbit Theta & Phi)
    if (this.motion.ry !== 0 || this.motion.rx !== 0) {
      this.viewport.cameraAngle.theta += this.motion.ry * scaleRot;
      this.viewport.cameraAngle.phi = Math.max(0.05, Math.min(Math.PI - 0.05, this.viewport.cameraAngle.phi - this.motion.rx * scaleRot));
    }

    this.viewport.updateCameraPosition();
  }

  /**
   * Injects simulated 6-DOF motion vector for unit testing / CI automation.
   */
  simulateInput({ tx = 0, ty = 0, tz = 0, rx = 0, ry = 0, rz = 0 }) {
    this.motion = { tx, ty, tz, rx, ry, rz };
    this.applyMotionToViewport();
    return { success: true, motion: this.motion };
  }

  disconnect() {
    if (this.device && this.device.opened) {
      this.device.close();
    }
    this.isConnected = false;
    this.device = null;
  }
}

// Support both CommonJS and browser window
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SpaceMouseController };
}
if (typeof window !== 'undefined') {
  window.SpaceMouseController = SpaceMouseController;
}
