import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('WindsurfAdapter', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('has global scope', async () => {
    const { WindsurfAdapter } = await import('../../../src/cli/clients/windsurf.js');
    expect(new WindsurfAdapter().scope).toBe('global');
  });

  it('configure writes mcpServers.godot to ~/.codeium/windsurf/', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'mcp-ws-'));
    vi.doMock('os', () => ({ homedir: () => fakeHome }));
    const { WindsurfAdapter } = await import('../../../src/cli/clients/windsurf.js');
    const adapter = new WindsurfAdapter();
    await adapter.configure('/ignored', '/godot', 'npx', ['godot-mcp-enhanced']);
    const configPath = join(fakeHome, '.codeium', 'windsurf', 'mcp_config.json');
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(config.mcpServers.godot.env.GODOT_PATH).toBe('/godot');
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('isConfigured returns true after configure (反向断言)', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'mcp-ws-'));
    vi.doMock('os', () => ({ homedir: () => fakeHome }));
    const { WindsurfAdapter } = await import('../../../src/cli/clients/windsurf.js');
    const adapter = new WindsurfAdapter();
    await adapter.configure('/ignored', '/godot', 'npx', []);
    expect(await adapter.isConfigured('/ignored')).toBe(true);
    rmSync(fakeHome, { recursive: true, force: true });
  });
});
