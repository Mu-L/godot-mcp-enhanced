# get_node_layout 第三方审查报告

**日期**：2026-07-27
**审查对象**：`get_node_layout` method 实现链路（4 commit）
**审查者**：独立 code-reviewer 子 agent（隔离视角，不预设 plan 作者声明为真）+ 主 agent 复核
**审查范围**：spec / plan / 代码实现 / 测试 / 文档同步 / 验证完整性

## 审查对象 commit 清单

| commit | 说明 |
|--------|------|
| `79ef9f0` | docs(spec): get_node_layout 设计 |
| `6bb3c58` | docs(plan): get_node_layout 实施计划 |
| `a1f6b50` | feat(bridge): get_node_layout GD 实现 + L2 字段测试 |
| `f22a6a5` | feat(bridge): get_node_layout TS 白名单 + schema + matrix |
| `3d11541` | docs(bridge): get_node_layout method 表 + engine-quirks 补强 |

---

## 总体判定

**BLOCKING ISSUES**（已交付，但合并/发版前须修 1 处）

GD/TS/测试/matrix 链路实现质量高且忠于 spec，但 commit `3d11541` 的文档改动违反 `AGENTS.md:354` 明文规定的「独立副本同步约束」—— `.claude/rules` 改了 `get_node_layout`，但 `src/tools/rule-templates.ts` 没同步。前序 opus final review 漏抓此条。

**主审查 agent 已独立复核 B-1 成立**（grep `rule-templates.ts` 命中 0 处，`.claude/rules/godot-mcp-bridge.md:34` 已改）。

---

## A. 设计正确性 — ✅ 全部成立

逐条核查 `D:\GitHub\godot-mcp-enhanced\src\scripts\mcp_bridge.gd` 的 `_cmd_get_node_layout`（`:736`）：

| spec 声明 | 实测 | 证据 |
|----------|------|------|
| Control 14 属性全部读取 | ✅ | `:754-765` 11 项布局字段 + 上层 4 项变换字段 = 15 项读取点，属性名全拼对 |
| `visible` 横切（CanvasItem 或 Node3D） | ✅ | `:744 if node is CanvasItem or node is Node3D` |
| Sprite2D 独立 `if` 非 `elif` | ✅ | `:767 if node is Sprite2D:`（非 elif），`:766` 注释明示 |
| Node3D 不误命中 Sprite2D | ✅ | Sprite2D 是 Node2D 子类（非 Node3D），`:770 if node is Node3D` 对 Sprite2D 为 false |
| `global_position` ZERO 警示注释 | ✅ | `:775` 注释在位 |
| 序列化全走 `_jsonify` | ✅ | `:750-773` 全走 `_jsonify`，Vector2/Vector3/Rect2/float 各走对应分支 |

**A 项结论**：实现严格忠于 spec §3.2 字段分层，无打错属性名、无逻辑分支错误。

---

## B. TS 白名单一致性 — ✅ 全部成立

核查 `D:\GitHub\godot-mcp-enhanced\src\tools\game-bridge.ts`（主审查 agent grep 复核）：

| spec/plan 声明 | 实测 | 证据 |
|----------------|------|------|
| 三处加 `get_node_layout` | ✅ | `:384` schema / `:414` QUERY_METHODS / `:420` BRIDGE_READ_ONLY_METHODS |
| QUERY_METHODS 加 `export` | ✅ | `:413 export const QUERY_METHODS` |
| 白名单运行时强制 | ✅ | `:635 if (!allowed.has(method))` + `:629 game_query: QUERY_METHODS` |
| 单测覆盖两集合 | ✅ | `test\game-bridge-get-node-layout.test.ts:5-10` 两个 `has` 断言 |
| 额外：`.size` 基数锁定 | ✅ 加分 | `test\workflow.test.js:98` 把 size 从 6 改 7（比 plan 更严的回归守护） |

**B 项结论**：白名单链路完整，单测且额外加了 `.size` 基数断言（plan 没要求但更优）。

---

## C. L2 测试质量 — ✅ 合规（字段正确性实测 deferred，已知契约化）

核查 `D:\GitHub\godot-mcp-enhanced\test\e2e-bridge-get-node-layout.test.ts`（181 行）：

| spec §6.2 / plan Task 2 要求 | 实测 |
|------------------------------|------|
| 文件头契约声明「L2 本地不在 CI」 | ✅ `:1-10` |
| 7 条字段语义断言 | ✅ `:130-169` 4 个 it 全覆盖 |
| 不硬编码路径（用 find_nodes 动态发现） | ✅ `:85-94 findNodePath` |
| skipIf 守卫 | ✅ `:28 RUN` + `:103 describe.skipIf` |
| afterAll 清理（kill 进程 + 还原 project.godot + 删 secret） | ✅ `:171-180` |
| Sprite2D 跳过场景诚实标注 | ✅ `:144` 注释自承 real-project 无 Sprite2D |

