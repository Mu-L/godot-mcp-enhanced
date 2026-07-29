import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, mkdtempSync, readdirSync, statSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ClaudeCodeAdapter } from '../../../src/cli/clients/claude-code.js';

// BOM 必须运行时构建——Write 工具会把 '' 转义解析为字面 BOM 字符写入源码（不可见）
const BOM = String.fromCharCode(0xFEFF);

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

  it('isConfigured returns true for BOM-prefixed valid JSON (BOM 防御)', async () => {
    const claudeDir = join(testDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'settings.json'), BOM + JSON.stringify({
      mcpServers: { godot: { command: 'npx' } },
    }));
    expect(await adapter.isConfigured(testDir)).toBe(true);
  });

  it('configure preserves existing settings.json mode (F3 adapter-no-mode-preserve)', async () => {
    // F3: adapter 旧实现 writeFileSync(tmp, data, 'utf-8') 第三参 encoding 非 mode,
    // rename 后 mode 被默认 0o666 覆盖。改用 writeFileAtomicWithMode 后应保持原 mode。
    const claudeDir = join(testDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    const settingsPath = join(claudeDir, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({ mcpServers: {} }));
    try { chmodSync(settingsPath, 0o600); } catch { /* Windows chmod no-op */ }
    const beforeMode = statSync(settingsPath).mode & 0o777;
    await adapter.configure(testDir, '/godot', 'npx', ['godot-mcp-enhanced']);
    const afterMode = statSync(settingsPath).mode & 0o777;
    if (process.platform !== 'win32') {
      // Unix: 用户 chmod 0o600 必须保持(修复核心断言)
      expect(beforeMode).toBe(0o600);
      expect(afterMode).toBe(0o600);
    } else {
      // Windows: stat.mode 无业务意义,helper no-op 不破坏(after === before)
      expect(afterMode).toBe(beforeMode);
    }
    // 内容正确 + godot entry 写入
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    expect(settings.mcpServers.godot.command).toBe('npx');
  });
});
