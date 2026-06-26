#!/usr/bin/env node
// scripts/check-rules-version-bump.mjs
// spec §4 不变式守护：规则模板源文件内容变更必须伴随 package.json version bump。
//
// baseline 取自 git 上个 commit（git show HEAD:<file>），**非工作区文件**——
// 这样开发者无法通过同时修改清单/缓存文件来规避检查。
// 比对的是插值前的源文件整体 hash（非提取出的模板部分）。
//
// 用法（CI 或 pre-commit）：node scripts/check-rules-version-bump.mjs
// 退出码：0=通过 / 1=模板变了但版本没 bump

import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';

const TEMPLATE_FILES = [
  'src/tools/rule-templates.ts',
  'src/tools/claudemd-builder.ts',
];

function git(args) {
  return execSync(`git ${args}`, { encoding: 'utf-8' });
}

// 判断一个路径是否存在于 git HEAD
// 注意：Windows git bash 下 `2>/dev/null` 与 `stdio:'ignore'` 组合会让 execSync
// 误判返回非零状态，故仅用 stdio:'ignore'。
function existsInHead(f) {
  try {
    execSync(`git cat-file -e HEAD:${f}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function hash(s) {
  return createHash('sha256').update(s, 'utf-8').digest('hex').slice(0, 16);
}

// 1. 比对模板源文件 hash（HEAD vs 工作区文件）
//    工作区文件直接 readFileSync（不走 git，不受 line-ending normalization 影响——
//    git autocrlf=true 会让 git show 出来的内容和工作区文件在 Windows 上 hash 不同）
let templateChanged = false;
const changedFiles = [];
for (const f of TEMPLATE_FILES) {
  let headContent;
  if (!existsInHead(f)) {
    // 文件在 HEAD 不存在（新增）——视为变更
    console.error(`模板源文件为新增文件（HEAD 中不存在）: ${f}`);
    templateChanged = true;
    changedFiles.push(f);
    continue;
  }
  headContent = git(`show HEAD:${f}`);
  let curContent;
  try {
    curContent = readFileSync(f, 'utf-8');
  } catch {
    // 工作区文件读不到（已删除等）——视为变更
    console.error(`模板源文件在工作区不可读: ${f}`);
    templateChanged = true;
    changedFiles.push(f);
    continue;
  }
  if (hash(headContent) !== hash(curContent)) {
    templateChanged = true;
    changedFiles.push(f);
    console.error(`模板源文件已变更: ${f}`);
  }
}

if (!templateChanged) {
  console.log('✓ 规则模板未变更，跳过版本 bump 检查');
  process.exit(0);
}

// 2. 模板变了 → 检查 package.json version 是否也变
let versionBumped = false;
try {
  const diff = git('diff HEAD -- package.json');
  versionBumped = /^\+\s*"version"\s*:/m.test(diff);
} catch {
  versionBumped = false;
}

if (versionBumped) {
  console.log('✓ 规则模板变更已伴随 package.json version bump');
  process.exit(0);
}

console.error('✗ 规则模板内容已变更，但 package.json version 未 bump。');
console.error('  变更的文件：' + changedFiles.join(', '));
console.error('  这会导致用户 reconcile 时静默漏更新（spec §4 不变式）。');
console.error('  请 bump package.json version 后再提交规则模板改动：');
console.error('    npm version patch --no-git-tag-version');
process.exit(1);
