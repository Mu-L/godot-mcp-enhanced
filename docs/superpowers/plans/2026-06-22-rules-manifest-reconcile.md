# 规则文件清单与 Reconcile 对账 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `setup_project_rules` 写入的规则文件引入"可更新"能力 —— 通过 manifest 追踪每个项目的规则安装状态，reconcile 检测过时并按用户意图更新（`check`/`update`/`overwrite` 三态）。

**Architecture:** 新增纯函数模块 `src/tools/rules-manifest.ts`（manifest 类型 + hash + adopt + 二维判定 + reconcile 规划，零 IO 依赖，完全可测）。`project.ts` 的 `setup_project_rules` 负责文件 IO 编排，调用这些纯函数。CI 加一个脚本守护"模板内容变更必伴随版本 bump"的不变式。

**Tech Stack:** TypeScript + Node.js（`crypto.createHash`）、vitest、GitHub Actions CI。

## Global Constraints

- spec：`D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-06-22-rules-manifest-reconcile-design.md`
- hash 算法：SHA-256，前缀 `sha256:`，**CRLF 归一化后计算**（`content.replace(/\r\n/g,'\n').replace(/\r/g,'\n')`）
- hash 归一化**仅用于算 hash**，写入磁盘的内容**不归一化**（保留用户换行符）
- manifest 路径：`{project}/.claude/rules/.godot-mcp-manifest.json`，JSON 2 空格缩进
- `rules_installed_at_version` 字段**仅代表规则文件安装时的 server 版本**（非整个 MCP 安装）
- `rules_mode: "check" | "update" | "overwrite"`，默认 `"check"`；现有 `force` 参数保持原义（管 hooks/CLAUDE.md），**不再管规则文件**
- manifest 损坏（JSON parse 失败）→ 当"无 manifest"处理 → adopt，**不覆盖任何规则文件**（对齐 `project.ts:311-314` settings.json 策略）
- 写 manifest 复用 `project.ts:600` 的 `writeAtomic`
- commit 规范：conventional commits，scope 用 `rules`（如 `feat(rules): ...`）

---

## File Structure

| 文件 | 职责 | 任务 |
|------|------|------|
| 新增 `src/tools/rules-manifest.ts` | manifest 类型 + hash + adopt + 二维分类 + reconcile 规划（纯函数，零 IO） | T1-T4 |
| 新增 `test/tools/rules-manifest.test.ts` | 纯函数单元测试 | T1-T4 |
| 改 `src/tools/claudemd-builder.ts` | `GODOT_MCP_RULES` 加 `{{MCP_VERSION}}` 占位符 | T5 |
| 改 `src/tools/rule-templates.ts` | 更新双副本维护注释 | T5 |
| 改 `src/tools/project.ts` | base 规则走插值（T5）；`setup_project_rules` 集成 manifest + `rules_mode`（T6） | T5, T6 |
| 新增 `test/tools/setup-project-rules-manifest.test.ts` | 端到端集成测试（临时目录） | T6 |
| 新增 `scripts/check-rules-version-bump.mjs` | CI 不变式检查脚本 | T7 |
| 改 `.github/workflows/ci.yml` | 接入检查脚本 | T7 |

---

## Task 1: hash 计算 + 基础类型

**Files:**
- Create: `src/tools/rules-manifest.ts`
- Test: `test/tools/rules-manifest.test.ts`

**Interfaces:**
- Produces: `RulesManifest` 接口、`FileClassification` / `RulesMode` 类型、`normalizeForHash(content): string`、`hashContent(content): string`

- [ ] **Step 1: 写失败测试**

创建 `test/tools/rules-manifest.test.ts`：

```ts
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
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run test/tools/rules-manifest.test.ts`
Expected: FAIL — `Cannot find module '../../src/tools/rules-manifest.js'`

- [ ] **Step 3: 写最小实现**

创建 `src/tools/rules-manifest.ts`：

```ts
// src/tools/rules-manifest.ts
// 规则文件清单（manifest）的纯函数模块：hash 计算、adopt 构建、二维判定、reconcile 规划。
// 零 IO 依赖（不读写文件系统），所有文件读写由 project.ts 编排，本模块只做决策。

import { createHash } from 'crypto';

// ─── 类型 ────────────────────────────────────────────────────────────────────

/** 单个规则文件在 manifest 中的条目 */
export interface RuleManifestEntry {
  /** 内容来源：'base' = GODOT_MCP_RULES，'detail' = DETAILED_RULE_TEMPLATES */
  source: 'base' | 'detail';
  /** 安装时文件内容的 hash（CRLF 归一化后），格式 'sha256:<hex>' */
  hash: string;
}

/** manifest 文件结构 */
export interface RulesManifest {
  /** 清单格式版本，留作未来迁移 */
  manifest_version: number;
  /** 规则文件安装时的 server 版本（仅代表规则文件，非整个 MCP 安装） */
  rules_installed_at_version: string;
  /** 安装时间 ISO 字符串 */
  installed_at: string;
  /** 文件名 → 条目 */
  rules: Record<string, RuleManifestEntry>;
}

/** 逐文件二维判定的四种分类（见 spec §3.3） */
export type FileClassification =
  | 'pure-upgrade'          // 版本过时 + 用户未动过 → update 应覆盖
  | 'stale-and-modified'    // 版本过时 + 用户动过 → update 保留并警告
  | 'latest'                // 版本同 + 未动过 → 不动
  | 'local-modified';       // 版本同 + 动过 → 保留并报告

/** reconcile 执行模式 */
export type RulesMode = 'check' | 'update' | 'overwrite';

// ─── hash ────────────────────────────────────────────────────────────────────

/** CRLF / 裸 CR 归一化为 LF。仅用于算 hash，不用于写磁盘。 */
export function normalizeForHash(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** 计算内容的 SHA-256 hash（CRLF 归一化后），返回 'sha256:<hex>'。 */
export function hashContent(content: string): string {
  const normalized = normalizeForHash(content);
  const hex = createHash('sha256').update(normalized, 'utf-8').digest('hex');
  return `sha256:${hex}`;
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run test/tools/rules-manifest.test.ts`
Expected: PASS — 8 个测试全过

