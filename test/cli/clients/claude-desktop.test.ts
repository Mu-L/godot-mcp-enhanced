import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ClaudeDesktopAdapter', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('has global scope', async () => {
    const { ClaudeDesktopAdapter } = await import('../../../src/cli/clients/claude-desktop.js');
    expect(new ClaudeDesktopAdapter().scope).toBe('global');
  });

  it('configure writes mcpServers.godot to global path', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-cd-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const { ClaudeDesktopAdapter } = await import('../../../src/cli/clients/claude-desktop.js');
    const adapter = new ClaudeDesktopAdapter();
    await adapter.configure('/ignored', '/godot', 'npx', ['godot-mcp-enhanced']);
    const configPath = join(fakeRoot, 'Claude', 'claude_desktop_config.json');
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(config.mcpServers.godot.env.GODOT_PATH).toBe('/godot');
    // projectDir 对 global scope 是 no-op
    rmSync(fakeRoot, { recursive: true, force: true });
  });

  it('isConfigured returns true after configure (反向断言)', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-cd-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const { ClaudeDesktopAdapter } = await import('../../../src/cli/clients/claude-desktop.js');
    const adapter = new ClaudeDesktopAdapter();
    await adapter.configure('/ignored', '/godot', 'npx', ['godot-mcp-enhanced']);
    expect(await adapter.isConfigured('/ignored')).toBe(true);
    rmSync(fakeRoot, { recursive: true, force: true });
  });

  it('isConfigured returns false when no config', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-cd-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const { ClaudeDesktopAdapter } = await import('../../../src/cli/clients/claude-desktop.js');
    expect(await new ClaudeDesktopAdapter().isConfigured('/ignored')).toBe(false);
    rmSync(fakeRoot, { recursive: true, force: true });
  });

  // C1: global scope Pattern A 也必须保留白名单用户 env
  it('configure preserves whitelisted user env on reconfigure (C1, global scope)', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-cd-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const configPath = join(fakeRoot, 'Claude', 'claude_desktop_config.json');
    mkdirSync(join(configPath, '..'), { recursive: true });
    writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        godot: {
          command: 'old',
          env: {
            GODOT_PATH: '/old',
            ALLOWED_PROJECT_PATHS: '/global/projects',
            GODOT_MCP_EDITOR_PERSISTENT_SECRET: 'true',
            HACKER_INJECTED: 'evil',
          },
        },
      },
    }));
    const { ClaudeDesktopAdapter } = await import('../../../src/cli/clients/claude-desktop.js');
    await new ClaudeDesktopAdapter().configure('/ignored', '/new/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    const env = config.mcpServers.godot.env;
    expect(env.GODOT_PATH).toBe('/new/godot');
    expect(env.ALLOWED_PROJECT_PATHS).toBe('/global/projects');
    expect(env.GODOT_MCP_EDITOR_PERSISTENT_SECRET).toBe('true');
    expect(env.HACKER_INJECTED).toBeUndefined();
    rmSync(fakeRoot, { recursive: true, force: true });
  });
});
