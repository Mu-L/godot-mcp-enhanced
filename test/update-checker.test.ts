import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { compareVersion, checkForUpdateCached } from '../src/core/update-checker.js';

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
});
