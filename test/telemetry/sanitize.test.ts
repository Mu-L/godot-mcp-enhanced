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

  it('sanitizeVersion 白名单通过合法，拒含路径/特殊', async () => {
    vi.doMock('../../src/telemetry/config.js', () => ({ getInstallUUID: () => 's' }));
    const { sanitizeVersion } = await import('../../src/telemetry/sanitize.js');
    expect(sanitizeVersion('0.25.0')).toBe('0.25.0');
    expect(sanitizeVersion('4.6.3-stable')).toBe('4.6.3-stable');
    expect(sanitizeVersion('../etc/passwd')).toBe('unknown');
    expect(sanitizeVersion('')).toBe('unknown');
  });
});