**C 项结论**：测试代码质量合规。**无法核实**字段正确性实测（L2 本地才能跑 + 环境无 Godot）—— 按 spec §6.4 这是已契约化的诚实 deferred，非隐藏 gap。

---

## D. 部署同步 — ✅ 全部成立

| spec §5 声明 | 实测 | 证据 |
|--------------|------|------|
| mcp_bridge.gd 分发到项目根（非 addons/） | ✅ | `game-bridge.ts:555 destScript = join(projectPath, BRIDGE_SCRIPT_NAME)` |
| 默认分支友好错误保持 code: -32601 | ✅ | diff line 224→225，code 未变、仅扩 message、error dict 结构未变 |
| command-level error 提升机制未受影响 | ✅ | `:585-587` 仍在 |

**D 项结论**：部署机制与本仓库设计一致。

---

## E. 文档同步（独立副本约束）— 🟢 B-1 已修复（2026-07-27）

> **2026-07-27 修复回标**：B-1 已在分支 `fix/get-node-layout-rule-templates-sync` 修复。`rule-templates.ts:129` method 表加 get_node_layout 行 + `:664-668` 补「节点定位与坐标实测」整段（含 Node3D.scale bullet 顺手补 ★ 标记，修 N-1）+ version 0.24.0→0.24.1 + `npm run build` 同步 `build/tools/rule-templates.js` + lint/build/test 全绿（4093 passed）。修复过程发现新 lesson 见 memory `edit-tool-backtick-escaping-pitfall`。原 BLOCKING 描述保留如下供追溯。

---

## E. 文档同步（独立副本约束）— 🔴 BLOCKING（原状态，已修复见上）

**约束出处**：`AGENTS.md:354`「`.claude/rules/godot-mcp-*.md` 与 `src/tools/rule-templates.ts` 是两份独立副本…改动规则时必须手动同步两处」+ `AGENTS.md:359`「CI 脚本 `check-rules-version-bump.mjs` 不校验内容一致性——内容同步靠人工」。

### B-1（BLOCKING）：`rule-templates.ts` 未同步 `.claude/rules` 的 get_node_layout 改动

**主审查 agent 独立 grep 复核**：

```
grep -c "get_node_layout" src/tools/rule-templates.ts → 0
.claude/rules/godot-mcp-bridge.md:34 已改
```

**两处 drift**：

1. **method 表漏同步**
   - `.claude/rules/godot-mcp-bridge.md:34` 新加了 `| get_node_layout | ... |`
   - `src/tools/rule-templates.ts:129` 仍是 `| get_node_properties | ... |` 紧接 `:130 | get_performance |`，**缺 get_node_layout 行**
2. **engine-quirks 整段漏同步**
   - `.claude/rules/godot-mcp-engine-quirks.md:51-55` 新增整段 `## 节点定位与坐标实测`
   - `src/tools/rule-templates.ts:608-662` engine-quirks 模板**完全没有此段**

**影响**：`rule-templates.ts` 是 `setup_project_rules` 工具分发到**所有目标 Godot 项目**的模板源（`AGENTS.md:349`）。漏同步意味着新项目 / reconcile 后的现有项目，其 `.claude/rules/godot-mcp-bridge.md` 不会有 `get_node_layout` 行 —— AI 在这些项目里不会主动用 `get_node_layout`，spec §1 治本目标（教训闭环）失效。

**为何前序 opus final review 漏抓**：progress.md:609 自述「spec coverage 100% 无 gap」—— reviewer 只对照 spec §4 改动清单打勾，但 spec §4 改动表本身**只列了 `.claude/rules` + `capability-matrix`，没列 `rule-templates.ts`**（spec 作者也漏了）。CI 不会抓：`check-rules-version-bump.mjs:16-19` 只 watch rule-templates.ts 变更，本 PR 未改它 → 静默放过。

**修复方向**（本 review 文档只记录，不实施 —— 是否实施由用户决定）：

1. `rule-templates.ts:129` 后插入 method 表行（逐字抄 `.claude/rules/godot-mcp-bridge.md:34`）
2. `rule-templates.ts:661`（`## 导航` 段后、反引号闭合前）追加 `## 节点定位与坐标实测` 段（逐字抄 `.claude/rules/godot-mcp-engine-quirks.md:51-55`）
3. 改 `rule-templates.ts` 后须 `npm version patch --no-git-tag-version`（否则 `check-rules-version-bump.mjs:92-96` 会拦）+ `npm run build`

**置信度**：95（AGENTS.md 明文 + 主 agent grep 复核 + diff 清单 9 文件不含 rule-templates.ts 三源互证）

---

## F. capability-matrix — ✅ 全部成立