- [ ] **Step 5: 提交**

```bash
cd D:/GitHub/godot-mcp-enhanced
git add src/tools/rules-manifest.ts test/tools/rules-manifest.test.ts
git commit -m "feat(rules): manifest hash 计算 + 基础类型（T1）"
```

---

## Task 2: adopt manifest 构建

**Files:**
- Modify: `src/tools/rules-manifest.ts`
- Modify: `test/tools/rules-manifest.test.ts`

**Interfaces:**
- Consumes: `hashContent`（T1）
- Produces: `buildAdoptManifest({ serverVersion, files, now })` → `RulesManifest`；`countDeviations(manifest, currentTemplateHashes)` → 偏离计数

- [ ] **Step 1: 写失败测试**

追加到 `test/tools/rules-manifest.test.ts`（在文件末尾的最后一个 `});` 之前，或并列新 describe）：

```ts
import { buildAdoptManifest, countDeviations, hashContent } from '../../src/tools/rules-manifest.js';

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
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run test/tools/rules-manifest.test.ts`
Expected: FAIL — `buildAdoptManifest is not a function` / `countDeviations is not a function`

- [ ] **Step 3: 写实现**

追加到 `src/tools/rules-manifest.ts` 末尾：

```ts
// ─── adopt ───────────────────────────────────────────────────────────────────

/** adopt 输入：每个规则文件的当前磁盘内容 */
export interface AdoptFileInput {
  filename: string;
  content: string;
  source: 'base' | 'detail';
}

/** adopt 构建参数 */
export interface BuildAdoptParams {
  serverVersion: string;
  now: string; // ISO 时间戳，注入以便测试
  files: AdoptFileInput[];
}

/**
 * 把当前磁盘状态固化为新 manifest 基线（spec §5）。
 * 偏离模板的文件 hash 记实际内容（不报错），偏离计数由 countDeviations 单独算。
 */
export function buildAdoptManifest(params: BuildAdoptParams): RulesManifest {
  const rules: Record<string, RuleManifestEntry> = {};
  for (const f of params.files) {
    rules[f.filename] = { source: f.source, hash: hashContent(f.content) };
  }
  return {
    manifest_version: 1,
    rules_installed_at_version: params.serverVersion,
    installed_at: params.now,
    rules,
  };
}

/**
 * 统计 manifest 中磁盘 hash ≠ 当前模板 hash 的文件数（spec §5 adopt 报告用）。
 * @param manifest adopt 后的 manifest
 * @param currentTemplateHashes 每个文件名 → 当前模板内容的 hash
 */
export function countDeviations(
  manifest: RulesManifest,
  currentTemplateHashes: Record<string, string>,
): number {
  let n = 0;
  for (const [filename, entry] of Object.entries(manifest.rules)) {
    const templateHash = currentTemplateHashes[filename];
    if (templateHash !== undefined && entry.hash !== templateHash) n++;
  }
  return n;
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run test/tools/rules-manifest.test.ts`
Expected: PASS — 全部测试过

- [ ] **Step 5: 提交**

```bash
cd D:/GitHub/godot-mcp-enhanced
git add src/tools/rules-manifest.ts test/tools/rules-manifest.test.ts
git commit -m "feat(rules): adopt manifest 构建 + 偏离计数（T2）"
```

---

## Task 3: 二维分类（核心正确性）

**Files:**
- Modify: `src/tools/rules-manifest.ts`
- Modify: `test/tools/rules-manifest.test.ts`

**Interfaces:**
- Consumes: 无新依赖
- Produces: `classifyFile({ installedVersion, serverVersion, diskHash, manifestHash })` → `FileClassification`

- [ ] **Step 1: 写失败测试（4 种组合全覆盖）**

追加到 `test/tools/rules-manifest.test.ts`：

```ts
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
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run test/tools/rules-manifest.test.ts`
Expected: FAIL — `classifyFile is not a function`

- [ ] **Step 3: 写实现**

追加到 `src/tools/rules-manifest.ts`：

```ts
// ─── 二维分类（spec §3.3，不级联）──────────────────────────────────────────────

export interface ClassifyParams {
  /** manifest 记录的安装时版本 */
  installedVersion: string;
  /** 当前 server 版本 */
  serverVersion: string;
  /** 当前磁盘文件内容的 hash */
  diskHash: string;
  /** manifest 记录的安装时 hash */
  manifestHash: string;
}

/**
 * 逐文件二维判定。版本与"是否动过"是两个独立维度，做笛卡尔积，不级联。
 * 级联会吞用户修改（见 spec §3.3 "为什么二维而非级联"）。
 */
export function classifyFile(p: ClassifyParams): FileClassification {
  const versionStale = p.installedVersion !== p.serverVersion;
  const userModified = p.diskHash !== p.manifestHash;
  if (versionStale && !userModified) return 'pure-upgrade';
  if (versionStale && userModified) return 'stale-and-modified';
  if (!versionStale && !userModified) return 'latest';
  return 'local-modified';
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run test/tools/rules-manifest.test.ts`
Expected: PASS — 4 个分类测试全过

