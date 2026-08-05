# P0-6 — 工具表分层压缩 + help 按需展开

**状态**：草案 / 待评审
**优先级**：P0
**所有者**：tool-registry / context 工具组
**关联调研**：`docs/plans/2026-08-05-mcp-ecosystem-research-and-upgrade-plan.md`（参考 `n24q02m/better-godot-mcp` 的 `src/tools/registry.ts` + `src/tools/composite/help.ts`）

## 1. 背景与目标

当前 enhanced `tools/list` 总量约 ~17000 tokens（capability-matrix 总 ~68000B ÷ 4）。`scripts/check-token-budget.mjs` 的当前阈值 `totalSum.warn=80KB / error=120KB` 已经偏松，对照 better-godot-mcp 的 ~4000 tokens，enhanced 上下文预算有近 4× 浪费。

better-godot-mcp 用三层压缩（核心层展开 action 清单 / 领域层单行 / help 工具按需展开完整文档），把上下文成本从工具数量增长中解耦。

**目标**：从 ~17000 tokens 压到 ~8000-10000 tokens（省 40-50%），同时通过 help 工具保证 LLM 仍能在需要时取回完整文档。

## 2. 三层压缩策略

| 层级 | 描述形态 | 工具数 | 单工具 token |
|------|---------|--------|-------------|
| **P0 核心层** | description 含完整 action 清单（保留 enum） | ~10 | 600-1500 |
| **P1 领域层** | description 单行 + `Use help tool for full docs` 重定向 | ~15 | 80-200 |
| **P2 低频层** | description 单行 + help 重定向（schema 最小化） | ~11 | 80-200 |
| **help 工具** | 传 `tool_name`（enum）返回 `docs/tools/{name}.md` | 1 | ~300 |

**核心洞察**：当前 ~17000 tokens 主要来自 P1/P2 工具的完整 `inputSchema`（如 animation 的 30+ 参数、material 的 enum 列表）。这些工具在 90% 的会话中不被调用，却每次都在 `tools/list` 里付费。

## 3. 工具分层建议（基于 enhanced 36 工具）

> [!warning] 修订（B-2，2026-08-05）
> 原版 §3 三层表任一层都没 `editor`，但 `docs/capability-matrix.json:1404` 实测有 `editor` 工具（editor 模式入口，含 sync_start/sync_stop/get_scene_tree 三 action）。属元连接工具，已补入 P0 核心层。注意：原版 §4 enum 也漏 `editor`（实测 35 项），加上 `editor` 后为 36 项，加上 `help` 后为 37 项。

> **重要前置**：以下分层是**初步建议**，最终分层必须基于真实调用频率数据。spec 推荐执行顺序：
> 1. 先在 `manage_tools.ts` 加埋点，统计 7 天内每工具的调用次数
> 2. 用统计结果校准分层（高频→P0，中频→P1，长尾→P2）
> 3. 再做 description 压缩

| 层级 | 工具（初步建议） | 理由 |
|------|----------------|------|
| **P0 核心层** | `project`, `scene`, `script`, `node`(归并到 scene), `runtime`, `validation`, `godot_get_context`, `manage_tools`, `screenshot`, `game`, `help`, **`editor`** | 高频 + 元工具 + 元连接（editor 是 editor 模式场景树实时同步入口） |
| **P1 领域层** | `animation`, `animation_track`, `animtree`, `material`, `particles`, `ui`, `tilemap`, `signal`, `audio`, `physics`, `nav`, `asset` | 中频，单工具调用集中时取回 docs |
| **P2 低频层** | `cpp`, `docs`, `load_skill`, `profiler`, `workflow`, `blender`, `android`, `csv_to_resources`, `testing`, `self_update`, `godot_advanced_tool`, `godot_list_dynamic_routes`, `godot_list_instances`, `godot_select_instance` | 长尾，多数会话不触达 |

## 4. help 工具设计

参考 `n24q02m/better-godot-mcp/src/tools/composite/help.ts`：

