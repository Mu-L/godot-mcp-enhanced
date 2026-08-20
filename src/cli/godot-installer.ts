/**
 * 批 2:Godot 自动安装——官方 GitHub releases 下载器。
 *
 * 安全模型:
 * - 下载域名硬编码白名单(github.com / objects.githubusercontent.com / api.github.com),
 *   任何构造出的 URL 必须过 assertAllowedDownloadUrl(https + 域名在列);
 * - 版本 tag 白名单 /^\d+\.\d+\.\d+-stable$/(防任意 tag 拼接注入 URL);
 * - SHA512 校验与二进制**同 release 同信道**(SHA512-SUMS.txt),信任链 = 域名白名单,
 *   无跨信道信任假设(spec 未决项 1 实测结论:官方不提供独立 SHA256,提供同源 SHA512);
 * - 失败即删(校验不过不留半成品);零新 npm 依赖(fetch/crypto/系统 tar)。
 */
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import { InternalError } from '../core/tool-errors.js';

export const DOWNLOAD_HOSTS = ['github.com', 'objects.githubusercontent.com', 'api.github.com'] as const;

export function assertAllowedDownloadUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InternalError(`download URL not in allowlist (unparseable): ${url}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new InternalError(`download URL not https: ${url}`);
  }
  if (!(DOWNLOAD_HOSTS as readonly string[]).includes(parsed.hostname)) {
    throw new InternalError(`download host not in allowlist: ${parsed.hostname}`);
  }
}

export function assertStableVersionTag(tag: string): void {
  if (!/^\d+\.\d+\.\d+-stable$/.test(tag)) {
    throw new InternalError(`unsupported version tag (stable only): ${tag}`);
  }
}

/**
 * 平台资产名映射,返回带 `{v}` 占位符的模板(如 Godot_v{v}-stable_win64.exe.zip),
 * 由 buildReleaseUrls / installGodot 以具体版本填充——与官方 releases 资产命名一致。
 */
export function platformAssetName(platform: NodeJS.Platform, arch: string): string {
  const suffix =
    platform === 'win32' && arch === 'x64' ? 'win64.exe.zip' :
    platform === 'win32' && arch === 'arm64' ? 'windows_arm64.exe.zip' :
    platform === 'linux' && arch === 'x64' ? 'linux.x86_64.zip' :
    platform === 'linux' && arch === 'arm64' ? 'linux.arm64.zip' :
    platform === 'darwin' ? 'macos.universal.zip' : null;
  if (!suffix) throw new InternalError(`unsupported platform/arch: ${platform}/${arch}`);
  return `Godot_v{v}-stable_${suffix}`;
}

export function buildReleaseUrls(tag: string, assetTemplate: string): { binaryUrl: string; sumsUrl: string } {
  assertStableVersionTag(tag);
  const base = `https://github.com/godotengine/godot/releases/download/${tag}`;
  const binaryUrl = `${base}/${assetTemplate.replace('{v}', tag.replace('-stable', ''))}`;
  const sumsUrl = `${base}/SHA512-SUMS.txt`;
  assertAllowedDownloadUrl(binaryUrl);
  assertAllowedDownloadUrl(sumsUrl);
  return { binaryUrl, sumsUrl };
}

/** 解析官方 SHA512-SUMS.txt(`<sha512hex>␣␣<filename>` 双空格格式),返回小写 hex。 */
export function parseSha512Sums(sumsText: string, filename: string): string {
  for (const line of sumsText.split(/\r?\n/)) {
    const match = line.match(/^([0-9a-fA-F]{128})\s\s+(.+)$/);
    if (match && match[2].trim() === filename) return match[1].toLowerCase();
  }
  throw new InternalError(`entry not found in SHA512-SUMS.txt: ${filename}`);
}

/** 流式 SHA512(大文件不整读内存)。 */
export async function sha512File(filePath: string): Promise<string> {
  const hash = createHash('sha512');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}
