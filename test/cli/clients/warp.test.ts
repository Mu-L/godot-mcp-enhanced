import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { WarpAdapter } from '../../../src/cli/clients/warp.js';

describe('WarpAdapter', () => {
  const adapter = new WarpAdapter();
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'mcp-test-warp-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('has correct name', () => {
    expect(adapter.name).toBe('Warp');
  });

  it('has project scope', () => {
    expect(adapter.scope).toBe('project');
  });

  it('isConfigured returns false when no .warp dir', async () => {
    expect(await adapter.isConfigured(testDir)).toBe(false);
  });

  it('isConfigured returns false when no godot entry', async () => {
    const warpDir = join(testDir, '.warp');
    mkdirSync(warpDir, { recursive: true });
    writeFileSync(join(warpDir, '.mcp.json'), JSON.stringify({ mcpServers: {} }));
    expect(await adapter.isConfigured(testDir)).toBe(false);
  });

  it('isConfigured returns true when godot entry exists', async () => {
    const warpDir = join(testDir, '.warp');
    mkdirSync(warpDir, { recursive: true });
    writeFileSync(join(warpDir, '.mcp.json'), JSON.stringify({
      mcpServers: { godot: { command: 'npx' } },
    }));
    expect(await adapter.isConfigured(testDir)).toBe(true);
  });

  it('configure creates .warp/.mcp.json with godot entry + working_directory', async () => {
    await adapter.configure(testDir, '/path/to/godot', 'npx', ['-y', 'godot-mcp-enhanced']);
    const configPath = join(testDir, '.warp', '.mcp.json');
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(config.mcpServers.godot.command).toBe('npx');
    expect(config.mcpServers.godot.args).toEqual(['-y', 'godot-mcp-enhanced']);
    expect(config.mcpServers.godot.env.GODOT_PATH).toBe('/path/to/godot');
    // 指南 §5:working_directory 必须显式设为项目根(否则 resolveProjectPath 每次 WARN)
    expect(config.mcpServers.godot.working_directory).toBe(testDir);
  });

  it('configure merges with existing config and preserves other servers', async () => {
    const warpDir = join(testDir, '.warp');
    mkdirSync(warpDir, { recursive: true });
    writeFileSync(join(warpDir, '.mcp.json'), JSON.stringify({
      otherSetting: true,
      mcpServers: { other: { command: 'other' } },
    }));
    await adapter.configure(testDir, '/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(join(warpDir, '.mcp.json'), 'utf-8'));
    expect(config.otherSetting).toBe(true);
    expect(config.mcpServers.other.command).toBe('other');
    expect(config.mcpServers.godot.command).toBe('npx');
  });

  it('configure preserves whitelisted user env on reconfigure (C1)', async () => {
    const warpDir = join(testDir, '.warp');
    mkdirSync(warpDir, { recursive: true });
    const configPath = join(warpDir, '.mcp.json');
    writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        godot: {
          command: 'old',
          env: {
            GODOT_PATH: '/old',
            ALLOWED_PROJECT_PATHS: '/projects',
            GODOT_MCP_UNRESTRICTED: 'true',
          },
        },
      },
    }));
    await adapter.configure(testDir, '/new/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    const env = config.mcpServers.godot.env;
    expect(env.GODOT_PATH).toBe('/new/godot');
    expect(env.ALLOWED_PROJECT_PATHS).toBe('/projects');
    expect(env.GODOT_MCP_UNRESTRICTED).toBeUndefined();
  });
});
