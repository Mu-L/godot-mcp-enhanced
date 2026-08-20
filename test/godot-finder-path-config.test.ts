import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ─── 批 2 B-3:~/.godot-mcp/godot-paths.json 读写 + isGodotPathAllowed 优先级链 ───
// 注意:test/setup.js 全局设 GODOT_MCP_UNRESTRICTED=true,须显式清才能测白名单逻辑
// (与 test/godot-finder.test.js:421 段同款前提)。本文件不 mock fs(真读写临时目录),
// 通过重定向 HOME/USERPROFILE 隔离真实 ~/.godot-mcp。

const FAKE_HOME = mkdtempSync(join(tmpdir(), 'gme-pathcfg-'));

beforeAll(() => {
  vi.stubEnv('HOME', FAKE_HOME);
  vi.stubEnv('USERPROFILE', FAKE_HOME);
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(FAKE_HOME, { recursive: true, force: true });
});

const {
  readGodotPathsConfig,
  writeGodotPathsConfig,
  getGodotPathsConfigFile,
  isGodotPathAllowed,
  findGodot,
} = await import('../src/core/godot-finder.js');

beforeEach(() => {
  vi.stubEnv('GODOT_MCP_ALLOWED_GODOT_PATHS', '');
  vi.stubEnv('GODOT_MCP_UNRESTRICTED', '');
});

describe('godot-paths.json 读写', () => {
  beforeEach(() => {
    // 每个「读写」用例从干净状态开始(前面 describe 可能写过)
    rmSync(join(FAKE_HOME, '.godot-mcp', 'godot-paths.json'), { force: true });
  });

  it('文件不存在时容错读 []', () => {
    expect(readGodotPathsConfig()).toEqual([]);
  });

  it('write 后读回,去重保序', () => {
    writeGodotPathsConfig(['C:/g/A.exe', 'C:/g/A.exe', 'C:/g/B.exe']);
    expect(readGodotPathsConfig()).toEqual(['C:/g/A.exe', 'C:/g/B.exe']);
  });

  it('JSON 损坏容错读 []', () => {
    mkdirSync(join(FAKE_HOME, '.godot-mcp'), { recursive: true });
    writeFileSync(getGodotPathsConfigFile(), '{broken');
    expect(readGodotPathsConfig()).toEqual([]);
  });

  it('paths 非字符串数组(字段非法)容错剔除非字符串', () => {
    mkdirSync(join(FAKE_HOME, '.godot-mcp'), { recursive: true });
    writeFileSync(getGodotPathsConfigFile(), JSON.stringify({ version: 1, paths: [42, null, 'ok'] }));
    expect(readGodotPathsConfig()).toEqual(['ok']);
  });

  it('配置文件路径在 ~/.godot-mcp/ 下(机器级惯例)', () => {
    expect(getGodotPathsConfigFile()).toBe(join(FAKE_HOME, '.godot-mcp', 'godot-paths.json'));
  });
});

describe('isGodotPathAllowed 优先级链(env → config → back-compat 放行)', () => {
  const BIN = join(FAKE_HOME, 'g', 'Godot_v4.7.2-stable_win64.exe');

  beforeEach(() => {
    writeGodotPathsConfig([BIN]);
  });

  it('env 未设 + config 有该路径 → 放行(config 即白名单)', () => {
    expect(isGodotPathAllowed(BIN)).toBe(true);
  });

  it('env 未设 + 路径不在 config → 拒绝(白名单语义来自 config)', () => {
    expect(isGodotPathAllowed('C:/evil/fake.exe')).toBe(false);
  });

  it('env 设了 → env 优先,config 被忽略(env 显式用户意图)', () => {
    vi.stubEnv('GODOT_MCP_ALLOWED_GODOT_PATHS', 'C:/only/this.exe');
    expect(isGodotPathAllowed('C:/only/this.exe')).toBe(true);
    expect(isGodotPathAllowed(BIN)).toBe(false); // env 显式时 config 不参与
  });

  it('env 与 config 皆无 → back-compat 放行(签名校验仍兜底)', () => {
    writeGodotPathsConfig([]);
    expect(isGodotPathAllowed('C:/anywhere/Godot.exe')).toBe(true);
  });

  it('UNRESTRICTED=true 旁路优先级最高(既有行为不变)', () => {
    vi.stubEnv('GODOT_MCP_UNRESTRICTED', 'true');
    expect(isGodotPathAllowed('C:/anything/any.exe')).toBe(true);
  });
});

describe('findGodot 搜索链接入 config 候选', () => {
  it('config 中不存在/无效的路径被跳过,不抛出(容错护栏)', async () => {
    writeGodotPathsConfig([join(FAKE_HOME, 'nonexistent', 'Godot_v4.7.2.exe')]);
    // 本机可能找到(PATH/平台搜索)或找不到(InternalError)——两种结局都可接受,
    // 唯一断言:不因 config 中的死路径崩溃。
    try {
      const found = await findGodot();
      expect(typeof found).toBe('string');
    } catch (err) {
      expect((err as Error).message).toMatch(/not found|Godot/i);
    }
  });
});
