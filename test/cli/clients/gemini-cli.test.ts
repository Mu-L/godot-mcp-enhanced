import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GeminiCliAdapter } from '../../../src/cli/clients/gemini-cli.js';

describe('GeminiCliAdapter', () => {
  const adapter = new GeminiCliAdapter();
  let testDir: string;

  beforeEach(() => { testDir = mkdtempSync(join(tmpdir(), 'mcp-gem-')); });
  afterEach(() => { rmSync(testDir, { recursive: true, force: true }); });

  it('has project scope', () => {
    expect(adapter.scope).toBe('project');
  });

  it('configure writes mcpServers.godot to {project}/.gemini/settings.json', async () => {
    await adapter.configure(testDir, '/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(join(testDir, '.gemini', 'settings.json'), 'utf-8'));
    expect(config.mcpServers.godot.env.GODOT_PATH).toBe('/godot');
    expect(config.mcpServers.godot.type).toBeUndefined(); // stdio 无 type
  });

  it('configure preserves trust + includeTools on reconfigure', async () => {
    const dir = join(testDir, '.gemini');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({
      mcpServers: { godot: { command: 'old', trust: true, includeTools: ['t1'], timeout: 30000 } },
    }));
    await adapter.configure(testDir, '/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf-8'));
    expect(config.mcpServers.godot.trust).toBe(true);
    expect(config.mcpServers.godot.includeTools).toEqual(['t1']);
    expect(config.mcpServers.godot.timeout).toBe(30000);
    expect(config.mcpServers.godot.command).toBe('npx');
  });

  it('isConfigured returns true after configure', async () => {
    await adapter.configure(testDir, '/godot', 'npx', []);
    expect(await adapter.isConfigured(testDir)).toBe(true);
  });
});
