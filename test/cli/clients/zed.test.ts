import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rmSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'fs';
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

  // C1: context_servers.godot.env 也必须保留白名单用户 env
  it('configure preserves whitelisted user env on reconfigure (C1, context_servers 键)', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-zed-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const filePath = join(fakeRoot, 'Zed', 'settings.json');
    mkdirSync(join(filePath, '..'), { recursive: true });
    writeFileSync(filePath, JSON.stringify({
      context_servers: {
        godot: {
          command: 'old',
          env: {
            GODOT_PATH: '/old',
            ALLOWED_PROJECT_PATHS: '/projects',
            GODOT_MCP_BRIDGE_EXTRA_METHODS: 'emit_signal',
            HACKER_INJECTED: 'evil',
          },
        },
      },
    }));
    const { ZedAdapter } = await import('../../../src/cli/clients/zed.js');
    await new ZedAdapter().configure('/ignored', '/new/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(filePath, 'utf-8'));
    const env = config.context_servers.godot.env;
    expect(env.GODOT_PATH).toBe('/new/godot');
    expect(env.ALLOWED_PROJECT_PATHS).toBe('/projects');
    expect(env.GODOT_MCP_BRIDGE_EXTRA_METHODS).toBe('emit_signal');
    expect(env.HACKER_INJECTED).toBeUndefined();
    rmSync(fakeRoot, { recursive: true, force: true });
  });
});
