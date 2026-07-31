# 签名 PR-1: Release Workflow + SHA256 Sidecar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 `.github/workflows/release.yml`——tag `v*` 触发，构建 addon zip（多顶层结构）+ 结构校验 + SHA256 sidecar + GitHub Release（softprops），建立 enhanced 从未有的 release pipeline 地基。**不做** npm publish（拆 PR-2）、**不做** RSA 签名（拆 PR-3，self-updater 未就绪前 yagni）。

**Architecture:** 借鉴 `D:\GitHub\godot-ai\.github\workflows\release.yml`（job: verify-tag → build-zip → verify-structure → sha256 → softprops），去 pypi/sign/discord。zip 结构校验抽成可单测的 Node 脚本 `scripts/verify-addon-zip.mjs`（纯函数 `verifyEntries(entries[])`，workflow 用 `unzip -Z1 | node` 喂入），跨平台 + TDD 友好，而非 godot-ai 的 inline shell。

**Tech Stack:** GitHub Actions（softprops/action-gh-release@v2）、Node ESM `.mjs`、vitest、bash（zip/unzip/sha256sum，ubuntu-latest 自带）。

## Global Constraints

- **方案 C（已定）**：PR-1 只做 zip + SHA256 + GitHub Release；npm publish（PR-2）与 RSA 签名（PR-3）不在本 plan。
- **多顶层 zip trick**（采纳 godot-ai，因 enhanced 走 AssetLib + GitHub Release 两发布面，MEMORY `godot-asset-library`）：zip 顶层 = `{addons/, godot-mcp-enhanced-LICENSE.txt}`——双顶层让 Godot AssetLib 不弹"Ignore asset root"（单顶层会剥掉 addons/ 致 plugin 落错位置）。
- **LICENSE 命名空间化**：根 LICENSE 拷成 `godot-mcp-enhanced-LICENSE.txt`（非裸 LICENSE）——裸 LICENSE 会覆盖用户项目 LICENSE（godot-ai #450）。
- **三 version 对齐**：tag（去 v）== `package.json:version` == `addons/godot_mcp_server/plugin.cfg:version`（当前均 0.25.0），release 时硬校验。
- **zip -D**：剥零字节目录条目（self-update runner 的 zip-slip 守卫会拒路径以 `/` 结尾的条目）。
- **commit 规范**：中文 + conventional prefix + `Co-Authored-By: Claude`；本地 master，不 push origin（除非用户显式要求）。
- **TDD**：Task 1（verify-addon-zip.mjs）先写失败测试 → 实现 → 通过；Task 2（release.yml）本地构造 zip + 跑校验脚本验证。
- `verify-addon-zip.mjs` 是 CI 脚本（非 MCP 工具），**不进 capability-matrix**；但需 `npm run build`？—— `.mjs` 在 `scripts/`，`package.json:files` 已含 `scripts`，但 scripts/ 是源码直接用（非 build 产物），**不需要** build。

## File Structure

| 文件 | 责任 | 动作 |
|------|------|------|
| `scripts/verify-addon-zip.mjs` | 纯函数 `verifyEntries(entries[])` 校验 addon zip 结构 + CLI 入口（stdin 读 entries） | 新增 |
| `test/scripts/verify-addon-zip.test.ts` | `verifyEntries` 单测（合法/缺 LICENSE/裸 LICENSE/目录条目/单顶层/iCloud 副本） | 新增 |
| `.github/workflows/release.yml` | tag v* 触发：verify-tag → 三 version 对齐 → build zip → verify → sha256 → softprops release | 新增 |

---

## Task 1: verify-addon-zip.mjs 纯函数 + 单测（TDD）

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\scripts\verify-addon-zip.mjs`
- Test: `D:\GitHub\godot-mcp-enhanced\test\scripts\verify-addon-zip.test.ts`

**Interfaces:**
- Produces: `export function verifyEntries(entries: string[]): { ok: boolean; errors: string[] }`（Task 2 release.yml 经 `unzip -Z1 | node scripts/verify-addon-zip.mjs` 消费；测试直接 import）。

- [ ] **Step 1: 写失败测试**

Create `D:\GitHub\godot-mcp-enhanced\test\scripts\verify-addon-zip.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { verifyEntries } from '../../scripts/verify-addon-zip.mjs';