```typescript
// src/tools/help.ts
// 实测 36 项（capability-matrix 含 editor），加 help 自身后 37 项。
const TOOL_NAMES = [
  'project','scene','script','runtime','validation',
  'godot_get_context','manage_tools','screenshot','game','editor',
  'animation','animation_track','animtree','material','particles',
  'ui','tilemap','signal','audio','physics','nav','asset',
  'cpp','docs','load_skill','profiler','workflow','blender',
  'android','csv_to_resources','testing','self_update',
  'godot_advanced_tool','godot_list_dynamic_routes',
  'godot_list_instances','godot_select_instance',
] as const;   // 36 项（原版漏 editor 实测 35 项，已补）

type HelpInput = {
  tool_name: typeof TOOL_NAMES[number];   // enum 限定，防拼写错
};

// 实现
function getHelp({ tool_name }: HelpInput): ToolResult {
  const docPath = `docs/tools/${tool_name}.md`;
  if (!existsSync(docPath)) {
    // 拼写纠错：unknown tool 时返回 "Did you mean 'X'?"
    const suggestion = findClosestMatch(tool_name, TOOL_NAMES);
    return textResult(`Unknown tool '${tool_name}'. Did you mean '${suggestion}'?`);
  }
  return textResult(readFileSync(docPath, 'utf8'));
}

// findClosestMatch：Levenshtein 距离 ≤2 取最近，否则返回 null
```

**docs 目录约定**：`docs/tools/{name}.md` 每个工具一个文件，含完整 action 清单、参数表、示例、错误码、关联工具。文档与工具漂移由 CI 校验（见下）。

## 5. 改动清单

> [!warning] 修订（B-1/B-2，2026-08-05）
> 原版 §5 漏列 `docs/capability-matrix.{json,md}` 加 tier 字段（原只在 §8 提了一句），也漏列 help 工具新增触发的工具数下游同步。已补全。

