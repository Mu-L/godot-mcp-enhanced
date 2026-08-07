import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRequire } from 'module';
import { compareVersion, checkForUpdateCached } from '../src/core/update-checker.js';

const require = createRequire(import.meta.url);
// test/ → 上一级包根 → package.json
const pkgVersion: string = require('../package.json').version;

describe('compareVersion', () => {
  it.each([
    ['0.23.0', '0.24.0', -1],
    ['0.24.0', '0.23.0', 1],
    ['0.23.0', '0.23.0', 0],
    ['0.23', '0.23.0', 0],      // 补零
    ['0.23.0', '0.23', 0],
    ['1.2.3', '1.2.4', -1],
  ])('%s vs %s → %d', (a, b, expected) => {
    expect(compareVersion(a, b)).toBe(expected);
  });
});

describe('checkForUpdateCached', () => {
  let cacheDir: string;
  const realFetch = globalThis.fetch;
  beforeEach(() => { cacheDir = mkdtempSync(join(tmpdir(), 'uc-')); });
  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    globalThis.fetch = realFetch;
  });

  it('查网成功返回 latest + 写缓存', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ version: '0.24.0' }),
    }));
    const r = await checkForUpdateCached({ cacheDir });
    expect(r.latest).toBe('0.24.0');
    expect(r.current).toBe(pkgVersion);  // M5: current 正确读 package.json
    expect(r.fromCache).toBe(false);
    expect(r.updateAvailable).toBe(compareVersion(r.latest, r.current) > 0);
    const cached = JSON.parse(readFileSync(join(cacheDir, 'update-cache.json'), 'utf-8'));
    expect(cached.latest).toBe('0.24.0');
    expect(typeof cached.lastCheck).toBe('number');
  });

  it('缓存命中不查网', async () => {
    writeFileSync(join(cacheDir, 'update-cache.json'),
      JSON.stringify({ lastCheck: Date.now(), latest: '0.24.0' }));
    const spy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '9.9.9' }) });
    vi.stubGlobal('fetch', spy);
    const r = await checkForUpdateCached({ cacheDir });
    expect(r.latest).toBe('0.24.0');
    expect(r.fromCache).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('缓存过期(>24h)重新查网', async () => {
    writeFileSync(join(cacheDir, 'update-cache.json'),
      JSON.stringify({ lastCheck: Date.now() - 25 * 3600 * 1000, latest: '0.24.0' }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '0.25.0' }) }));
    const r = await checkForUpdateCached({ cacheDir });
    expect(r.latest).toBe('0.25.0');
    expect(r.fromCache).toBe(false);
  });

  it('force:true 绕缓存', async () => {
    writeFileSync(join(cacheDir, 'update-cache.json'),
      JSON.stringify({ lastCheck: Date.now(), latest: '0.24.0' }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '0.25.0' }) }));
    const r = await checkForUpdateCached({ cacheDir, force: true });
    expect(r.latest).toBe('0.25.0');
    expect(r.fromCache).toBe(false);
  });

  it('网络失败静默返当前版本', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const r = await checkForUpdateCached({ cacheDir });
    expect(r.updateAvailable).toBe(false);
    expect(r.fromCache).toBe(false);
  });

  it('非 200 静默', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const r = await checkForUpdateCached({ cacheDir });
    expect(r.updateAvailable).toBe(false);
  });

  it('缓存损坏当 miss', async () => {
    writeFileSync(join(cacheDir, 'update-cache.json'), 'not json{');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '0.24.0' }) }));
    const r = await checkForUpdateCached({ cacheDir });
    expect(r.latest).toBe('0.24.0');
    expect(r.fromCache).toBe(false);
  });

  // S2 nit#4 守卫：writeCache 的 chmodSync(tmp, 0o600) 收紧缓存文件权限。
  // 对齐 json-config.test.ts / claude-code.test.ts 的 0o600 硬断言模式（update-checker 是唯一缺守护的 chmod 落地点）。
  // Windows chmod 是 noop（mode 不变），故 mode 断言仅 POSIX 生效；调用发生用文件存在间接验证（writeCache 成功即 chmod 已执行）。
  it('writeCache 收紧缓存权限到 0o600（nit#4 守卫）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ version: '0.24.0' }),
    }));
    await checkForUpdateCached({ cacheDir });
    const cachePath = join(cacheDir, 'update-cache.json');
    expect(existsSync(cachePath), '缓存文件已写入（chmodSync 在 writeFileSync 后执行）').toBe(true);
    // POSIX: stat mode 低 9 位应为 0o600（owner rw）；Windows: chmod noop，跳过 mode 断言
    if (process.platform !== 'win32') {
      const mode = statSync(cachePath).mode & 0o777;
      expect(mode, `cache mode 应为 0o600，实际 0o${mode.toString(8)}`).toBe(0o600);
    }
  });
});

// 2026-08-07 审查 I-2: update-checker 门控语义测试（原 8 个 case 无门控守护）
// 守护 /^(false|0|no|off)$/i 正则：若改回 === 'false' 或漏 i flag，下列 case 应变红
describe('GODOT_MCP_UPDATE_CHECK 门控语义（2026-08-07 I-2）', () => {
  let cacheDir: string;
  const realFetch = globalThis.fetch;
  beforeEach(() => { cacheDir = mkdtempSync(join(tmpdir(), 'uc-gate-')); });
  afterEach(() => {
    delete process.env.GODOT_MCP_UPDATE_CHECK;
    rmSync(cacheDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    globalThis.fetch = realFetch;
  });

  it.each(['false', '0', 'no', 'off', 'False', 'FALSE', 'Off', 'NO'])('="%s" 关闭启动外传（force:false，不查网）', async (val) => {
    process.env.GODOT_MCP_UPDATE_CHECK = val;
    // fetch 若被调用说明门控失效；mock 成 rejects 让测试明确失败
    const fetchMock = vi.fn().mockRejectedValue(new Error('should not fetch when gated'));
    vi.stubGlobal('fetch', fetchMock);
    const r = await checkForUpdateCached({ cacheDir });  // force 默认 undefined → !opts?.force === true
    expect(r.updateAvailable, `GODOT_MCP_UPDATE_CHECK="${val}" 应关闭外传`).toBe(false);
    expect(r.latest, `门控关闭时 latest 应为当前版本 ${pkgVersion}`).toBe(pkgVersion);
    expect(fetchMock, '门控关闭时不应查网').not.toHaveBeenCalled();
  });

  it('force:true 绕门控（self_update 主动查询）', async () => {
    process.env.GODOT_MCP_UPDATE_CHECK = 'false';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ version: '9.9.9' }),
    }));
    const r = await checkForUpdateCached({ cacheDir, force: true });
    expect(r.latest, 'force:true 应绕门控查网').toBe('9.9.9');
    expect(r.updateAvailable).toBe(true);
  });

  it.each(['true', '1', 'yes', 'on', '', 'random'])('="%s" 非关闭值，正常查网', async (val) => {
    if (val === '') delete process.env.GODOT_MCP_UPDATE_CHECK;
    else process.env.GODOT_MCP_UPDATE_CHECK = val;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ version: '9.9.9' }),
    }));
    const r = await checkForUpdateCached({ cacheDir });
    expect(r.latest, `非关闭值 "${val}" 应正常查网`).toBe('9.9.9');
  });
});
