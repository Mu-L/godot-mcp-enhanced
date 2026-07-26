import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { QwenCodeAdapter } from '../../../src/cli/clients/qwen-code.js';

describe('QwenCodeAdapter', () => {
  const adapter = new QwenCodeAdapter();
  let testDir: string;

  beforeEach(() => { testDir = mkdtempSync(join(tmpdir(), 'mcp-qwen-')); });
  afterEach(() => { rmSync(testDir, { recursive: true, force: true }); });

  it('has project scope', () => {
    expect(adapter.scope).toBe('project');
  });

  it('configure writes mcpServers.godot to {project}/.qwen/settings.json', async () => {
    await adapter.configure(testDir, '/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(join(testDir, '.qwen', 'settings.json'), 'utf-8'));
    expect(config.mcpServers.godot.env.GODOT_PATH).toBe('/godot');
    expect(config.mcpServers.godot.type).toBeUndefined();
  });

  it('configure preserves trust + excludeTools + description on reconfigure', async () => {
    const dir = join(testDir, '.qwen');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({
      mcpServers: { godot: { command: 'old', trust: true, excludeTools: ['t1'], description: 'my server' } },
    }));
    await adapter.configure(testDir, '/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf-8'));
    expect(config.mcpServers.godot.trust).toBe(true);
    expect(config.mcpServers.godot.excludeTools).toEqual(['t1']);
    expect(config.mcpServers.godot.description).toBe('my server');
    expect(config.mcpServers.godot.command).toBe('npx');
  });

  it('isConfigured returns true after configure', async () => {
    await adapter.configure(testDir, '/godot', 'npx', []);
    expect(await adapter.isConfigured(testDir)).toBe(true);
  });
});
