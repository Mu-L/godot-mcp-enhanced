import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, mkdtempSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ClaudeCodeAdapter } from '../../../src/cli/clients/claude-code.js';

describe('ClaudeCodeAdapter', () => {
  const adapter = new ClaudeCodeAdapter();
  let testDir: string;

  beforeEach(() => {
    // mkdtempSync 保证唯一:原 mcp-test-${Date.now()} 与 cursor.test.ts 同名空间,
    // 并发 worker 同毫秒碰撞 → 互相 rmSync → ENOENT flaky(coverage 模式时序放大)
    testDir = mkdtempSync(join(tmpdir(), 'mcp-test-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('has correct name', () => {
    expect(adapter.name).toBe('Claude Code');
  });

  it('has project scope', () => {
    expect(adapter.scope).toBe('project');
  });

  it('isConfigured returns false when no settings file', async () => {
    expect(await adapter.isConfigured(testDir)).toBe(false);
  });

  it('isConfigured returns false when no godot entry', async () => {
    const claudeDir = join(testDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({ mcpServers: {} }));
    expect(await adapter.isConfigured(testDir)).toBe(false);
  });

  it('isConfigured returns true when godot entry exists', async () => {
    const claudeDir = join(testDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({
      mcpServers: { godot: { command: 'npx', args: ['godot-mcp-enhanced'] } },
    }));
    expect(await adapter.isConfigured(testDir)).toBe(true);
  });

  it('configure creates settings file with godot entry', async () => {
    await adapter.configure(testDir, '/path/to/godot', 'npx', ['godot-mcp-enhanced']);
    const settingsPath = join(testDir, '.claude', 'settings.json');
    expect(existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    expect(settings.mcpServers.godot.command).toBe('npx');
    expect(settings.mcpServers.godot.env.GODOT_PATH).toBe('/path/to/godot');
  });

  it('configure merges with existing settings', async () => {
    const claudeDir = join(testDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({
      otherSetting: true,
      mcpServers: { other: { command: 'other' } },
    }));
    await adapter.configure(testDir, '/godot', 'npx', ['godot-mcp-enhanced']);
    const settings = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf-8'));
    expect(settings.otherSetting).toBe(true);
    expect(settings.mcpServers.other.command).toBe('other');
    expect(settings.mcpServers.godot.command).toBe('npx');
  });

  it('configure backs up corrupted settings.json before overwriting (F3)', async () => {
    const claudeDir = join(testDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    const settingsPath = join(claudeDir, 'settings.json');
    const corrupt = '{ "mcpServers": { broken';
    writeFileSync(settingsPath, corrupt);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await adapter.configure(testDir, '/godot', 'npx', ['godot-mcp-enhanced']);
    // 原始损坏内容已备份(不丢失用户数据)
    const backups = readdirSync(claudeDir).filter(f => f.startsWith('settings.json.corrupt.') && f.endsWith('.bak'));
    expect(backups.length).toBe(1);
    expect(readFileSync(join(claudeDir, backups[0]!), 'utf-8')).toBe(corrupt);
    // 新文件是合法 JSON 且含 godot
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    expect(settings.mcpServers.godot.command).toBe('npx');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
