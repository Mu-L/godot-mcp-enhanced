import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ZCodeAdapter', () => {
  let fakeHome: string;

  beforeEach(() => {
    vi.resetModules();
    fakeHome = mkdtempSync(join(tmpdir(), 'mcp-zcode-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(fakeHome, { recursive: true, force: true });
  });

  // mock os.homedir → fakeHome（ZCode 配置在 ~/.zcode，定位靠 homedir 非 globalConfigRoot）
  async function importAdapter() {
    vi.doMock('os', async (importActual) => {
      const actual = await importActual<typeof import('os')>();
      return { ...actual, homedir: () => fakeHome };
    });
    return (await import('../../../src/cli/clients/zcode.js')).ZCodeAdapter;
  }

  it('has global scope', async () => {
    const ZCodeAdapter = await importAdapter();
    expect(new ZCodeAdapter().scope).toBe('global');
  });

  it('detect returns true when ~/.zcode exists', async () => {
    const ZCodeAdapter = await importAdapter();
    const adapter = new ZCodeAdapter();
    expect(await adapter.detect()).toBe(false); // fakeHome 下尚无 .zcode
    mkdirSync(join(fakeHome, '.zcode'), { recursive: true });
    expect(await adapter.detect()).toBe(true);
  });

  it('configure writes mcp.servers.godot + type:stdio (嵌套键 + schema 强制 type)', async () => {
    const ZCodeAdapter = await importAdapter();
    await new ZCodeAdapter().configure('/ignored', '/godot', 'npx', ['-y', 'godot-mcp-enhanced']);
    const config = JSON.parse(
      readFileSync(join(fakeHome, '.zcode', 'cli', 'config.json'), 'utf-8'),
    );
    expect(config.mcp.servers.godot.type).toBe('stdio'); // schema 强制
    expect(config.mcp.servers.godot.command).toBe('npx');
    expect(config.mcp.servers.godot.args).toEqual(['-y', 'godot-mcp-enhanced']);
    expect(config.mcp.servers.godot.env.GODOT_PATH).toBe('/godot');
  });

  it('configure preserves enable user-state on reconfigure', async () => {
    const filePath = join(fakeHome, '.zcode', 'cli', 'config.json');
    mkdirSync(join(filePath, '..'), { recursive: true });
    writeFileSync(filePath, JSON.stringify({
      mcp: { servers: { godot: { type: 'stdio', command: 'old', enable: false } } },
    }));
    const ZCodeAdapter = await importAdapter();
    await new ZCodeAdapter().configure('/ignored', '/godot', 'npx', ['-y', 'godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(config.mcp.servers.godot.enable).toBe(false); // 用户禁用状态保留
    expect(config.mcp.servers.godot.command).toBe('npx'); // 同时 command 被更新
    expect(config.mcp.servers.godot.type).toBe('stdio');
  });

  it('configure preserves sibling servers + top-level plugins/hooks keys', async () => {
    const filePath = join(fakeHome, '.zcode', 'cli', 'config.json');
    mkdirSync(join(filePath, '..'), { recursive: true });
    writeFileSync(filePath, JSON.stringify({
      mcp: { servers: { memory: { type: 'stdio', command: 'npx' } } },
      plugins: { enabledPlugins: { foo: true } },
      hooks: { enabled: true },
    }));
    const ZCodeAdapter = await importAdapter();
    await new ZCodeAdapter().configure('/ignored', '/godot', 'npx', []);
    const config = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(config.mcp.servers.memory.command).toBe('npx'); // 其他 server 保留
    expect(config.mcp.servers.godot.type).toBe('stdio'); // godot 写入
    expect(config.plugins.enabledPlugins.foo).toBe(true); // 顶层 plugins 保留
    expect(config.hooks.enabled).toBe(true); // 顶层 hooks 保留
  });

  it('isConfigured returns true after configure, false before', async () => {
    const ZCodeAdapter = await importAdapter();
    const adapter = new ZCodeAdapter();
    expect(await adapter.isConfigured('/ignored')).toBe(false); // 文件不存在
    await adapter.configure('/ignored', '/godot', 'npx', []);
    expect(await adapter.isConfigured('/ignored')).toBe(true);
  });
});