- [ ] **Step 5: 提交**

```bash
cd D:/GitHub/godot-mcp-enhanced
git add src/tools/rules-manifest.ts test/tools/rules-manifest.test.ts
git commit -m "feat(rules): 二维分类判定（T3，核心正确性）"
```

---

## Task 4: reconcile 规划（集成分类 + mode 决策）

**Files:**
- Modify: `src/tools/rules-manifest.ts`
- Modify: `test/tools/rules-manifest.test.ts`

**Interfaces:**
- Consumes: `classifyFile`（T3）、`hashContent`（T1）、`RulesManifest`/`RulesMode`/`FileClassification` 类型
- Produces: `planReconcile({ manifest, serverVersion, diskFiles, mode, now })` → `ReconcilePlan`

- [ ] **Step 1: 写失败测试**

追加到 `test/tools/rules-manifest.test.ts`：

```ts
import { planReconcile, hashContent } from '../../src/tools/rules-manifest.js';
import type { RulesManifest } from '../../src/tools/rules-manifest.js';

function manifestAt(version: string, hashes: Record<string, string>): RulesManifest {
  return {
    manifest_version: 1,
    rules_installed_at_version: version,
    installed_at: '2026-06-22T10:00:00Z',
    rules: Object.fromEntries(
      Object.entries(hashes).map(([f, h]) => [f, { source: 'detail' as const, hash: h }]),
    ),
  };
}

describe('planReconcile', () => {
  // 场景：3 个文件，分别落在 pure-upgrade / stale-and-modified / local-modified
  const baseHash = hashContent('旧模板内容');
  const manifest = manifestAt('0.16.0', {
    'pure.md': baseHash,           // 磁盘=旧模板，未动过
    'stale-mod.md': baseHash,      // 磁盘=用户改过
    'local-mod.md': hashContent('当前模板'), // 磁盘=用户改过，但版本同... 用同版本场景测 local
  });

  it('check 模式：只分类，所有文件 action=keep', () => {
    const plan = planReconcile({
      manifest: manifestAt('0.18.0', { 'a.md': hashContent('x') }),
      serverVersion: '0.18.0',
      diskFiles: [{ filename: 'a.md', content: 'x' }],
      mode: 'check',
      now: '2026-06-22T11:00:00Z',
    });
    expect(plan.actions['a.md'].action).toBe('keep');
    expect(plan.shouldWriteFiles).toBe(false);
  });

  it('update 模式：覆盖 pure-upgrade，保留 stale-and-modified 并 warn', () => {
    const manifest2 = manifestAt('0.16.0', {
      'pure.md': hashContent('旧模板'),         // 未动过 → pure-upgrade
      'stale.md': hashContent('旧模板'),         // 磁盘改过 → stale-and-modified
    });
    const plan = planReconcile({
      manifest: manifest2,
      serverVersion: '0.18.0',
      diskFiles: [
        { filename: 'pure.md', content: '旧模板' },      // 磁盘==manifest hash → 未动过
        { filename: 'stale.md', content: '用户改过' },    // 磁盘≠manifest hash → 动过
      ],
      currentTemplates: { 'pure.md': '新模板', 'stale.md': '新模板' },
      mode: 'update',
      now: '2026-06-22T11:00:00Z',
    });
    expect(plan.actions['pure.md'].action).toBe('write');
    expect(plan.actions['pure.md'].classification).toBe('pure-upgrade');
    expect(plan.actions['stale.md'].action).toBe('warn-keep');
    expect(plan.actions['stale.md'].classification).toBe('stale-and-modified');
    expect(plan.shouldWriteFiles).toBe(true);
  });

  it('overwrite 模式：覆盖所有非 latest 文件（含 stale-and-modified）', () => {
    const manifest2 = manifestAt('0.16.0', {
      'pure.md': hashContent('旧模板'),
      'stale.md': hashContent('旧模板'),
    });
    const plan = planReconcile({
      manifest: manifest2,
      serverVersion: '0.18.0',
      diskFiles: [
        { filename: 'pure.md', content: '旧模板' },
        { filename: 'stale.md', content: '用户改过' },
      ],
      currentTemplates: { 'pure.md': '新模板', 'stale.md': '新模板' },
      mode: 'overwrite',
      now: '2026-06-22T11:00:00Z',
    });
    expect(plan.actions['pure.md'].action).toBe('write');
    expect(plan.actions['stale.md'].action).toBe('write');
  });

  it('update 后 manifest 版本更新为 server 版本，被覆盖文件 hash 更新', () => {
    const manifest2 = manifestAt('0.16.0', { 'pure.md': hashContent('旧模板') });
    const plan = planReconcile({
      manifest: manifest2,
      serverVersion: '0.18.0',
      diskFiles: [{ filename: 'pure.md', content: '旧模板' }],
      currentTemplates: { 'pure.md': '新模板内容' },
      mode: 'update',
      now: '2026-06-22T11:00:00Z',
    });
    expect(plan.newManifest.rules_installed_at_version).toBe('0.18.0');
    expect(plan.newManifest.rules['pure.md'].hash).toBe(hashContent('新模板内容'));
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run test/tools/rules-manifest.test.ts`
Expected: FAIL — `planReconcile is not a function`

- [ ] **Step 3: 写实现**

追加到 `src/tools/rules-manifest.ts`：

