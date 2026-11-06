/**
 * OmniEng IPC Registration Hub
 *
 * Aggregates domain routers under shared wrapper checks and per-route validation:
 * - CAD Router (22 channels)
 * - CAE Router (22 channels)
 * - EDA Router (17 channels)
 * - Optics Router (13 channels)
 * - Plant Router (15 channels)
 * - Controls Router (13 channels)
 * - System Router (29 channels)
 * Handler registration does not establish complete schema coverage or release readiness.
 */

'use strict';

const { defineHandler, getRegisteredChannels, isChannelRegistered, withIpcMain } = require('./define_handler');
const { registerCadIpc } = require('./cad_ipc');
const { registerCaeIpc } = require('./cae_ipc');
const { registerEdaIpc } = require('./eda_ipc');
const { registerOpticsIpc } = require('./optics_ipc');
const { registerPlantIpc } = require('./plant_ipc');
const { registerControlsIpc } = require('./controls_ipc');
const { registerSystemIpc } = require('./system_ipc');
const { registerHpcIpc } = require('./hpc_ipc');

function registerAllIpcHandlers(dependencies = {}) {
  const register = () => {
    registerCadIpc(dependencies);
    registerCaeIpc(dependencies);
    registerEdaIpc(dependencies);
    registerOpticsIpc(dependencies);
    registerPlantIpc(dependencies);
    registerControlsIpc(dependencies);
    registerSystemIpc(dependencies);
    registerHpcIpc(dependencies);

    const total = getRegisteredChannels().length;
    console.log(
      `[OmniEng IPC] Registered ${total} channels across 8 domains; this does not establish schema coverage or sender authorization.`
    );
    return { success: true, registeredCount: total };
  };

  return dependencies.ipcMain ? withIpcMain(dependencies.ipcMain, register) : register();
}

module.exports = {
  registerAllIpcHandlers,
  defineHandler,
  getRegisteredChannels,
  isChannelRegistered
};
