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
- 设计要点：窗口直达目标调用。**不锚 `safeScene`**——validation.ts:542 注释含 "safeScene" 字样，非贪婪 `{0,600}?safeScene` 会截到注释就停，:549 的 `resolveWithinRoot` 调用落在窗口外致 `.test` 恒 false → return 1（spec r1 假红 bug，审查 CRITICAL ①）。改为以 `resolveWithinRoot(projectPath, normalized)` 作窗口终点；该调用全文仅 :549 一处，入参签名精确限定不误匹配其他 resolveWithinRoot 调用。

```ts
{ key: 'validation-run-and-verify-scene-traversal', status: 'fixed', severity: 'CRITICAL', dimension: 'Security',
  // 2026-07-22 RCE面复审P1: validation.ts run_and_verify 的 args.scene 直接 push 进 godot CLI
  // 加载项目外场景执行节点脚本(无 GD _sanitize_res_path 兜底)。
  // fix: normalizeUserProjectPath + resolveWithinRoot(projectPath, normalized) 仅校验。
  // 复发: 删 resolveWithinRoot 调用 → 窗口无终点 m=undefined → detect=1。
  detect: () => {
    const f = readSrc('src/tools/validation.ts');
    const m = f.match(/case 'run_and_verify'[\s\S]{0,1500}?\bresolveWithinRoot\(projectPath,\s*normalized\)/);
    return m ? 0 : 1;
  } },
```

### Detect ② `workflow-user-protocol-traversal`

- dimension: Security / severity: CRITICAL
- 文件：`src/tools/workflow.ts`
- 逻辑：`workflow.ts` 中 `hasTraversalSegments(` 出现次数 ≥ 3（对应 reference_path / frames_dir / bridge.screenshot.path 三处防护）。删任一处 → count<3 → detect=1。
- 设计要点：**只数调用点，排除函数定义**。workflow.ts 中 `hasTraversalSegments(` 实际出现 4 次：`:257` 函数定义 `(p: string)` + `:390(rawPath)`/`:515(rawReferencePath)`/`:584(rawFramesDir)` 三处调用。`hasTraversalSegments\(raw\w+` 用 `raw` 前缀只匹配调用参数，排除定义行。spec r1 的 `hasTraversalSegments\(` count≥3 在删一处调用时仍 count=3（定义+2 调用）假绿（审查 CRITICAL ②）。

```ts
{ key: 'workflow-user-protocol-traversal', status: 'fixed', severity: 'CRITICAL', dimension: 'Security',
  // 2026-07-22 安全审查: workflow.ts 三处 user:// 放行不校验 .. 段(reference_path:515 /
  // frames_dir:584 / bridge.screenshot.path:390), GD Image.load/DirAccess/bridge take_screenshot
  // 任意目录读/写。fix: 三处调用均加 hasTraversalSegments。复发: 任一处调用删 → raw count<3 detect=1。
  // 注: :257 函数定义 hasTraversalSegments(p:) 不匹配 raw 前缀, 故不计数。
  detect: () => {
    const f = readSrc('src/tools/workflow.ts');
    return (f.match(/hasTraversalSegments\(raw\w+/g) || []).length >= 3 ? 0 : 1;
  } },
```

## 5. 计数同步

- `test/regression/defects-fixed.test.ts`（spec r1 误写 `fixed.test.ts`，审查 IMPORTANT 1）：
  - `:113` `expect(FIXED_DEFECTS.length).toBe(97)` → `toBe(99)`
  - `:115` `expect(new Set(keys).size, '存在重名 key').toBe(97)` → `toBe(99)`
  - `:2` 注释「FIXED_DEFECTS 94 条」→ 99（顺手，纯文档）
  - `:20` it 名「覆盖 80 条」历史停更，**不影响断言**（:113/:115 才是真计数），defer 不改
- `test/regression/defects.ts` 分节注释（如 `:37`「FIXED（33 条）」`:1069`「OPEN（10 条）」）滞后但纯文档不影响功能，**可选清理不阻塞**（避免追兔子，审查 IMPORTANT 2 已知）

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
3. **RED 验证（两条 detect 必须各自能触发，否则假绿）**：
   - detect ①：临时注释 `validation.ts:549` 的 `resolveWithinRoot(projectPath, normalized)` 调用 → 正则窗口无终点 → `m=undefined` → `return 1`（触发）
   - detect ②：临时删 `workflow.ts:390` 的 `hasTraversalSegments(rawPath)` 调用 → raw 调用 count 3→2 < 3 → `return 1`（触发）
   - 两条各自确认 RED 后还原，重跑 GREEN
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