### 5.1 直接改动

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/core/tool-registry.ts` | 修改 | 每个工具加 `tier: 'P0' \| 'P1' \| 'P2'` 字段（先用初步建议，后续按调频校准） |
| `src/core/module-loader.ts` | 修改 | 注册时按 tier 决定 description 形态：P0 原样、P1/P2 压缩为单行 + help 重定向；新增 help 模块到 `ALL_MODULES` |
| `src/tools/help.ts` | 新建 | help 工具实现，含 `findClosestMatch` 拼写纠错（`TOOL_NAMES` enum 见 §4，36 项含 editor） |
| `docs/tools/*.md` | 新建 | **37 个单工具文档**（36 个现有工具 + 1 个 help 自身；从现有内联 description + capability-matrix 提取） |
| `scripts/check-token-budget.mjs` | 修改 | 加 per-tier 阈值：`P0: desc ≤1500B`，`P1/P2: desc ≤300B`，`total ≤40KB` |
| `scripts/check-tool-docs-sync.mjs` | 新建 | CI 校验：每个工具都有对应 `docs/tools/{name}.md`，且文档与 `tool-registry` 元数据不漂移 |
| `scripts/check-call-frequency.mjs` | 新建（可选） | 7 天调用频率统计 → 自动建议 tier 调整 |
| `src/tools/manage-tools.ts` | 修改 | 加调用埋点，记录 `call_log_{tool}_{date}.jsonl` |
| `docs/capability-matrix.{json,md}` | 修改 | **加 `tier` 字段到每个工具条目**（原版只在 §8 提了一句，移到改动清单正式落地）；同时 `npm run build-matrix` 重建（含新增的 help 工具） |
| `scripts/build-matrix.mjs` | 修改 | tier 字段从 tool-registry 元数据读取并写入 capability-matrix |

### 5.2 工具数变更触发的下游同步（B-1，AGENTS.md 强制）

help 工具新增后工具数 **36 → 37**（若与 P0-5 的 5 个 runtime_assert 工具合并落地，最终为 42）。必须同步：

| 文件 | 改动 | 依据 |
|------|------|------|
| `docs/capability-matrix.{json,md}` | `npm run build-matrix` 重建（含 help 工具 + tier 字段） | AGENTS.md「完成前强制检查」§5 |
| `src/tools/rule-templates.ts:24` | "36 个 MCP 工具" → "37 个 MCP 工具"（实测当前为 36） | AGENTS.md:280 |
| `.claude/rules/godot-mcp-core.md:10` | 同步（独立副本，AGENTS.md:374-381） | 独立副本同步约束 |
| `README.md` / `README.en.md` / `manifest.json` / `docs/distribution/*` / `docs/migration-from-coding-solo.md` | 9 文件共 17 处工具数同步（`scripts/check-tool-count.mjs:48-112` 校验） | AGENTS.md「完成前强制检查」§5 |
| `src/tools/agentsmd-builder.ts` | 若分发 AGENTS.md 含工具数也需同步 | 分发产物边界 |

> 注：若 P0-5 先落地（36→41），P0-6 落地时基线变为 41，最终 42；若 P0-6 先落地（36→37），P0-5 落地时基线变为 37，最终 42。落地顺序不影响最终值，但需协调避免重复 rebuild。

## 6. 验收标准

1. `tools/list` 总 token 从 ~17000 降到 ~10000 以下（用 `scripts/check-token-budget.mjs` 测，total ≤ 40KB）。
2. P1/P2 工具的 description 均含字样 `Use help tool for full docs`。
3. help 工具能返回任意 **37 个工具**（36 现有含 editor + 1 个 help 自身）的完整文档（`docs/tools/{name}.md` 存在且非空）。
4. 拼写错误时（如 `tool_name: "animaton"`）help 返回 `Did you mean 'animation'?`，不返回空。
5. **LLM 工具选择准确率不下降**：实测 `test/e2e-full-tool-verification.test.ts` 只验工具可发现（tools/list 完整性），**不验 agent 选工具准确率**。验收方式改为：人工评估 5 个典型任务压缩前后 agent 首次选对工具的比率（基线任务集示例：「读取场景树」「修改节点属性」「跑 GDScript 片段」「铺 TileMap」「调用 undo」），允许 P1/P2 工具首次调用前多一次 help 调用，但首次选对率不应下降。
6. CI 通过 `check-tool-docs-sync.mjs`：任何工具新增/重命名必须同步文档。

## 7. 风险评估

| 风险 | 等级 | 缓解 |
|------|------|------|
| **分层后 LLM 找不到低频工具** | 高 | (1) help 工具的 enum 限定让 LLM 知道全部可用工具名；(2) P1/P2 description 末尾的 `Use help tool for full docs` 是显式重定向；(3) `godot_get_context` 的推荐 workflow 应列常用领域工具入口 |
| **docs 与实际工具漂移** | 中 | `check-tool-docs-sync.mjs` 进 CI；工具元数据变更时强制同步文档（exit 1） |
| **调用频率数据缺失，分层不合理** | 中 | 初步用经验分层上线，同时埋点 7 天后基于真实数据校准（spec 显式说明这是迭代过程） |
| **findClosestMatch 召回不准** | 低 | 限定 Levenshtein ≤2，否则返回 null 而非错误建议；保留"未找到，列出全部工具"兜底 |
| **P0 工具 description 仍过长** | 低 | P0 层的 description 阈值放宽到 1500B；若仍超需进一步拆 action 子组 |

## 8. 与其他 P0 的关系

- **P0-5（runtime_assert 工具）**：5 个新工具按调频归类——`runtime_assert_node_state` 进 P0 核心层（高频验证），其余 4 个进 P1/P2。**P0-6 不阻塞 P0-5**，但 **P0-5 落地后需回填 P0-6 的 help enum**：把 5 个 runtime_assert 工具名补入 `src/tools/help.ts` 的 `TOOL_NAMES` 数组，并新建对应的 `docs/tools/runtime_assert_*.md` 文档。
- **capability-matrix**：分层后 `docs/capability-matrix.json` 加 `tier` 字段（已移入 §5 改动清单正式落地），`npm run build-matrix` 同步更新。

---

## 修订记录

| 日期 | 修订项 | 对应审查报告 Issue |
|------|--------|------------------|
| 2026-08-05 | §3 分层表补 `editor` 工具到 P0 核心层（实测 `capability-matrix.json:1404` 有该工具，原版漏列） | B-2 |
| 2026-08-05 | §4 `TOOL_NAMES` enum 补 `editor`（原版 35 项，实测应为 36 项；加上 help 自身为 37 项） | B-2 |
| 2026-08-05 | §6 验收 3 "36 个工具" → "37 个工具"（含 editor + help 自身） | B-2 |
| 2026-08-05 | §5 改动清单补 `docs/capability-matrix.{json,md}` 加 tier 字段（原版只在 §8 提了一句，未列入改动清单） | 自查 |
| 2026-08-05 | §5 改动清单补"工具数变更下游同步"小节（rule-templates.ts / .claude/rules/godot-mcp-core.md / README 等 9 文件 17 处 / build-matrix / agentsmd-builder.ts） | B-1 |
| 2026-08-05 | §6 验收 5 修正：去掉"跑现有 e2e 测试集（如有）"的 hedge，明确 `test/e2e-full-tool-verification.test.ts` 只验工具可发现不验选择准确率，改为人工评估 5 个典型任务的首次选对率 | N-4 |
| 2026-08-05 | §8 依赖关系修正："无下游依赖"改为"P0-6 不阻塞 P0-5，但 P0-5 落地后需回填 P0-6 的 help enum" | 维度 6 |
