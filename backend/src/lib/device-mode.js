// The prototype represents virtual parking lots unless physical telemetry is
// explicitly selected. Read at call time so each isolated test can select a mode.
function getDeviceMode() { return process.env.DEVICE_MODE === 'telemetry' ? 'telemetry' : 'simulation'; }
function isSimulationMode() { return getDeviceMode() === 'simulation'; }
module.exports = { getDeviceMode, isSimulationMode };
