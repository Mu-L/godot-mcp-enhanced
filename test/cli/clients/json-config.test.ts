import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, mkdtempSync, readdirSync, statSync, chmodSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readJsonConfigWithBackup, readJsonForCheck, stripBom, writeFileAtomicWithMode } from '../../../src/cli/clients/json-config.js';

const BOM = String.fromCharCode(0xFEFF);

describe('stripBom', () => {
  it('strips UTF-8 BOM', () => {
    expect(stripBom(BOM + '{"a":1}')).toBe('{"a":1}');
  });
  it('passes through non-BOM string', () => {
    expect(stripBom('{"a":1}')).toBe('{"a":1}');
  });
});

describe('readJsonConfigWithBackup', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mcp-json-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns {} when file not found', () => {
    expect(readJsonConfigWithBackup(join(dir, 'no.json'))).toEqual({});
  });
  it('parses valid JSON with BOM', () => {
    const p = join(dir, 'bom.json');
    writeFileSync(p, BOM + '{"mcpServers":{"godot":{}}}');
    expect(readJsonConfigWithBackup(p)).toEqual({ mcpServers: { godot: {} } });
  });
  it('backs up corrupted JSON and returns {}', () => {
    const p = join(dir, 'bad.json');
    const corrupt = '{ broken';
    writeFileSync(p, corrupt);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = readJsonConfigWithBackup(p);
    expect(result).toEqual({});
    const backups = readdirSync(dir).filter(f => f.startsWith('bad.json.corrupt.'));
    expect(backups.length).toBe(1);
    expect(readFileSync(join(dir, backups[0]!), 'utf-8')).toBe(corrupt);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('readJsonForCheck', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mcp-chk-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns null when file not found', () => {
    expect(readJsonForCheck(join(dir, 'no.json'))).toBeNull();
  });
  it('parses valid JSON with BOM', () => {
    const p = join(dir, 'bom.json');
    writeFileSync(p, BOM + '{"mcpServers":{"godot":{}}}');
    expect(readJsonForCheck(p)).toEqual({ mcpServers: { godot: {} } });
  });
  it('returns null for corrupted JSON', () => {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{ broken');
    expect(readJsonForCheck(p)).toBeNull();
  });
});

describe('writeFileAtomicWithMode', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mcp-mode-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('preserves existing file mode across atomic rewrite (Unix 严格, Windows no-op)', () => {
    // F3: 13 adapter 旧实现 writeFileSync(tmp, data, 'utf-8') 第三参是 encoding 非 mode,
    // tmp 默认 0o666 & ~umask,rename 后覆盖原文件 mode(用户 chmod 0o600 的配置被破坏)。
    // writeFileAtomicWithMode 先读原文件 mode,显式传给 writeFileSync 保持。
    const targetPath = join(dir, 'cfg.json');
    writeFileSync(targetPath, '{"old":true}');
    try { chmodSync(targetPath, 0o600); } catch { /* Windows chmod no-op,忽略 */ }
    const beforeMode = statSync(targetPath).mode & 0o777;
    writeFileAtomicWithMode(targetPath, '{"new":true}');
    const afterMode = statSync(targetPath).mode & 0o777;
    if (process.platform !== 'win32') {
      // Unix: 原 0o600 → 新 0o600(修复生效)
      expect(beforeMode).toBe(0o600);
      expect(afterMode).toBe(0o600);
    } else {
      // Windows: stat.mode 无业务意义,helper 应 no-op 不破坏(不抛错 + mode 不变)
      expect(afterMode).toBe(beforeMode);
    }
    // 内容正确写入 + rename 后 tmp 消失(原子写入语义)
    expect(readFileSync(targetPath, 'utf-8')).toBe('{"new":true}');
  });

  it('falls back to default mode when target file does not exist (首次写入)', () => {
    // 首次创建配置:statSync 抛 ENOENT → 跳过 mode → writeFileSync 用默认 mode
    const targetPath = join(dir, 'fresh.json');
    expect(existsSync(targetPath)).toBe(false);
    writeFileAtomicWithMode(targetPath, '{"first":true}');
    expect(readFileSync(targetPath, 'utf-8')).toBe('{"first":true}');
    // 文件创建成功即证明 fallback 路径走通(无异常)
    expect(existsSync(targetPath)).toBe(true);
  });

  it('uses temporary file with rename (原子写入, tmp 不残留)', () => {
    const targetPath = join(dir, 'atomic.json');
    writeFileSync(targetPath, '{}');
    writeFileAtomicWithMode(targetPath, '{"v":2}');
    // rename 后 tmp 应消失,只剩目标文件
    const files = readdirSync(dir);
    expect(files.filter(f => f.endsWith('.tmp'))).toHaveLength(0);
    expect(files).toContain('atomic.json');
    expect(readFileSync(targetPath, 'utf-8')).toBe('{"v":2}');
  });
});
