import { describe, it, expect } from 'vitest';
import { normalizeForHash, hashContent } from '../../src/tools/rules-manifest.js';

describe('normalizeForHash', () => {
  it('CRLF 归一化为 LF', () => {
    expect(normalizeForHash('a\r\nb\r\n')).toBe('a\nb\n');
  });

  it('裸 CR 也归一化为 LF', () => {
    expect(normalizeForHash('a\rb\r')).toBe('a\nb\n');
  });

  it('已经是 LF 的不变', () => {
    expect(normalizeForHash('a\nb\n')).toBe('a\nb\n');
  });
});

describe('hashContent', () => {
  it('返回 sha256: 前缀的 hex', () => {
    const h = hashContent('hello');
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('CRLF 与 LF 同内容同 hash（核心不变式）', () => {
    expect(hashContent('a\r\nb')).toBe(hashContent('a\nb'));
  });

  it('不同内容不同 hash', () => {
    expect(hashContent('a')).not.toBe(hashContent('b'));
  });

  it('稳定（同输入同输出）', () => {
    expect(hashContent('stable input')).toBe(hashContent('stable input'));
  });
});

import { buildAdoptManifest, countDeviations } from '../../src/tools/rules-manifest.js';

describe('buildAdoptManifest', () => {
  it('固化当前磁盘状态为基线', () => {
    const m = buildAdoptManifest({
      serverVersion: '0.18.2',
      now: '2026-06-22T10:00:00Z',
      files: [
        { filename: 'godot-mcp.md', content: 'base 内容', source: 'base' },
        { filename: 'godot-mcp-core.md', content: 'core 内容', source: 'detail' },
      ],
    });
    expect(m.manifest_version).toBe(1);
    expect(m.rules_installed_at_version).toBe('0.18.2');
    expect(m.installed_at).toBe('2026-06-22T10:00:00Z');
    expect(m.rules['godot-mcp.md'].hash).toBe(hashContent('base 内容'));
    expect(m.rules['godot-mcp.md'].source).toBe('base');
    expect(m.rules['godot-mcp-core.md'].source).toBe('detail');
  });

  it('偏离模板的文件 hash 记实际内容（非模板内容）', () => {
    const m = buildAdoptManifest({
      serverVersion: '0.18.2',
      now: '2026-06-22T10:00:00Z',
      files: [{ filename: 'godot-mcp.md', content: '用户改过的内容', source: 'base' }],
    });
    expect(m.rules['godot-mcp.md'].hash).toBe(hashContent('用户改过的内容'));
  });
});

describe('countDeviations', () => {
  it('返回磁盘 hash ≠ 当前模板 hash 的文件数', () => {
    const m: import('../../src/tools/rules-manifest.js').RulesManifest = {
      manifest_version: 1,
      rules_installed_at_version: '0.18.2',
      installed_at: '2026-06-22T10:00:00Z',
      rules: {
        'godot-mcp.md': { source: 'base', hash: hashContent('磁盘内容') },
        'godot-mcp-core.md': { source: 'detail', hash: hashContent('模板内容') },
      },
    };
    const deviations = countDeviations(m, {
      'godot-mcp.md': hashContent('模板内容'),       // 磁盘≠模板 → 偏离
      'godot-mcp-core.md': hashContent('模板内容'),   // 磁盘==模板 → 不偏离
    });
    expect(deviations).toBe(1);
  });
});

import { classifyFile } from '../../src/tools/rules-manifest.js';

describe('classifyFile（二维判定 spec §3.3）', () => {
  const sameHash = 'sha256:abc';
  const diffHash = 'sha256:xyz';

  it('过时 + 未动过 → pure-upgrade（update 应覆盖）', () => {
    expect(classifyFile({
      installedVersion: '0.16.0', serverVersion: '0.18.0',
      diskHash: sameHash, manifestHash: sameHash,
    })).toBe('pure-upgrade');
  });

  it('过时 + 动过 → stale-and-modified（update 必须保留并警告，不吞修改）', () => {
    expect(classifyFile({
      installedVersion: '0.16.0', serverVersion: '0.18.0',
      diskHash: diffHash, manifestHash: sameHash,
    })).toBe('stale-and-modified');
  });

  it('版本同 + 未动过 → latest', () => {
    expect(classifyFile({
      installedVersion: '0.18.0', serverVersion: '0.18.0',
      diskHash: sameHash, manifestHash: sameHash,
    })).toBe('latest');
  });

  it('版本同 + 动过 → local-modified', () => {
    expect(classifyFile({
      installedVersion: '0.18.0', serverVersion: '0.18.0',
      diskHash: diffHash, manifestHash: sameHash,
    })).toBe('local-modified');
  });
});
