import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('CherryStudioAdapter', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('has global scope', async () => {
    const { CherryStudioAdapter } = await import('../../../src/cli/clients/cherry-studio.js');
    expect(new CherryStudioAdapter().scope).toBe('global');
  });

  it('configure writes type:stdio + seeds isActive:true (schema 强制 type)', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-cs-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const { CherryStudioAdapter } = await import('../../../src/cli/clients/cherry-studio.js');
    await new CherryStudioAdapter().configure('/ignored', '/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(join(fakeRoot, 'CherryStudio', 'mcp_servers.json'), 'utf-8'));
    expect(config.mcpServers.godot.type).toBe('stdio'); // schema enum 强制
    expect(config.mcpServers.godot.env.GODOT_PATH).toBe('/godot');
    expect(config.mcpServers.godot.isActive).toBe(true);
    rmSync(fakeRoot, { recursive: true, force: true });
  });

  it('configure preserves isActive + installSource on reconfigure', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-cs-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const filePath = join(fakeRoot, 'CherryStudio', 'mcp_servers.json');
    mkdirSync(join(filePath, '..'), { recursive: true });
    writeFileSync(filePath, JSON.stringify({
      mcpServers: { godot: { type: 'stdio', command: 'old', isActive: false, installSource: 'manual' } },
    }));
    const { CherryStudioAdapter } = await import('../../../src/cli/clients/cherry-studio.js');
    await new CherryStudioAdapter().configure('/ignored', '/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(config.mcpServers.godot.isActive).toBe(false);
    expect(config.mcpServers.godot.installSource).toBe('manual');
    expect(config.mcpServers.godot.type).toBe('stdio');
    rmSync(fakeRoot, { recursive: true, force: true });
  });

  it('isConfigured returns true after configure', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-cs-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const { CherryStudioAdapter } = await import('../../../src/cli/clients/cherry-studio.js');
    const adapter = new CherryStudioAdapter();
    await adapter.configure('/ignored', '/godot', 'npx', []);
    expect(await adapter.isConfigured('/ignored')).toBe(true);
    rmSync(fakeRoot, { recursive: true, force: true });
  });
});
