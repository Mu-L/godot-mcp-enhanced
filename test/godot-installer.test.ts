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
