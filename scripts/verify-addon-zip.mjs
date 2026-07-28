#!/usr/bin/env node
// scripts/verify-addon-zip.mjs
//
// 校验 godot-mcp-enhanced addon zip 的结构完整性（release.yml 用）。
// 输入：stdin 每行一个 zip entry（来自 `unzip -Z1 <zip>`）。
// 退出码：0 通过 / 1 失败（stderr 打印所有错误）。
//
// 校验（仿 godot-ai release.yml:118-162，addon 名 godot_mcp_server）：
//  1. 顶层条目恰好 {addons, godot-mcp-enhanced-LICENSE.txt}（多顶层绕 AssetLib "Ignore root"）
//  2. 含 addons/godot_mcp_server/plugin.cfg
//  3. 含 godot-mcp-enhanced-LICENSE.txt（zip 根）
//  4. 无裸 LICENSE（#450：避免覆盖用户项目 LICENSE）
//  5. 无目录条目（路径以 / 结尾 = 忘 zip -D，self-update zip-slip 守卫会拒）
//  6. 无 macOS iCloud 副本（' 2.' 模式）

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const EXPECTED_TOPS = ['addons', 'godot-mcp-enhanced-LICENSE.txt'];

/**
 * 校验 zip entry 列表。
 * @param {string[]} entries - zip 内所有 entry 路径（来自 unzip -Z1）
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verifyEntries(entries) {
  const errors = [];

  // 1. 顶层条目集合（排序后比对）
  const tops = [...new Set(entries.map(e => e.split('/')[0]))].sort();
  const expectedSorted = [...EXPECTED_TOPS].sort();
  if (tops.join(',') !== expectedSorted.join(',')) {
    errors.push(`顶层条目期望 [${expectedSorted.join(', ')}]，实际 [${tops.join(', ')}]（多顶层绕 AssetLib "Ignore root"）`);
  }

  // 2. plugin.cfg 在期望路径
  if (!entries.includes('addons/godot_mcp_server/plugin.cfg')) {
    errors.push('缺 addons/godot_mcp_server/plugin.cfg（addon 入口）');
  }

  // 3. LICENSE.txt 在 zip 根
  if (!entries.includes('godot-mcp-enhanced-LICENSE.txt')) {
    errors.push('缺 godot-mcp-enhanced-LICENSE.txt（zip 根）');
  }

  // 4. 禁裸 LICENSE（#450）
  if (entries.includes('LICENSE')) {
    errors.push('含裸 LICENSE（会覆盖用户项目 LICENSE，见 godot-ai #450）');
  }

  // 5. 禁目录条目（忘 zip -D）
  const dirEntries = entries.filter(e => e.endsWith('/'));
  if (dirEntries.length > 0) {
    errors.push(`含目录条目（忘 zip -D？self-update zip-slip 守卫会拒）: ${dirEntries.slice(0, 5).join(', ')}${dirEntries.length > 5 ? ' ...' : ''}`);
  }

  // 6. 禁 iCloud 副本
  const iCloud = entries.filter(e => / 2\./.test(e));
  if (iCloud.length > 0) {
    errors.push(`含 iCloud 副本（' 2.' 模式，checkout 污染）: ${iCloud.slice(0, 5).join(', ')}`);
  }

  return { ok: errors.length === 0, errors };
}

// CLI 入口（被 import 时不执行）
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = readFileSync(0, 'utf-8');  // stdin
  const entries = input.split('\n').map(s => s.trim()).filter(Boolean);
  const { ok, errors } = verifyEntries(entries);
  if (ok) {
    console.log(`zip 结构校验通过（${entries.length} entries，顶层 [${EXPECTED_TOPS.join(', ')}]）`);
    process.exit(0);
  } else {
    console.error(`zip 结构校验失败（${errors.length} 项）:`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
}