```ts
// ─── reconcile 规划（spec §3.3 + §3.4 + §3.6）─────────────────────────────────

/** 单个文件的 reconcile 动作 */
export type FileAction = 'write' | 'keep' | 'warn-keep';

export interface FilePlan {
  classification: FileClassification;
  action: FileAction;
  /** action=write 时，要写入的新内容（来自当前模板） */
  newContent?: string;
}

export interface PlanReconcileParams {
  manifest: RulesManifest;
  serverVersion: string;
  diskFiles: { filename: string; content: string }[];
  /** 当前模板内容（文件名 → 插值后的模板字符串）。update/overwrite 时覆盖用 */
  currentTemplates?: Record<string, string>;
  mode: RulesMode;
  now: string;
}

export interface ReconcilePlan {
  /** 文件名 → 动作计划 */
  actions: Record<string, FilePlan>;
  /** 是否需要写文件（check 模式为 false） */
  shouldWriteFiles: boolean;
  /** 更新后的 manifest（无论是否写文件都给出，供报告） */
  newManifest: RulesManifest;
}

export function planReconcile(p: PlanReconcileParams): ReconcilePlan {
  const actions: Record<string, FilePlan> = {};
  const newRules: Record<string, RuleManifestEntry> = {};

  for (const disk of p.diskFiles) {
    const entry = p.manifest.rules[disk.filename];
    // manifest 没记录的文件（用户新增？）→ 视为 local-modified，保守不动
    const manifestHash = entry?.hash ?? '';
    const installedVersion = entry ? p.manifest.rules_installed_at_version : p.serverVersion;
    const classification = classifyFile({
      installedVersion,
      serverVersion: p.serverVersion,
      diskHash: hashContent(disk.content),
      manifestHash,
    });

    let action: FileAction = 'keep';
    let newContent: string | undefined;
    let resolvedHash = entry?.hash ?? hashContent(disk.content);

    if (p.mode === 'overwrite') {
      // 全覆盖（不管分类，除 latest 外都写；latest 写也无害但跳过省 IO）
      if (classification !== 'latest' && p.currentTemplates?.[disk.filename] !== undefined) {
        action = 'write';
        newContent = p.currentTemplates[disk.filename];
        resolvedHash = hashContent(newContent);
      }
    } else if (p.mode === 'update') {
      if (classification === 'pure-upgrade' && p.currentTemplates?.[disk.filename] !== undefined) {
        action = 'write';
        newContent = p.currentTemplates[disk.filename];
        resolvedHash = hashContent(newContent);
      } else if (classification === 'stale-and-modified' || classification === 'local-modified') {
        action = 'warn-keep';
      }
    }
    // check 模式 action 保持 keep

    actions[disk.filename] = { classification, action, newContent };
    newRules[disk.filename] = {
      source: entry?.source ?? 'detail',
      hash: resolvedHash,
    };
  }

  // 新 manifest 版本：若发生过任何 write（update/overwrite），版本推进到 server 版本
  const anyWrite = Object.values(actions).some(a => a.action === 'write');
  const newManifest: RulesManifest = {
    manifest_version: p.manifest.manifest_version,
    rules_installed_at_version: anyWrite ? p.serverVersion : p.manifest.rules_installed_at_version,
    installed_at: p.now,
    rules: newRules,
  };

  return {
    actions,
    shouldWriteFiles: p.mode === 'update' || p.mode === 'overwrite',
    newManifest,
  };
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run test/tools/rules-manifest.test.ts`
Expected: PASS — 全部测试过

- [ ] **Step 5: 提交**

```bash
cd D:/GitHub/godot-mcp-enhanced
git add src/tools/rules-manifest.ts test/tools/rules-manifest.test.ts
git commit -m "feat(rules): reconcile 规划（T4，集成分类+mode）"
```

---

## Task 5: base 规则加版本号 + 统一插值路径

**Files:**
- Modify: `src/tools/claudemd-builder.ts:23` — `GODOT_MCP_RULES` 加占位符
- Modify: `src/tools/rule-templates.ts:1-6` — 更新双副本注释
- Modify: `src/tools/project.ts:428-435` — base 规则写入走 `{{MCP_VERSION}}` 插值

**Interfaces:**
- Consumes: 无
- Produces: `GODOT_MCP_RULES` 含 `{{MCP_VERSION}}`；base 写入路径与详细规则统一

- [ ] **Step 1: 写失败测试**

创建 `test/tools/base-rule-version.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { GODOT_MCP_RULES } from '../../src/tools/claudemd-builder.js';

describe('GODOT_MCP_RULES 版本占位符', () => {
  it('包含 {{MCP_VERSION}} 占位符（供 setup_project_rules 插值）', () => {
    expect(GODOT_MCP_RULES).toContain('{{MCP_VERSION}}');
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run test/tools/base-rule-version.test.ts`
Expected: FAIL — `expect(GODOT_MCP_RULES).toContain('{{MCP_VERSION}}')` 断言失败（当前无占位符）

- [ ] **Step 3a: 给 base 规则加占位符**

读 `src/tools/claudemd-builder.ts` 找 `GODOT_MCP_RULES` 模板（`:23` 开始），在其头部说明行加入版本占位符。例如把：

```
# Godot MCP 开发规则
```

改为：

```
# Godot MCP 开发规则

> 适用于 godot-mcp-enhanced {{MCP_VERSION}}+
```

（具体插入位置：在 `GODOT_MCP_RULES` 模板字符串的第一行标题之后。用 MCP 的 `edit_script` 不适用——这是 .ts 文件，用 Claude 的 Edit 工具。）

- [ ] **Step 3b: 更新 rule-templates.ts 双副本注释**

把 `src/tools/rule-templates.ts:4-5` 的：

