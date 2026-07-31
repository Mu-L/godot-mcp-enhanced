import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('telemetry/config', () => {
  let fakeHome: string;
  beforeEach(() => {
    vi.resetModules();
    fakeHome = mkdtempSync(join(tmpdir(), 'mcp-tel-'));
    vi.doMock('os', async (importActual) => {
      const actual = await importActual<typeof import('os')>();
      return { ...actual, homedir: () => fakeHome };
    });
    vi.stubEnv('CI', '');
    vi.stubEnv('GODOT_MCP_TELEMETRY', '');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('isTelemetryEnabled default false (opt-in)', async () => {
    const { isTelemetryEnabled } = await import('../../src/telemetry/config.js');
    expect(isTelemetryEnabled()).toBe(false);
  });

  it('isTelemetryEnabled true when GODOT_MCP_TELEMETRY=true', async () => {
    vi.stubEnv('GODOT_MCP_TELEMETRY', 'true');
    const { isTelemetryEnabled } = await import('../../src/telemetry/config.js');
    expect(isTelemetryEnabled()).toBe(true);
  });

  it('isTelemetryEnabled false when CI=true even if telemetry enabled', async () => {
    vi.stubEnv('GODOT_MCP_TELEMETRY', 'true');
    vi.stubEnv('CI', 'true');
    const { isTelemetryEnabled } = await import('../../src/telemetry/config.js');
    expect(isTelemetryEnabled()).toBe(false);
  });

  it('getInstallUUID mints + writes back when file missing', async () => {
    const { getInstallUUID } = await import('../../src/telemetry/config.js');
    const uuid = getInstallUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const written = readFileSync(join(fakeHome, '.godot-mcp', 'telemetry-uuid.txt'), 'utf-8').trim();
    expect(written).toBe(uuid);
  });

  it('getInstallUUID reuses existing file (身份收敛, godot-ai #529)', async () => {
    mkdirSyncDotGodotMcp(fakeHome);
    writeFileSync(join(fakeHome, '.godot-mcp', 'telemetry-uuid.txt'), 'preset-uuid-1234\n');
    const { getInstallUUID } = await import('../../src/telemetry/config.js');
    expect(getInstallUUID()).toBe('preset-uuid-1234');
    // 二次调用缓存一致
    expect(getInstallUUID()).toBe('preset-uuid-1234');
  });
});

function mkdirSyncDotGodotMcp(home: string) {
  const { mkdirSync } = require('fs');
  mkdirSync(join(home, '.godot-mcp'), { recursive: true });
}
