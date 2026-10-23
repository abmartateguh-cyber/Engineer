/**
 * OmniEng Master IPC Registration Hub
 * 
 * Aggregates all domain routers under unified schema validation and audit logging:
 * - CAD Router (22 channels)
 * - CAE Router (22 channels)
 * - EDA Router (17 channels)
 * - Optics Router (13 channels)
 * - Plant Router (15 channels)
 * - Controls Router (13 channels)
 * - System Router (29 channels)
 * Total: 131/131 Channels 100% Schema-Validated
 */

'use strict';

const { defineHandler, getRegisteredChannels, isChannelRegistered } = require('./define_handler');
const { registerCadIpc } = require('./cad_ipc');
const { registerCaeIpc } = require('./cae_ipc');
const { registerEdaIpc } = require('./eda_ipc');
const { registerOpticsIpc } = require('./optics_ipc');
const { registerPlantIpc } = require('./plant_ipc');
const { registerControlsIpc } = require('./controls_ipc');
const { registerSystemIpc } = require('./system_ipc');

function registerAllIpcHandlers(dependencies = {}) {
  registerCadIpc(dependencies);
  registerCaeIpc(dependencies);
  registerEdaIpc(dependencies);
  registerOpticsIpc(dependencies);
  registerPlantIpc(dependencies);
  registerControlsIpc(dependencies);
  registerSystemIpc(dependencies);

  const total = getRegisteredChannels().length;
  console.log(`[OmniEng IPC Security Gateway] Successfully registered and validated ${total} channels across 7 domains.`);
  return { success: true, registeredCount: total };
}

module.exports = {
  registerAllIpcHandlers,
  defineHandler,
  getRegisteredChannels,
  isChannelRegistered
};