```
// ⚠️ 维护注意：本文件中的模板内容与 .claude/rules/godot-mcp-*.md 是两份独立副本。
// 更新规则时，必须同步修改两处：(1) .claude/rules/ 下的实际文件 (2) 此处的模板。
```

改为：

```
// ⚠️ 维护注意：本文件中的模板内容与 .claude/rules/godot-mcp-*.md 是两份独立副本。
// 更新规则时，必须同步修改两处：(1) .claude/rules/ 下的实际文件 (2) 此处的模板。
// 分发追踪由 .godot-mcp-manifest.json 解决（见 setup_project_rules 的 reconcile），
// 但模板源与 .claude/rules/ 仍需保持一致 —— CI 的 check-rules-version-bump 脚本
// 会在模板变更时强制要求 package.json 版本 bump。
```

- [ ] **Step 3c: project.ts base 规则写入走插值**

读 `src/tools/project.ts:428-435`，把 base 规则的写入从裸常量改为插值。当前：

```ts
        // Base rules: godot-mcp.md
        const rulesPath = join(rulesDir, 'godot-mcp.md');
        if (!existsSync(rulesPath)) {
          writeAtomic(rulesPath, GODOT_MCP_RULES);
          actions.push('rules: created .claude/rules/godot-mcp.md');
        } else if (force) {
          actions.push('rules: preserved godot-mcp.md (user modifications protected)');
        }
```

改为（与详细规则 :444-446 统一走 `{{MCP_VERSION}}` 插值；此处仍保持"创建即冻结"行为，manifest 集成在 T6）：

```ts
        // Base rules: godot-mcp.md（与详细规则统一走 {{MCP_VERSION}} 插值）
        const rulesPath = join(rulesDir, 'godot-mcp.md');
        const baseContent = GODOT_MCP_RULES.replace(/\{\{MCP_VERSION\}\}/g, mcpVersion);
        if (!existsSync(rulesPath)) {
          writeAtomic(rulesPath, baseContent);
          actions.push('rules: created .claude/rules/godot-mcp.md');
        } else if (force) {
          actions.push('rules: preserved godot-mcp.md (user modifications protected)');
        }
```

（⚠️ 作用域注意：`mcpVersion` 当前在 project.ts:439-441 定义，位于 base 段（:428-435）**之后**。base 段直接引用它会触发 TDZ。实施 T5 时需先把 mcpVersion 读取（:439-441 三行）**剪切到 `const rulesDir`（:425）之后**，再改 base 段走插值。TDD 的编译步骤（`npm run build` 或 vitest 的 ts 转译）会捕获遗漏。）

- [ ] **Step 4: 跑测试验证通过 + 全量回归**

Run: `npx vitest run test/tools/base-rule-version.test.ts`
Expected: PASS

Run: `npx vitest run test/tools/project-scaffold.test.ts`（回归：setup_project_rules 现有行为不破坏）
Expected: PASS（若无此测试覆盖 base 写入，手动验证：在临时 Godot 项目跑 setup_project_rules，检查生成的 godot-mcp.md 含版本号）

- [ ] **Step 5: 提交**

```bash
cd D:/GitHub/godot-mcp-enhanced
git add src/tools/claudemd-builder.ts src/tools/rule-templates.ts src/tools/project.ts test/tools/base-rule-version.test.ts
git commit -m "feat(rules): base 规则加 {{MCP_VERSION}} 占位符 + 统一插值路径（T5）"
```

---

## Task 6: project.ts 集成 manifest + rules_mode

**Files:**
- Modify: `src/tools/project.ts` — inputSchema 加 `rules_mode`；`setup_project_rules` case 重构规则文件写入段（:424-453）为 manifest 驱动
- Create: `test/tools/setup-project-rules-manifest.test.ts` — 端到端集成测试

**Interfaces:**
- Consumes: `buildAdoptManifest`、`countDeviations`、`planReconcile`、`hashContent`（T1-T4，来自 `./rules-manifest.js`）；`writeAtomic`（project.ts:600）
- Produces: `setup_project_rules` 支持 `rules_mode` 参数；读写 `.godot-mcp-manifest.json`

- [ ] **Step 1: 写失败测试（端到端，临时目录）**

