# 设计：补 scene/workflow 路径越权 defects.ts detect

**日期**：2026-07-28
**类型**：测试加固（防回归 detect）
**范围**：纯测试文件 + 文档，**生产代码零改动**

## 1. 背景

2026-07-22 安全/RCE 面专项审查（含复审）登记了两条 P1 路径越权 finding：

- **① `validation.ts:538,543,560` run_and_verify scene 无 root 校验** —— 客户端传 `../../evil.tscn` 让 godot CLI 加载项目外场景执行节点脚本，**无 GD `_sanitize_res_path` 兜底**，路径越权确定 + 潜在 RCE。两轮 5 子代理共同遗漏的最重项。
- **② `workflow.ts` user:// 路径穿越三处** —— `reference_path`(:514) / `frames_dir`(:583) / `bridge.screenshot.path`(:388) 放行 `user://`/`res://` 不校验 `..` 段，GDScript `Image.load` / `DirAccess` / bridge `take_screenshot` 任意目录读/写。

审查报告原话「修复后须补 defects.ts detect 防复发」。

## 2. 现状核实（2026-07-28 源码亲验）

**安全防护本身已落地**（在 2026-07-23/24 批次 A/B 闭环时一并实现，但 Obsidian 待办 checkbox 未勾、defects detect 未补）：

| 项 | 防护位置 | 防护实现 |
|---|---|---|
| ① scene 越权 | `src/tools/validation.ts:541-551` | `normalizeUserProjectPath(scene)` + `resolveWithinRoot(projectPath, normalized)` 仅校验，注释含 "A2 scene 越权防护" + "I1 fix(2026-07-23 final review)" |
| ② reference_path | `src/tools/workflow.ts:514-519` | `startsWith('res://')‖startsWith('user://')` 分支内 `hasTraversalSegments(rawReferencePath)` |
| ② frames_dir | `src/tools/workflow.ts:583-588` | 同款 `hasTraversalSegments(rawFramesDir)` |
| ② bridge.screenshot.path | `src/tools/workflow.ts:388-392` | `!startsWith('user://') && !startsWith('res://')` 拒绝 + `hasTraversalSegments(rawPath)` |

defects.ts 现 **97 FIXED + 9 OPEN**（待办旧值 54 滞后），**无这两条的专门 detect**：
- `rce-create-scene-root-node-type-no-validation` 是 `create_scene` 的，非 run_and_verify scene
- `asset-factory-load-traversal` 是 addon `asset_factory.gd` 的，非 workflow.ts

## 3. 目标

给 ① ② 各加一条 defects.ts FIXED detect，使防护被误删时 CI 门禁触发（detect=1 → defects-fixed.test RED）。**不改动任何生产代码**。

## 4. 方案

采纳 **方案 A：计数/定位 grep detect**（对齐既有 97 条 `readSrc(...).includes/match` 风格），否决方案 B（精确正则逐处定位，正则脆弱、代码重构易误报）。

### Detect ① `validation-run-and-verify-scene-traversal`

- dimension: Security / severity: CRITICAL
- 文件：`src/tools/validation.ts`
- 逻辑：定位 `case 'run_and_verify'` 到 `safeScene` 窗口（≤600 字符），校验窗口内含 `resolveWithinRoot(projectPath, normalized)`。窗口消失或调用被删 → detect=1。
- 设计要点：用 `safeScene` 锚定窗口（run_and_verify 独有变量，不会与 validation.ts 其他 resolveWithinRoot 调用混淆）。

```ts
{ key: 'validation-run-and-verify-scene-traversal', status: 'fixed', severity: 'CRITICAL', dimension: 'Security',
  // 2026-07-22 RCE面复审P1: validation.ts run_and_verify 的 args.scene 直接 push 进 godot CLI
  // 加载项目外场景执行节点脚本(无 GD _sanitize_res_path 兜底)。
  // fix: normalizeUserProjectPath + resolveWithinRoot(projectPath, normalized) 仅校验。
  // 复发: 删 resolveWithinRoot 调用或 safeScene 分支结构改变 → detect=1。
  detect: () => {
    const f = readSrc('src/tools/validation.ts');
    const m = f.match(/case 'run_and_verify'[\s\S]{0,600}?safeScene/);
    if (!m) return 1;
    return /resolveWithinRoot\(projectPath,\s*normalized\)/.test(m[0]) ? 0 : 1;
  } },
```

