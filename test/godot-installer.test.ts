import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';

// ─── 批 2:Godot 自动安装下载器(src/cli/godot-installer.ts)──────────────────
// 纯函数层不联网;下载/编排层用 mock fetch / 临时目录。

const m = await import('../src/cli/godot-installer.js');

describe('assertAllowedDownloadUrl(下载域名硬编码白名单)', () => {
  it('github release / asset CDN / api 域放行', () => {
    expect(() => m.assertAllowedDownloadUrl('https://github.com/godotengine/godot/releases/download/4.7.2-stable/a.zip')).not.toThrow();
    expect(() => m.assertAllowedDownloadUrl('https://objects.githubusercontent.com/some/path')).not.toThrow();
    expect(() => m.assertAllowedDownloadUrl('https://api.github.com/repos/godotengine/godot/releases/latest')).not.toThrow();
  });

  it('非白名单域名拒绝', () => {
    expect(() => m.assertAllowedDownloadUrl('https://evil.com/godot.zip')).toThrow(/allowlist/);
    expect(() => m.assertAllowedDownloadUrl('https://github.com.evil.com/a')).toThrow(/allowlist/);
  });

  it('http(非 https)拒绝', () => {
    expect(() => m.assertAllowedDownloadUrl('http://github.com/a')).toThrow();
  });

  it('file:// 等怪协议拒绝', () => {
    expect(() => m.assertAllowedDownloadUrl('file:///etc/passwd')).toThrow();
  });

  it('不可解析 URL 拒绝', () => {
    expect(() => m.assertAllowedDownloadUrl('not a url')).toThrow();
  });
});

describe('assertStableVersionTag(版本 tag 白名单)', () => {
  it('stable tag 放行', () => {
    expect(() => m.assertStableVersionTag('4.7.2-stable')).not.toThrow();
    expect(() => m.assertStableVersionTag('4.5.0-stable')).not.toThrow();
  });

  it('非 stable / 注入形态拒绝', () => {
    expect(() => m.assertStableVersionTag('4.8-dev')).toThrow();
    expect(() => m.assertStableVersionTag('../../evil')).toThrow();
    expect(() => m.assertStableVersionTag('4.7.2-stable/extra')).toThrow();
    expect(() => m.assertStableVersionTag('')).toThrow();
  });
});

describe('platformAssetName(平台资产映射,{v} 占位符契约)', () => {
  it('五组合映射正确', () => {
    expect(m.platformAssetName('win32', 'x64')).toBe('Godot_v{v}-stable_win64.exe.zip');
    expect(m.platformAssetName('win32', 'arm64')).toBe('Godot_v{v}-stable_windows_arm64.exe.zip');
    expect(m.platformAssetName('linux', 'x64')).toBe('Godot_v{v}-stable_linux.x86_64.zip');
    expect(m.platformAssetName('linux', 'arm64')).toBe('Godot_v{v}-stable_linux.arm64.zip');
    expect(m.platformAssetName('darwin', 'arm64')).toBe('Godot_v{v}-stable_macos.universal.zip');
  });

  it('不支持的组合抛错', () => {
    expect(() => m.platformAssetName('freebsd', 'x64')).toThrow();
    expect(() => m.platformAssetName('win32', 'mips')).toThrow();
  });
});

describe('buildReleaseUrls(构造并自校验)', () => {
  it('binary + sums 两个 URL 正确', () => {
    const urls = m.buildReleaseUrls('4.7.2-stable', 'Godot_v{v}-stable_win64.exe.zip');
    expect(urls.binaryUrl).toBe('https://github.com/godotengine/godot/releases/download/4.7.2-stable/Godot_v4.7.2-stable_win64.exe.zip');
    expect(urls.sumsUrl).toBe('https://github.com/godotengine/godot/releases/download/4.7.2-stable/SHA512-SUMS.txt');
  });

  it('非法 tag 在构造期即抛(不产出 URL)', () => {
    expect(() => m.buildReleaseUrls('evil-tag', 'Godot_v{v}-stable_win64.exe.zip')).toThrow();
  });
});

describe('parseSha512Sums(官方双空格格式)', () => {
  const SUMS = 'aa'.repeat(64) + '  Godot_v4.7.2-stable_win64.exe.zip\n' +
               'bb'.repeat(64) + '  other.zip\n' +
               'cc'.repeat(64) + '  Godot_v4.7.2-stable_export_templates.tpz\n';

  it('匹配文件名返回小写 hex', () => {
    expect(m.parseSha512Sums(SUMS, 'Godot_v4.7.2-stable_win64.exe.zip')).toBe('aa'.repeat(64));
  });

  it('大写哈希归一小写', () => {
    const upper = 'AA'.repeat(64) + '  x.zip';
    expect(m.parseSha512Sums(upper, 'x.zip')).toBe('aa'.repeat(64));
  });

  it('条目缺失抛错', () => {
    expect(() => m.parseSha512Sums('aa  other.zip', 'missing.zip')).toThrow(/not found/);
  });

  it('CRLF 换行容错', () => {
    const crlf = 'aa'.repeat(64) + '  x.zip\r\n';
    expect(m.parseSha512Sums(crlf, 'x.zip')).toBe('aa'.repeat(64));
  });
});

