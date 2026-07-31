// src/telemetry/index.ts
export { isTelemetryEnabled, getInstallUUID, cleanupLocalFiles } from './config.js';
export { hashProject, sanitizeVersion } from './sanitize.js';
export { record, QUEUE_MAXSIZE } from './collector.js';
export type { TelemetryEvent } from './collector.js';