// 合法 zip 的代表性 entry 子集（含两个顶层 + plugin.cfg + 若干 .gd）
const VALID_ENTRIES = [
  'addons/',
  'addons/godot_mcp_server/',
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/scripts/verify-addon-zip.test.ts`
Expected: FAIL — `Failed to resolve import '../../scripts/verify-addon-zip.mjs'`（文件未创建）。

- [ ] **Step 3: 写 verify-addon-zip.mjs 实现**

Create `D:\GitHub\godot-mcp-enhanced\scripts\verify-addon-zip.mjs`：

```javascript
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/scripts/verify-addon-zip.test.ts`
Expected: PASS — 7 tests passed。

- [ ] **Step 5: tsc 类型检查 + 本地 CLI 自检**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0。

本地 CLI 自检（构造合法 entries 喂 stdin，验证 exit 0）：
```bash
printf 'addons/godot_mcp_server/plugin.cfg\ngodot-mcp-enhanced-LICENSE.txt\n' | node scripts/verify-addon-zip.mjs
```
Expected: stdout 打印"zip 结构校验通过"，exit 0。

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-addon-zip.mjs test/scripts/verify-addon-zip.test.ts
git commit -m "feat(scripts): verify-addon-zip.mjs — addon zip 结构校验纯函数 + CLI

release.yml 将经 unzip -Z1 | node 喂入校验。6 项校验（仿 godot-ai release.yml）：
多顶层/plugin.cfg/LICENSE.txt/禁裸 LICENSE/禁目录条目/禁 iCloud 副本。
纯函数 verifyEntries 可单测，CLI exit 0/1。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: release.yml + 本地 zip 构造验证

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\.github\workflows\release.yml`

**Interfaces:**
- Consumes: `scripts/verify-addon-zip.mjs`（Task 1 产出，`unzip -Z1 | node` 消费）。

- [ ] **Step 1: 写 release.yml**

Create `D:\GitHub\godot-mcp-enhanced\.github\workflows\release.yml`：

```yaml
name: Release

# tag v* 触发 + 手动 dispatch（PR-1 只做 GitHub Release：addon zip + SHA256 sidecar）。
# npm publish（PR-2）与 RSA 签名（PR-3）不在本 workflow。
on:
  push:
    tags:
      - "v*"
  workflow_dispatch:

permissions:
  contents: write  # softprops/action-gh-release 创建 release 需写权限

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Verify ref is a version tag
        # 防 workflow_dispatch 在分支 ref 上跑（仿 godot-ai release.yml:37-46）
        run: |
          if [[ ! "$GITHUB_REF_NAME" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo "ERROR: release.yml 必须在版本 tag (vX.Y.Z) 上跑，当前: $GITHUB_REF_NAME" >&2
            echo "手动 dispatch 时请在 ref 下拉选 v* tag。" >&2
            exit 1
          fi

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: 'npm'

      - run: npm ci --ignore-scripts

      - name: Verify tag ↔ package.json ↔ plugin.cfg version 三对齐
        run: |
          tag="${GITHUB_REF_NAME#v}"
          pkg=$(node -p "require('./package.json').version")
          cfg=$(grep '^version=' addons/godot_mcp_server/plugin.cfg | head -1 | cut -d'"' -f2)
          echo "tag=$tag  package.json=$pkg  plugin.cfg=$cfg"
          if [ "$tag" != "$pkg" ]; then
            echo "ERROR: tag ($tag) != package.json version ($pkg)" >&2; exit 1
          fi
          if [ "$tag" != "$cfg" ]; then
            echo "ERROR: tag ($tag) != plugin.cfg version ($cfg)" >&2; exit 1
          fi
          echo "三 version 对齐: $tag"

      - name: Build addon zip（多顶层：addons/ + godot-mcp-enhanced-LICENSE.txt）
        # 多顶层 trick：双顶层让 Godot AssetLib 不弹 "Ignore asset root"
        # （单顶层会剥 addons/ 致 plugin 落 res://godot_mcp_server/ 而非 res://addons/...）。
        # LICENSE 命名空间化（非裸 LICENSE）避免覆盖用户项目 LICENSE（godot-ai #450）。
        # zip -D 剥零字节目录条目（self-update zip-slip 守卫拒路径以 / 结尾的条目）。
        run: |
          mkdir -p staging/addons
          cp -r addons/godot_mcp_server staging/addons/
          cp LICENSE staging/godot-mcp-enhanced-LICENSE.txt
          cd staging
          zip -D -r ../godot-mcp-enhanced-addon.zip addons/ godot-mcp-enhanced-LICENSE.txt
          cd ..
          ls -la godot-mcp-enhanced-addon.zip

      - name: Verify zip structure
        # 用 Task 1 的纯函数脚本校验（unzip -Z1 列 entry → node 校验）
        run: unzip -Z1 godot-mcp-enhanced-addon.zip | node scripts/verify-addon-zip.mjs

      - name: Generate SHA-256 sidecar
        # sidecar 供未来 self-updater（PR-3 签名 + PR-4 自更新）校验下载完整性。
        # sha256sum 的 "<hex>  <name>" 格式是通用解析约定。
        run: |
          sha256sum godot-mcp-enhanced-addon.zip > godot-mcp-enhanced-addon.zip.sha256
          echo "--- sha256 sidecar ---"
          cat godot-mcp-enhanced-addon.zip.sha256

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: |
            godot-mcp-enhanced-addon.zip
            godot-mcp-enhanced-addon.zip.sha256
          generate_release_notes: true
          # name 用 tag 名（默认即 tag，显式更清）
          name: ${{ github.ref_name }}
```

- [ ] **Step 2: 本地构造 zip + 跑校验脚本验证（模拟 release.yml 的 build+verify 步）**

本地手动跑 release.yml 的核心逻辑（build zip + verify），确认 workflow 在 CI 会绿：
```bash
# 模拟 build addon zip 步
mkdir -p /tmp/zc-staging/addons
cp -r addons/godot_mcp_server /tmp/zc-staging/addons/
cp LICENSE /tmp/zc-staging/godot-mcp-enhanced-LICENSE.txt
( cd /tmp/zc-staging && zip -D -r /tmp/godot-mcp-enhanced-addon.zip addons/ godot-mcp-enhanced-LICENSE.txt )
# 模拟 verify 步
unzip -Z1 /tmp/godot-mcp-enhanced-addon.zip | node scripts/verify-addon-zip.mjs
echo "exit=$?"
# 模拟 sha256 步
sha256sum /tmp/godot-mcp-enhanced-addon.zip
# 清理
rm -rf /tmp/zc-staging /tmp/godot-mcp-enhanced-addon.zip
```
Expected: verify 脚本 exit 0（打印"zip 结构校验通过"）；sha256sum 打印哈希。

- [ ] **Step 3: yaml 语法 + tsc 最终检查**

Run: `node -e "require('fs').readFileSync('.github/workflows/release.yml','utf-8')" && npx tsc --noEmit -p tsconfig.json`
Expected: 无异常（yaml 文件可读 + tsc exit 0）。

若有 yaml lint 工具（如 `npx --offline yaml-lint`）可跑；无则跳过（CI 实际触发时会验证语法）。

- [ ] **Step 4: 跑全量测试确认无回归**

Run: `npx vitest run test/scripts/`
Expected: verify-addon-zip.test.ts 全 pass。

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "feat(ci): release.yml — tag v* 触发 addon zip + SHA256 + GitHub Release

PR-1 建立 enhanced 首个 release pipeline（之前 tag 停 v0.24.0、从未自动发版）：
三 version 对齐校验 + 多顶层 zip（AssetLib 兼容）+ verify-addon-zip 结构校验 +
SHA256 sidecar + softprops release。npm publish（PR-2）/ RSA 签名（PR-3）后续。

本地构造 zip + 校验脚本验证通过（模拟 CI build+verify 步）。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec 覆盖**：
- 方案 C（zip + SHA256 + GitHub Release，无 npm publish / 无 RSA）→ Task 2 release.yml 全覆盖，未引入 npm publish step / RELEASE_SIGNING_KEY_PEM secret。
- 多顶层 zip trick + LICENSE 命名空间化 + zip -D → Task 2 build step + Task 1 校验 1/4/5 项覆盖。
- 三 version 对齐 → Task 2 verify step。
- SHA256 sidecar → Task 2 generate step。
- 借鉴 godot-ai release.yml 但去 pypi/sign/discord → release.yml 无这些 job/step。

**2. 占位符扫描**：无 TBD/TODO；代码块完整；测试有断言；本地验证命令有 expected。

**3. 类型/接口一致性**：`verifyEntries(entries: string[]): {ok, errors}` 在 Task 1 实现 + 测试一致；Task 2 `unzip -Z1 | node scripts/verify-addon-zip.mjs` 消费方式与 Task 1 CLI 入口（stdin 读 entries）一致；addon 名 `godot_mcp_server` 全 plan 一致。

**4. 已知偏离/风险**：
- **workflow 无法本地完整 E2E**（需 tag push 触发真实 CI）——Task 2 Step 2 用本地构造 zip + 校验脚本模拟 build+verify 步，覆盖可离线验证的部分；真实 CI 首次跑需用户 push tag 时观察。
- **softprops/action-gh-release@v2** 用 major tag（非 sha pin）——与 enhanced ci.yml 风格一致（ci.yml 用 actions/checkout@v4 非 sha pin）；godot-ai 用 sha pin 是其项目偏好。
- **首次发版需用户操作**：plan 只建 workflow，真正发 v0.25.0 tag 是用户决策（不在 plan 自动执行）。
- **npm publish（PR-2）未做**：TS server 的 npm 分发仍靠用户手动 `npm publish`，PR-1 只自动化 GitHub Release（addon zip）面。