创建 `test/tools/setup-project-rules-manifest.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// 直接驱动纯函数层做集成断言（避免拉起整个 MCP server）
import {
  buildAdoptManifest, planReconcile, hashContent, countDeviations,
} from '../../src/tools/rules-manifest.js';

function makeGodotProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gmc-rules-'));
  writeFileSync(join(dir, 'project.godot'), '[application]\nconfig/name="test"\n');
  return dir;
}

describe('setup_project_rules manifest 集成（纯函数驱动）', () => {
  let project: string;
  beforeEach(() => { project = makeGodotProject(); });
  afterEach(() => { rmSync(project, { recursive: true, force: true }); });

  it('adopt：老项目无 manifest → 固化当前状态为基线', () => {
    const files = [{ filename: 'godot-mcp.md', content: '旧内容', source: 'base' as const }];
    const m = buildAdoptManifest({ serverVersion: '0.18.2', now: '2026-06-22T10:00:00Z', files });
    expect(m.rules['godot-mcp.md'].hash).toBe(hashContent('旧内容'));
    expect(m.rules_installed_at_version).toBe('0.18.2');
  });

  it('adopt 报告偏离：文件≠模板时 countDeviations 计数', () => {
    const m = buildAdoptManifest({
      serverVersion: '0.18.2', now: '2026-06-22T10:00:00Z',
      files: [{ filename: 'godot-mcp.md', content: '历史遗留内容', source: 'base' }],
    });
    const dev = countDeviations(m, { 'godot-mcp.md': hashContent('当前模板') });
    expect(dev).toBe(1);
  });

  it('update：版本过时+用户本地修改并存 → 保留并 warn-keep（不吞修改）', () => {
    const oldTemplateHash = hashContent('0.16 模板');
    const manifest = {
      manifest_version: 1 as const,
      rules_installed_at_version: '0.16.0',
      installed_at: '2026-06-01T00:00:00Z',
      rules: { 'core.md': { source: 'detail' as const, hash: oldTemplateHash } },
    };
    const plan = planReconcile({
      manifest,
      serverVersion: '0.18.0',
      diskFiles: [{ filename: 'core.md', content: '用户在 0.16 时改过' }],
      currentTemplates: { 'core.md': '0.18 新模板' },
      mode: 'update',
      now: '2026-06-22T11:00:00Z',
    });
    expect(plan.actions['core.md'].classification).toBe('stale-and-modified');
    expect(plan.actions['core.md'].action).toBe('warn-keep');
    expect(plan.shouldWriteFiles).toBe(true); // 可能有其他文件要写，但这个文件不动
  });

  it('overwrite：全覆盖含本地修改', () => {
    const manifest = {
      manifest_version: 1 as const,
      rules_installed_at_version: '0.16.0',
      installed_at: '2026-06-01T00:00:00Z',
      rules: { 'core.md': { source: 'detail' as const, hash: hashContent('旧模板') } },
    };
    const plan = planReconcile({
      manifest,
      serverVersion: '0.18.0',
      diskFiles: [{ filename: 'core.md', content: '用户改过' }],
      currentTemplates: { 'core.md': '新模板' },
      mode: 'overwrite',
      now: '2026-06-22T11:00:00Z',
    });
    expect(plan.actions['core.md'].action).toBe('write');
  });

  it('manifest 损坏（无效 JSON）→ project.ts 当无 manifest 处理（adopt，不覆盖）', () => {
    // 这个行为由 project.ts 的 readManifest 实现：parse 失败返回 null
    // 纯函数层不读文件，这里用规则说明：project.ts 读 manifest 失败时走 adopt 分支
    // 端到端验证在 project.ts 改完后补一个真实 fs 用例（见 Step 3 验证段）
    expect(true).toBe(true); // 占位，实际校验在 Step 4 的手动验证
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run test/tools/setup-project-rules-manifest.test.ts`
Expected: FAIL — 依赖的纯函数已存在（T1-T4），但若 T1-T4 全过，这些测试**可能直接 PASS**（因为它们测的是纯函数）。若 PASS，说明纯函数层已满足；本任务重点是 project.ts 集成，继续 Step 3 改 project.ts，Step 4 补真实 fs 集成测试。

- [ ] **Step 3: 改 project.ts —— inputSchema 加 rules_mode + 重构规则文件写入段**

**3a.** 在 `src/tools/project.ts` 的 inputSchema properties 里（:55 附近 `hooks` 之后），加 `rules_mode` 字段：

```ts
          rules_mode: {
            type: 'string',
            enum: ['check', 'update', 'overwrite'],
            description: '规则文件 reconcile 模式：check（默认，只检测报告）/ update（覆盖版本过时且未动过的文件，保留用户动过的）/ overwrite（全覆盖含本地修改）',
            default: 'check',
          },
```

**3b.** 在 `src/tools/project.ts` 顶部 import 区（:13 后）加：

```ts
import {
  buildAdoptManifest, planReconcile, hashContent, countDeviations,
  type RulesManifest, type RulesMode, type AdoptFileInput,
} from './rules-manifest.js';
```

**3c.** 在 `setup_project_rules` 的 case 内（:425 `const rulesDir = join(p, '.claude', 'rules');` 之后，:454 `}` 之前），把现有的"规则文件创建/冻结"段（:428-453）替换为 manifest 驱动的实现。

**⚠️ 基于 T5 后的 state**：T5 已把 mcpVersion 读取提前到 rulesDir 之后。本任务替换 :425-453 整段时，替换段开头要**保留 mcpVersion 读取**（从 package.json 读 version 的三行），否则后续 `{{MCP_VERSION}}` 插值失效。实施前先 `git log --oneline -3` 确认 T5 已提交，再读当前 project.ts 的实际行号（T5 改动后行号会偏移）。

读当前规则文件段（T5 后），整体替换为：

