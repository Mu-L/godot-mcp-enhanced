import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rmSync, readFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ZedAdapter', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('has global scope', async () => {
    const { ZedAdapter } = await import('../../../src/cli/clients/zed.js');
    expect(new ZedAdapter().scope).toBe('global');
  });

  it('configure writes context_servers.godot (非 mcpServers)', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-zed-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const { ZedAdapter } = await import('../../../src/cli/clients/zed.js');
    await new ZedAdapter().configure('/ignored', '/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(join(fakeRoot, 'Zed', 'settings.json'), 'utf-8'));
    expect(config.context_servers.godot.env.GODOT_PATH).toBe('/godot');
    expect(config.context_servers.godot.type).toBeUndefined(); // stdio 无 type
    rmSync(fakeRoot, { recursive: true, force: true });
  });

  it('isConfigured returns true after configure', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-zed-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const { ZedAdapter } = await import('../../../src/cli/clients/zed.js');
    const adapter = new ZedAdapter();
    await adapter.configure('/ignored', '/godot', 'npx', []);
    expect(await adapter.isConfigured('/ignored')).toBe(true);
    rmSync(fakeRoot, { recursive: true, force: true });
  });
});
