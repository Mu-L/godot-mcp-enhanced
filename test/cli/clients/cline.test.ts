import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ClineAdapter', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); });

  const clineSubpath = ['Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'];

  it('has global scope', async () => {
    const { ClineAdapter } = await import('../../../src/cli/clients/cline.js');
    expect(new ClineAdapter().scope).toBe('global');
  });

  it('configure seeds disabled:false + autoApprove:[] on first create', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-cline-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const { ClineAdapter } = await import('../../../src/cli/clients/cline.js');
    await new ClineAdapter().configure('/ignored', '/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(join(fakeRoot, ...clineSubpath), 'utf-8'));
    expect(config.mcpServers.godot.disabled).toBe(false);
    expect(config.mcpServers.godot.autoApprove).toEqual([]);
    rmSync(fakeRoot, { recursive: true, force: true });
  });

  it('configure preserves user disabled + autoApprove on reconfigure', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-cline-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const filePath = join(fakeRoot, ...clineSubpath);
    mkdirSync(join(filePath, '..'), { recursive: true });
    writeFileSync(filePath, JSON.stringify({
      mcpServers: { godot: { command: 'old', disabled: true, autoApprove: ['tool1'] } },
    }));
    const { ClineAdapter } = await import('../../../src/cli/clients/cline.js');
    await new ClineAdapter().configure('/ignored', '/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(config.mcpServers.godot.disabled).toBe(true);            // 用户旧值保留
    expect(config.mcpServers.godot.autoApprove).toEqual(['tool1']); // 用户旧值保留
    expect(config.mcpServers.godot.command).toBe('npx');            // 配置更新
    rmSync(fakeRoot, { recursive: true, force: true });
  });

  it('isConfigured returns true after configure', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-cline-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const { ClineAdapter } = await import('../../../src/cli/clients/cline.js');
    const adapter = new ClineAdapter();
    await adapter.configure('/ignored', '/godot', 'npx', []);
    expect(await adapter.isConfigured('/ignored')).toBe(true);
    rmSync(fakeRoot, { recursive: true, force: true });
  });
});
