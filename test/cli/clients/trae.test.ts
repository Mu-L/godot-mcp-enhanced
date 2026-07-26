import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rmSync, readFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('TraeAdapter', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('has global scope', async () => {
    const { TraeAdapter } = await import('../../../src/cli/clients/trae.js');
    expect(new TraeAdapter().scope).toBe('global');
  });

  it('configure writes mcpServers.godot without type (保守)', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-trae-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const { TraeAdapter } = await import('../../../src/cli/clients/trae.js');
    await new TraeAdapter().configure('/ignored', '/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(join(fakeRoot, 'Trae', 'User', 'mcp.json'), 'utf-8'));
    expect(config.mcpServers.godot.env.GODOT_PATH).toBe('/godot');
    expect(config.mcpServers.godot.type).toBeUndefined(); // 保守不加，实机验证待定
    rmSync(fakeRoot, { recursive: true, force: true });
  });

  it('isConfigured returns true after configure', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-trae-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const { TraeAdapter } = await import('../../../src/cli/clients/trae.js');
    const adapter = new TraeAdapter();
    await adapter.configure('/ignored', '/godot', 'npx', []);
    expect(await adapter.isConfigured('/ignored')).toBe(true);
    rmSync(fakeRoot, { recursive: true, force: true });
  });
});