```ts
        const rulesDir = join(p, '.claude', 'rules');
        mkdirSync(rulesDir, { recursive: true });

        // ── 规则文件 manifest 驱动（spec §3.6）──
        const manifestPath = join(rulesDir, '.godot-mcp-manifest.json');
        const rulesMode: RulesMode = (args.rules_mode as RulesMode) || 'check';

        // 当前模板内容（插值后），用于覆盖与偏离判断
        const baseContent = GODOT_MCP_RULES.replace(/\{\{MCP_VERSION\}\}/g, mcpVersion);
        const currentTemplates: Record<string, string> = { 'godot-mcp.md': baseContent };
        for (const [filename, tpl] of Object.entries(DETAILED_RULE_TEMPLATES)) {
          currentTemplates[filename] = tpl.replace(/\{\{MCP_VERSION\}\}/g, mcpVersion);
        }

        // 读现有 manifest（损坏当无 manifest，spec §6）
        let manifest: RulesManifest | null = null;
        if (existsSync(manifestPath)) {
          try {
            manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as RulesManifest;
          } catch {
            actions.push('rules-manifest: 损坏，按无 manifest 处理（adopt，不覆盖任何规则文件）');
            manifest = null;
          }
        }

        // 确保所有规则文件存在（任意 rules_mode 都先创建缺失文件）
        const allFilenames = ['godot-mcp.md', ...Object.keys(DETAILED_RULE_TEMPLATES)].sort();
        const diskFiles: { filename: string; content: string; source: 'base' | 'detail' }[] = [];
        for (const filename of allFilenames) {
          const filePath = join(rulesDir, filename);
          const source: 'base' | 'detail' = filename === 'godot-mcp.md' ? 'base' : 'detail';
          if (!existsSync(filePath)) {
            writeAtomic(filePath, currentTemplates[filename]);
            actions.push(`rules: created .claude/rules/${filename}`);
            diskFiles.push({ filename, content: currentTemplates[filename], source });
          } else {
            diskFiles.push({ filename, content: readFileSync(filePath, 'utf-8'), source });
          }
        }

        if (manifest === null) {
          // adopt（spec §5）：固化当前磁盘状态为基线
          const adopted = buildAdoptManifest({
            serverVersion: mcpVersion,
            now: new Date().toISOString(),
            files: diskFiles.map(f => ({ filename: f.filename, content: f.content, source: f.source })),
          });
          writeAtomic(manifestPath, JSON.stringify(adopted, null, 2));
          const dev = countDeviations(adopted, Object.fromEntries(
            diskFiles.map(f => [f.filename, hashContent(currentTemplates[f.filename])]),
          ));
          actions.push(`rules-manifest: 已采纳 ${diskFiles.length} 个文件（版本 ${mcpVersion}）`);
          if (dev > 0) {
            actions.push(`rules-manifest: ${dev} 个文件与当前模板不符（历史遗留或本地修改无法区分），如需对齐调 rules_mode=overwrite`);
          }
        } else {
          // reconcile（spec §3.6）：按二维判定 + mode 决策
          const plan = planReconcile({
            manifest,
            serverVersion: mcpVersion,
            diskFiles: diskFiles.map(f => ({ filename: f.filename, content: f.content })),
            currentTemplates,
            mode: rulesMode,
            now: new Date().toISOString(),
          });
          const written: string[] = [];
          const warned: string[] = [];
          for (const [filename, fp] of Object.entries(plan.actions)) {
            if (fp.action === 'write' && fp.newContent !== undefined) {
              writeAtomic(join(rulesDir, filename), fp.newContent);
              written.push(filename);
            } else if (fp.action === 'warn-keep') {
              warned.push(filename);
            }
          }
          if (plan.shouldWriteFiles) {
            writeAtomic(manifestPath, JSON.stringify(plan.newManifest, null, 2));
            if (written.length > 0) actions.push(`rules: 更新 ${written.length} 个文件（${written.join(', ')}）`);
            if (warned.length > 0) actions.push(`rules: 保留 ${warned.length} 个用户动过的文件（${warned.join(', ')}）— 版本过时但本地有修改，未覆盖；如需强制对齐调 rules_mode=overwrite`);
          } else {
            // check 模式：报告分类
            const byClass: Record<string, string[]> = {};
            for (const [fn, fp] of Object.entries(plan.actions)) {
              (byClass[fp.classification] ??= []).push(fn);
            }
            if (byClass['pure-upgrade']) actions.push(`rules: ${byClass['pure-upgrade'].length} 个文件可更新（版本过时）— 传 rules_mode=update 更新`);
            if (byClass['stale-and-modified']) actions.push(`rules: ${byClass['stale-and-modified'].length} 个文件版本过时且本地已修改 — update 会保留，overwrite 会覆盖`);
            if (byClass['local-modified']) actions.push(`rules: ${byClass['local-modified'].length} 个文件本地已修改（版本最新）`);
            if (byClass['latest'] && Object.keys(byClass).length === 1) actions.push('rules: 全部最新');
          }
        }
```

（删除原 :428-453 的 base/detail 创建冻结段，由上面统一接管。）

- [ ] **Step 4: 补真实 fs 集成测试 + 跑全量**

把 `test/tools/setup-project-rules-manifest.test.ts` 里 Step 1 的占位测试（`manifest 损坏` 那条）替换为真实驱动 setup_project_rules 的测试。由于 `setup_project_rules` 是 `project` 工具的 case 分支，直接单测需要构造 ToolContext。参考 `test/tools/project-scaffold.test.ts` 的现有写法（如何调用 setup_project_rules）。

若直接调用 case 太重，替代：用纯函数已覆盖逻辑（T1-T4），project.ts 集成靠手动验证 + 既有 project-scaffold 测试回归。在 `test/tools/project-scaffold.test.ts` 里补一个断言：setup_project_rules 后 `.claude/rules/.godot-mcp-manifest.json` 存在且 `rules_installed_at_version` 等于 package.json version。

Run: `npx vitest run test/tools/`
Expected: PASS

Run: `npx vitest run`（全量回归）
Expected: PASS — 无破坏

- [ ] **Step 5: 手动验证（spec §8 关键用例）**

在临时 Godot 项目验证端到端：
1. 全新项目调 `setup_project_rules` → 生成规则文件 + manifest，报告"已采纳 N 文件"
2. 手改 `godot-mcp-core.md`，再调 `setup_project_rules(rules_mode=check)` → 报告"1 个文件本地已修改"
3. 模拟版本过时：手改 manifest 的 `rules_installed_at_version` 为旧版本，调 `check` → 报告"可更新"
4. `update` → 覆盖未动过的，保留动过的
5. `overwrite` → 全覆盖
6. 删 manifest，再调 → adopt

- [ ] **Step 6: 提交**

```bash
cd D:/GitHub/godot-mcp-enhanced
git add src/tools/project.ts test/tools/setup-project-rules-manifest.test.ts
git commit -m "feat(rules): project.ts 集成 manifest + rules_mode（T6）"
```

