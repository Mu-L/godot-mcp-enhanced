import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('telemetry/sanitize', () => {
  beforeEach(() => { vi.resetModules(); });

  it('hashProject 稳定 + 8 hex（同 UUID+path 同结果）', async () => {
    vi.doMock('os', async (a) => ({ ...(await a()), homedir: () => '/fake' }));
    vi.doMock('../../src/telemetry/config.js', () => ({ getInstallUUID: () => 'salt-123' }));
    const { hashProject } = await import('../../src/telemetry/sanitize.js');
    const h = hashProject('D:/my-game');
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(hashProject('D:/my-game')).toBe(h);
  });

  it('hashProject 加盐防字典反推（不同 UUID 不同 hash）', async () => {
    let uuid = 'salt-A';
    vi.doMock('../../src/telemetry/config.js', () => ({ getInstallUUID: () => uuid }));
    const { hashProject } = await import('../../src/telemetry/sanitize.js');
    const a = hashProject('/same/path');
    uuid = 'salt-B';
    const b = hashProject('/same/path');
    expect(a).not.toBe(b);
  });

  it('safeErrorCategory 取 Error.name 非原始 message', async () => {
    vi.doMock('../../src/telemetry/config.js', () => ({ getInstallUUID: () => 's' }));
    const { safeErrorCategory } = await import('../../src/telemetry/sanitize.js');
    const err = new Error("ENOENT: /secret/path/leak");
    expect(safeErrorCategory(err)).toBe('Error');  // 只 name，不含路径
  });

  it('safeErrorCategory 脱敏非白名单字符（/ 不在字母表）', async () => {
    vi.doMock('../../src/telemetry/config.js', () => ({ getInstallUUID: () => 's' }));
    const { safeErrorCategory } = await import('../../src/telemetry/sanitize.js');
    expect(safeErrorCategory('a/b\\c d')).toBe('a_b_c_d');  // / \ 空格 → _
  });

  it('safeErrorCategory 截断 64', async () => {
    vi.doMock('../../src/telemetry/config.js', () => ({ getInstallUUID: () => 's' }));
    const { safeErrorCategory } = await import('../../src/telemetry/sanitize.js');
    expect(safeErrorCategory('X'.repeat(100)).length).toBe(64);
  });

  it('sanitizeVersion 白名单通过合法，拒含路径/特殊', async () => {
    vi.doMock('../../src/telemetry/config.js', () => ({ getInstallUUID: () => 's' }));
    const { sanitizeVersion } = await import('../../src/telemetry/sanitize.js');
    expect(sanitizeVersion('0.25.0')).toBe('0.25.0');
    expect(sanitizeVersion('4.6.3-stable')).toBe('4.6.3-stable');
    expect(sanitizeVersion('../etc/passwd')).toBe('unknown');
    expect(sanitizeVersion('')).toBe('unknown');
  });
});