describe('sha512File(流式哈希)', () => {
  it('与 crypto 一次性计算一致', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gme-hash-'));
    const f = join(dir, 'x.bin');
    const payload = Buffer.alloc(1024 * 64, 7);  // 64KB,跨多个 16KB 流块
    writeFileSync(f, payload);
    const expected = createHash('sha512').update(payload).digest('hex');
    expect(await m.sha512File(f)).toBe(expected);
    rmSync(dir, { recursive: true, force: true });
  });
});

// ─── Task 4:下载执行 + 编排 ───────────────────────────────────────────────────

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';

describe('verifyDownloadedAsset(SHA512 失败即删)', () => {
  it('哈希不匹配 → 删文件并抛错', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gme-verify-'));
    const f = join(dir, 'Godot_v4.7.2-stable_win64.exe.zip');
    writeFileSync(f, Buffer.from('tampered'));
    await expect(m.verifyDownloadedAsset(f, '0'.repeat(128))).rejects.toThrow(/sha512 mismatch/i);
    expect(existsSync(f)).toBe(false);  // 失败即删
    rmSync(dir, { recursive: true, force: true });
  });

  it('哈希匹配 → 通过且不删', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gme-verify2-'));
    const f = join(dir, 'a.zip');
    const payload = Buffer.from('good');
    writeFileSync(f, payload);
    const good = createHash('sha512').update(payload).digest('hex');
    await expect(m.verifyDownloadedAsset(f, good)).resolves.toBeUndefined();
    expect(existsSync(f)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('downloadWithProgress', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  it('evil 域名在下载期即被 allowlist 拒绝(不发起请求)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(m.downloadWithProgress('https://evil.com/a.zip', join(tmpdir(), 'x.zip')))
      .rejects.toThrow(/allowlist/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('mock fetch 流式落盘内容一致', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gme-dl-'));
    const dest = join(dir, 'a.zip');
    const payload = Buffer.from('abc123godot');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(payload)));
    let lastBytes = -1;
    await m.downloadWithProgress(
      'https://github.com/godotengine/godot/releases/download/4.7.2-stable/a.zip',
      dest,
      (bytes) => { lastBytes = bytes; },
    );
    expect(readFileSync(dest).toString()).toBe('abc123godot');
    expect(lastBytes).toBe(payload.length);  // 进度回调收到累计字节
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it('HTTP 非 2xx 抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    await expect(m.downloadWithProgress(
      'https://github.com/godotengine/godot/releases/download/4.7.2-stable/a.zip',
      join(tmpdir(), 'gme-dl-404', 'a.zip'),
    )).rejects.toThrow(/404/);
    vi.unstubAllGlobals();
  });
});

describe('fetchLatestStableTag(GODOT_MCP_INSTALL_TAG pin)', () => {
  beforeEach(() => { vi.unstubAllEnvs(); });
  afterAll(() => { vi.unstubAllEnvs(); });

  it('pin env 直接返回(不联网),非法 pin 拒绝', async () => {
    vi.stubEnv('GODOT_MCP_INSTALL_TAG', '4.7.2-stable');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await m.fetchLatestStableTag()).toBe('4.7.2-stable');
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('非法 pin tag 在本地即抛', async () => {
    vi.stubEnv('GODOT_MCP_INSTALL_TAG', 'evil');
    await expect(m.fetchLatestStableTag()).rejects.toThrow(/stable only/);
  });
});

describe('appendMachineAuditLine(机器级审计)', () => {
  it('落 ~/.godot-mcp/machine-audit.jsonl 且 JSON 行合法(带 timestamp)', async () => {
    const { appendMachineAuditLine, getMachineAuditFile } = await import('../src/core/audit-log.js');
    await appendMachineAuditLine({
      trace_id: `t-test-${Date.now()}`, tool: 'cli', action: 'install_godot_test', risk: 'process',
      ok: true, project_path: '', changed_files: [], duration_ms: 5,
      details: { versionTag: '4.7.2-stable' },
    });
    expect(existsSync(getMachineAuditFile())).toBe(true);
    expect(getMachineAuditFile()).toBe(join(homedir(), '.godot-mcp', 'machine-audit.jsonl'));
    const lines = readFileSync(getMachineAuditFile(), 'utf-8').trim().split('\n');
    const last = JSON.parse(lines[lines.length - 1]!);
    expect(last.action).toBe('install_godot_test');
    expect(typeof last.timestamp).toBe('string');
    expect(last.ok).toBe(true);
  });
});