---

## Task 7: CI 不变式检查脚本

**Files:**
- Create: `scripts/check-rules-version-bump.mjs`
- Modify: `.github/workflows/ci.yml` — 接入脚本

**Interfaces:**
- Consumes: git（`git show HEAD:<file>`、`git diff`）
- Produces: 模板源文件 hash 变更未伴随 package.json version bump 时 exit 1

- [ ] **Step 1: 写脚本**

创建 `scripts/check-rules-version-bump.mjs`：

```js
// scripts/check-rules-version-bump.mjs
// spec §4 不变式守护：规则模板源文件内容变更必须伴随 package.json version bump。
// baseline 取自 git 上个 commit（非工作区文件），比对插值前的源文件 hash。
//
// 用法（CI 或 pre-commit）：node scripts/check-rules-version-bump.mjs
// 退出码：0=通过 / 1=模板变了但版本没 bump

import { execSync } from 'child_process';
import { createHash } from 'crypto';

const TEMPLATE_FILES = [
  'src/tools/rule-templates.ts',
  'src/tools/claudemd-builder.ts',
];

function git(args) {
  return execSync(`git ${args}`, { encoding: 'utf-8' });
}

function hash(s) {
  return createHash('sha256').update(s, 'utf-8').digest('hex').slice(0, 16);
}

// 1. 比对模板源文件 hash（HEAD vs 工作区/index）
let templateChanged = false;
for (const f of TEMPLATE_FILES) {
  let headContent = '';
  let curContent = '';
  try {
    headContent = git(`show HEAD:${f}`);
    curContent = git(`show :${f}`);  // index 版本；若未 stage 则用工作区
  } catch {
    // 文件在 HEAD 不存在（新增）或未 stage，用工作区文件
    try { curContent = git(`show HEAD:${f}`) === undefined ? '' : ''; } catch {}
    try { headContent = git(`show HEAD:${f}`); } catch { headContent = ''; }
    try { curContent = require('fs').readFileSync(f, 'utf-8'); } catch { continue; }
  }
  if (hash(headContent) !== hash(curContent)) {
    templateChanged = true;
    console.error(`模板源文件已变更: ${f}`);
    break;
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
console.error('  这会导致用户 reconcile 时静默漏更新（spec §4 不变式）。');
console.error('  请 bump package.json version 后再提交规则模板改动。');
process.exit(1);
```

- [ ] **Step 2: 本地验证脚本判定逻辑**

验证"模板变 + 未 bump"被抓住：
```bash
cd D:/GitHub/godot-mcp-enhanced
# 临时改一个模板文件（加一行注释）
echo "// test" >> src/tools/rule-templates.ts
node scripts/check-rules-version-bump.mjs
# Expected: exit 1，输出 "✗ 规则模板内容已变更..."
git checkout src/tools/rule-templates.ts
```

验证"模板变 + 已 bump"通过：
```bash
# 改模板 + 改 package.json version（用 npm version patch）
echo "// test" >> src/tools/rule-templates.ts
npm version patch --no-git-tag-version
node scripts/check-rules-version-bump.mjs
# Expected: exit 0，输出 "✓ 规则模板变更已伴随..."
git checkout src/tools/rule-templates.ts package.json
```

- [ ] **Step 3: 接入 ci.yml**

读 `.github/workflows/ci.yml`，在现有 lint/test job 里加一步（在 test 步骤之前）：

```yaml
      - name: Check rules version bump（spec §4 不变式）
        run: node scripts/check-rules-version-bump.mjs
```

- [ ] **Step 4: 跑全量测试确认无破坏**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd D:/GitHub/godot-mcp-enhanced
git add scripts/check-rules-version-bump.mjs .github/workflows/ci.yml
git commit -m "ci(rules): 模板变更必伴随版本 bump 的不变式检查（T7）"
```

---

## Self-Review（写完后自查结果）

**Spec 覆盖**：
- §3.1 manifest 结构 → T1 类型 + T6 读写 ✓
- §3.2 base 加版本号 → T5 ✓
- §3.3 二维判定 → T3 classifyFile ✓
- §3.4 rules_mode 枚举 → T4 planReconcile + T6 inputSchema ✓
- §3.5 CRLF 归一化只算 hash → T1 normalizeForHash（测试明确"写磁盘不归一化"由 T6 的 readFileSync/writeAtomic 原样读写保证）✓
- §3.6 reconcile 流程（adopt/检测/update/overwrite）→ T6 ✓
- §4 不变式 + CI baseline（git 历史 + 插值前源文件）→ T7 ✓
- §5 adopt 语义 → T2 buildAdoptManifest + T6 adopt 分支 ✓
- §6 错误处理（manifest 损坏→adopt、writeAtomic 复用）→ T6 ✓
- §7 文件改动清单 → 全部对应 ✓
- §8 测试方案 → 各 Task 内嵌 + T6 集成 ✓

**占位符扫描**：T6 Step 1 有一个占位测试（`expect(true).toBe(true)`），已在 Step 4 明确"替换为真实 fs 集成测试"。其余无 TBD/TODO。

**类型一致性**：`RulesManifest`、`RulesMode`、`FileClassification`、`FileAction`、`ReconcilePlan` 在 T1-T4 定义、T6 消费，命名一致。`rules_installed_at_version` 字段名全文一致。`classifyFile` 返回的 4 个分类值（`pure-upgrade`/`stale-and-modified`/`latest`/`local-modified`）在 T3 定义、T4 消费、T6 报告，一致。