| spec/plan 声明 | 实测 | 证据 |
|----------------|------|------|
| `get_node_layout` 真出现在 matrix | ✅ | `docs/capability-matrix.json:1511` 含 get_node_layout |
| matrix 同步靠 schema description 自动 | ✅ | `npm run build-matrix` 从 schema 生成，description 加文本即同步 |
| `docs/capability-matrix.md` 同步 | ✅ | token 预算增量与 description 加 17 字节合理对齐 |

---

## G. 验证完整性 — ✅ plan 声明的验证大都有证据

| 验证项 | 实测 |
|--------|------|
| Task 0 Control 14 属性 gate | ✅ progress.md:603 记录 MISSING 空（无法独立跑 Godot 4.7 CLI 复现） |
| L2 契约写进测试头 | ✅ `test/e2e-bridge-get-node-layout.test.ts:1-10` |
| L2 实跑 + CardGame2 教训闭环 | ⚠️ deferred（progress Task 2/4 + spec §6.4 明示），非隐藏 |
| 4 commit 验证命令 | ✅ tsc + 单测 + check:gdscript + build 均有执行证据 |
| final review 质量 | 🔴 opus final review 漏抓 B-1（本审查的增量发现） |

---

## Nits（建议改但不阻塞）

| # | 问题 | 位置 |
|---|------|------|
| N-1 | engine-quirks 的 Node3D.scale bullet 缺 ★ 高频标记（前两 bullet 都有） | `.claude/rules/godot-mcp-engine-quirks.md:55`（同步时也补 `rule-templates.ts`） |
| N-2 | method 表行说明偏长（60+ 字，他行多 20 字内） | `.claude/rules/godot-mcp-bridge.md:34` |
| N-3 | L2 Sprite2D 用例在 real-project fixture 永远跳过（无 Sprite2D 节点），P3 叠加层实测守护为空 | `test/e2e-bridge-get-node-layout.test.ts:144` |
| N-4 | spec §3.2 NODE_NOT_FOUND 草稿写法（字符串）与实现（嵌套 dict）不一致—— 实现更优但 spec 未回同步 | `docs/superpowers/specs/2026-07-27-get-node-layout-design.md` §3.2 |
| N-5 | Task 0 gate 输出未落盘成可复查证据 | progress.md:603 |

---

## 值得记忆的工程教训（→ 已进 memory）

1. **「独立副本同步约束」是 CI 盲区**：`AGENTS.md:354` + `check-rules-version-bump.mjs` 不校验内容 → 凡 commit 改 `.claude/rules/godot-mcp-*.md`，review checklist 必须强制 grep `src/tools/rule-templates.ts` 对应段
2. **final review 不能只对照 spec/plan 改动清单打勾**：spec §4 改动面表本身漏列 `rule-templates.ts`，reviewer 必须独立核查仓库级约束（AGENTS.md）而非只核查 spec 级清单
3. **「诚实 deferred」优于「假绿」**：本 PR L2 实跑 + 教训闭环明确 deferred，让 reviewer 能精准定位「无法核实」边界
4. **集合基数断言（`.size` 锁定）比成员断言更防回归**：`test/workflow.test.js:98` 锁 BRIDGE_READ_ONLY_METHODS.size=7，未来静默增删立刻红
5. **GDScript command-level error 用嵌套 dict**：`{"error":{"code","message"}}` 能被 `mcp_bridge.gd:585-587` 提升机制捕捉到 top-level，新增 bridge method 时 NODE_NOT_FOUND 等应沿用此形态

---

## 相关文件（绝对路径）

- 实现：`D:\GitHub\godot-mcp-enhanced\src\scripts\mcp_bridge.gd`（`:532-533` match / `:580-581` 默认错误 / `:736-776` 函数体）
- TS：`D:\GitHub\godot-mcp-enhanced\src\tools\game-bridge.ts`（`:384` schema / `:413-422` 两白名单 / `:555` install / `:635` 强制）
- 测试：`D:\GitHub\godot-mcp-enhanced\test\game-bridge-get-node-layout.test.ts` / `test\e2e-bridge-get-node-layout.test.ts` / `test\workflow.test.js:88-99`
- 文档：`.claude\rules\godot-mcp-bridge.md:34` / `.claude\rules\godot-mcp-engine-quirks.md:51-55`
- **B-1 修复目标**：`D:\GitHub\godot-mcp-enhanced\src\tools\rule-templates.ts:129`（method 表）+ `:608-662`（engine-quirks 模板）
- 约束出处：`D:\GitHub\godot-mcp-enhanced\AGENTS.md:354-359` / `scripts\check-rules-version-bump.mjs:16-19`

---

## 审查者署名

- **独立审查**：code-reviewer 子 agent（agent_4970a0c5-df1d-403a-a536-f60eff240b2b）
- **复核**：主 agent（grep 复核 B-1 成立）
- **限制声明**：L2 字段正确性实测 + Task 0 gate 复现两项无法核实（环境无 Godot），按 spec §6.4 契约接受为 deferred
