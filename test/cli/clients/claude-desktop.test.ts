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
});