### Detect ② `workflow-user-protocol-traversal`

- dimension: Security / severity: CRITICAL
- 文件：`src/tools/workflow.ts`
- 逻辑：`workflow.ts` 中 `hasTraversalSegments(` 出现次数 ≥ 3（对应 reference_path / frames_dir / bridge.screenshot.path 三处防护）。删任一处 → count<3 → detect=1。
- 设计要点：计数模式对齐既有 detect（如 `health-monitor-error-type-misdegrade` 用 includes、`asset-factory-load-traversal` 用 includes）。三处防护点是 workflow.ts 内 hasTraversalSegments 的全部合法出现，count≥3 不会因未来合法新增而假绿（新增只会让 count>3 仍 PASS）。

```ts
{ key: 'workflow-user-protocol-traversal', status: 'fixed', severity: 'CRITICAL', dimension: 'Security',
  // 2026-07-22 安全审查: workflow.ts 三处 user:// 放行不校验 .. 段(reference_path:514 /
  // frames_dir:583 / bridge.screenshot.path:388), GD Image.load/DirAccess/bridge take_screenshot
  // 任意目录读/写。fix: 三处均加 hasTraversalSegments。复发: 任一处删 → count<3 detect=1。
  detect: () => {
    const f = readSrc('src/tools/workflow.ts');
    return (f.match(/hasTraversalSegments\(/g) || []).length >= 3 ? 0 : 1;
  } },
```

## 5. 计数同步

- `test/regression/fixed.test.ts`：FIXED 期望值 97 → 99（OPEN 9 不变）
- `test/regression/defects.ts` 顶部注释计数同步（若有自述计数）

## 6. 文档勾选（Obsidian，非代码）

`D:\workspace\Obsidian\GodotMCP\项目待办.md`：
- ① ② 两项 checkbox `[ ]` → `[x]`（位于「安全/RCE 面专项审查」与「复审 P1 validation.ts」「复审 P2 workflow.ts」条目）
- ③ C4 nav bake 已闭环标注（deferred → resolved @ `eb439a9`，2026-07-28 SDD）
- 校准 defects 计数 54 → 99 FIXED + 9 OPEN（多处旧值）
- 标注真实闭环：① ② 防护在 2026-07-23/24 批次 A/B、③ C4 在 2026-07-28 SDD

## 7. 测试策略（TDD，防假绿）

defects.ts 全是静态 grep（memory `[[defects-static-grep-limit]]` 已知局限），但本次 detect 防的是"防护代码被删"这一具体复发模式，静态 grep 是恰当粒度。关键：必须 RED 验证非假绿。

1. 写两条 detect（status: 'fixed'）
2. 跑 `defects-fixed.test` → 应 PASS（防护已在）→ GREEN
3. **RED 验证**：临时注释掉 `validation.ts:549` 的 `resolveWithinRoot` 调用 → 跑 detect ① 应 = 1（触发）；临时删 `workflow.ts` 一处 `hasTraversalSegments` → detect ② 应 = 1；确认后还原
4. 全量 `vitest run` 绿 + `tsc --noEmit` 0

## 8. 非目标（YAGNI）

- 不补 ② 的复审 P2 子项 detect（`workflow.ts:701` batch_validate scripts / `data-import.ts:298` class_path）——这些是 C-04 范畴 advisory，非本次范围。
- 不改 defects.ts 其他过时计数（如 defects-fixed.test.ts:20 it 名「80 条」历史停更，已记 Minor defer）。
- 不动 ③ C4 实现（已闭环）。

## 9. 风险

低。纯 test 文件 + Obsidian 文档，生产代码零改动。唯一风险是 detect 正则与代码结构耦合（代码重构误报），通过窗口锚定 + RED 验证缓解。

## 10. 验收

- [ ] 两条 detect 入 defects.ts，status: 'fixed'，注释含 fix 描述 + 复发条件
- [ ] defects-fixed.test PASS（FIXED 99）
- [ ] RED 验证两条 detect 各自能触发（非假绿），还原后 GREEN
- [ ] 全量 vitest 绿 + tsc 0
- [ ] Obsidian 待办三项勾选 + 计数校准
- [ ] final review（opus）Ready
