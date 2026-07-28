import { describe, it, expect } from 'vitest';
import { verifyEntries } from '../../scripts/verify-addon-zip.mjs';

// 合法 zip 的代表性 entry 子集（含两个顶层 + plugin.cfg + 若干 .gd）
// 注：合法 zip 用 zip -D 后无目录条目（不以 / 结尾）
const VALID_ENTRIES = [
  'addons/godot_mcp_server/plugin.cfg',
  'addons/godot_mcp_server/plugin.gd',
  'addons/godot_mcp_server/websocket_server.gd',
  'godot-mcp-enhanced-LICENSE.txt',
];

describe('verifyEntries (addon zip 结构校验)', () => {
  it('合法多顶层 zip 通过', () => {
    const r = verifyEntries(VALID_ENTRIES);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('缺 godot-mcp-enhanced-LICENSE.txt → fail', () => {
    const r = verifyEntries(VALID_ENTRIES.filter(e => e !== 'godot-mcp-enhanced-LICENSE.txt'));
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/缺 godot-mcp-enhanced-LICENSE\.txt/);
  });

  it('含裸 LICENSE（#450 覆盖用户项目 LICENSE）→ fail', () => {
    const r = verifyEntries([...VALID_ENTRIES, 'LICENSE']);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/裸 LICENSE/);
  });

  it('含目录条目（忘 zip -D）→ fail', () => {
    // VALID_ENTRIES 已含 'addons/' 等目录条目（zip 未加 -D 时会留）
    // 注：合法 zip 用 -D 后无目录条目；这里构造一个含目录条目的非法 case
    const entriesWithDir = [
      'addons/godot_mcp_server/plugin.cfg',
      'addons/godot_mcp_server/',  // 目录条目
      'godot-mcp-enhanced-LICENSE.txt',
    ];
    const r = verifyEntries(entriesWithDir);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/目录条/);
  });

  it('单顶层（只有 addons，无 LICENSE.txt）→ fail（多顶层 trick 破坏）', () => {
    const r = verifyEntries([
      'addons/godot_mcp_server/plugin.cfg',
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/顶层/);
  });

  it('含 iCloud 副本（" 2." 模式）→ fail', () => {
    const r = verifyEntries([...VALID_ENTRIES, 'addons/godot_mcp_server/plugin 2.cfg']);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/iCloud|2\./);
  });

  it('缺 plugin.cfg → fail', () => {
    const r = verifyEntries([
      'addons/godot_mcp_server/foo.gd',
      'godot-mcp-enhanced-LICENSE.txt',
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/plugin\.cfg/);
  });
});
