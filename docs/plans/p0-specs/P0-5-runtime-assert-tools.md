# P0-5 — runtime_assert 提升为 first-class 工具

**状态**：草案 / 待评审
**优先级**：P0
**所有者**：runtime 工具组
**关联调研**：`docs/plans/2026-08-05-mcp-ecosystem-research-and-upgrade-plan.md`（Plane C 参考 `jlivingston-Cipher/godot-breakpoint-mcp`）

## 1. 背景与目标

当前 enhanced 的断言逻辑嵌在 `workflow.dev_loop` 的 `acceptance` 字段内部（见 `src/tools/workflow.ts:135-164` 及 `:434-653`，含 frame_degradation 568-619 和 gdscript default 621-643），agent 必须走完整的 `dev_loop` 执行流程才能触达断言能力。

`jlivingston-Cipher/godot-breakpoint-mcp` 的 Plane C `runtime_assert_*` 工具采用的是另一种设计：**断言工具独立可调用，任意时刻验证**。一个 failed assertion 距离"为什么失败"只有一次 `dbg_*` 调用的距离，不需要重新走一遍 workflow。

**目标**：把 enhanced 现有的 `acceptance.assertions` 逻辑从 workflow 内部提取为 5 个 first-class MCP 工具，agent 可以在任意时刻（运行中游戏、已加载场景、headless 验证）直接调用，不必编排 `dev_loop`。

## 2. 工具清单与接口

> [!warning] 修订（B-1/R-fail/N-1，2026-08-05）
> 原版"5 个工具统一标注 readOnly"不准确。`runtime_screenshot_diff` 调用 `sendToBridge('take_screenshot', { path: 'user://mcp_assert_screenshot.png' })`，`runtime_assert_perf` 也依赖 proof-bundle 写帧到磁盘——**两者会写盘**。已按下表分类标注。`runtime_assert_screen_text` 原描述含"OCR"是过度声明，已修正。

按写盘行为分类标注 `readOnly`：

| 新工具 | 输入参数 | 逻辑来源 | 运行模式 | readOnly |
|--------|---------|---------|---------|----------|
| `runtime_assert_node_state` | `path`, `expect`, `tolerance?` | 提取自 `src/tools/frame-verify/assert-protocol.ts` + workflow 内 GDScript 断言 | headless / runtime | ✓ 纯查询 |
| `runtime_assert_scene_structure` | `expect: [{path, type?, absent?}]` | 提取自 workflow 内 GDScript 断言 | headless / runtime | ✓ 纯查询 |
| `runtime_assert_screen_text` | `text`, `present?`, `regex?`, `case_sensitive?`, `min_count?` | **新增**（依赖 game-bridge `find_ui_elements`，按节点 name/text 属性匹配，**非图像 OCR**） | runtime only | ✓ 纯查询 |
| `runtime_assert_perf` | `baseline`, `tolerance?`, `direction?` | 提取自 `src/tools/frame-verify/degradation.ts` | runtime only | ✗ **会写盘**（proof-bundle 帧序列输出到项目 proof 目录） |
| `runtime_screenshot_diff` | `reference`, `tolerance?`, `per_channel_threshold?`, `region?` | 提取自 workflow `screenshot_diff` + `proof-bundle.ts` | runtime only | ✗ **会写盘**（截图落盘到 `user://mcp_assert_screenshot.png` + 项目 proof 目录） |

**风险等级标注**：3 个纯查询类工具 `riskLevel: 'read'`；2 个写盘类工具 `riskLevel: 'write-temp'`（如该等级不存在则用 `'write'` 并在描述中注明"写临时文件到 user:// 和项目 proof 目录，不修改场景树"）。失败时统一返回结构化 `mismatch`，不是单纯字符串。

### 2.1 接口伪代码

```typescript
// 通用失败返回（参考 breakpoint "a failed assertion is one dbg_* step from why"）
interface AssertResult {
  passed: boolean;
  matched?: any;        // 实际值
  expected?: any;       // 期望值
  mismatch?: {          // 结构化失败原因（非字符串）
    path: string;
    field: string;
    actual: any;
    expected: any;
    delta?: number;
  };
  next_step_hint?: string;   // "调 dbg_node_state 查看 <path> 当前值"
}

// runtime_assert_node_state
type Input = {
  project_path: string;
  path: string;              // 场景节点路径或 /root/... 绝对路径
  expect: Record<string, any>;   // { position: {x,y}, visible: true, ... }
  tolerance?: number;        // 数值字段容差（默认 0）
};
type Output = AssertResult;
```

## 3. 与现有 workflow 的关系

- **向后兼容**：`workflow.dev_loop` 的 `acceptance` 字段保留不变，已有的 gdscript/screenshot_diff/frame_degradation 三种 assertion type 全部继续工作。
- **逻辑下沉**：将 workflow.ts 第 434-653 行的 assertion 分支逻辑（含 frame_degradation 568-619 和 gdscript default 621-643）下沉到新模块，workflow 内部改为调用新工具的实现（复用，不复制）。
- **新工具是 first-class**：agent 不走 workflow 也能直接 `runtime_assert_node_state({path, expect})`，这是 P0-5 的核心交付价值。

## 4. 改动清单

> [!warning] 修订（B-1/N-3，2026-08-05）
> 原版漏列"工具数变更触发的下游同步"，原版写的 `src/core/tool-registry.ts` 修改方向也不准确。已补全。

### 4.1 直接改动

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/tools/frame-verify/assert-protocol.ts` | 修改 | 抽离 node_state/scene_structure 校验为纯函数（可被新工具 import） |
| `src/tools/runtime-assert.ts` | 新建 | 注册 5 个 MCP 工具，复用 frame-verify 纯函数 + game-bridge 调用 |
| `src/core/module-loader.ts` | 修改 | `ALL_MODULES` 数组新增 `runtimeAssert`，紧跟 workflow 之后 |
| `src/tools/workflow.ts` | 修改 | acceptance 分支内部委托 `runtime_assert_*` 实现（复用，去重） |
| `src/core/tool-registry.ts` | 评估 | **实测**：tool-registry.ts 无工具清单，`TOOL_GROUPS` 无 `'runtime'` 组（runtime 工具归在 core 组）。需评估：新工具归入哪个 `TOOL_GROUPS`（建议并入 `core` 组，或新建 `runtimeAssert` 组）。核心登记在 `module-loader.ts` 的 `ALL_MODULES` 数组 |
| `test/tools/runtime-assert.test.ts` | 新建 | 5 个工具的单元测试（含 mismatch 结构断言） |
| `docs/tools/runtime_assert_node_state.md` 等 | 新建 | 配合 P0-6 help 工具的单工具文档（5 份） |

### 4.2 工具数变更触发的下游同步（B-1，AGENTS.md 强制）

新增 5 个工具后工具数 **36 → 41**，必须同步以下文件，CI 校验（`scripts/check-tool-count.mjs`）才会绿：

| 文件 | 改动 | 依据 |
|------|------|------|
| `docs/capability-matrix.{json,md}` | `npm run build-matrix` 重建（新增 5 工具后工具数 36→41） | AGENTS.md「完成前强制检查」§5 |
| `src/tools/rule-templates.ts:24` | "36 个 MCP 工具" → "41 个 MCP 工具"（当前实测 24 行确认） | AGENTS.md:280 工具清单变更必须同步 |
| `.claude/rules/godot-mcp-core.md:10` | 同步（"36 个 MCP 工具" → "41 个 MCP 工具"，独立副本，AGENTS.md:374-381） | 独立副本同步约束 |
| `README.md` / `README.en.md` / `manifest.json` / `docs/distribution/*` / `docs/migration-from-coding-solo.md` | 9 文件共 17 处工具数同步（`scripts/check-tool-count.mjs:48-112` 校验） | AGENTS.md「完成前强制检查」§5 |
| `src/tools/agentsmd-builder.ts` | 若分发 AGENTS.md 含工具数也需同步 | 分发产物边界 |

> 注：与 P0-6 的 `help` 工具新增（36→37）合并落地时，最终工具数为 **42**（36 + 5 + 1）。两份 spec 落地顺序需协调，避免 tools/list 重复 rebuild。

## 5. 验收标准

1. agent 调用 `runtime_assert_node_state({ path: "/root/Player", expect: { position: {x:100, y:200} }, tolerance: 0.5 })` 无需走 `workflow.dev_loop`，返回 `{passed, matched, mismatch?}`。
2. 失败时返回的 `mismatch` 是结构化对象（含 path/field/actual/expected/delta），不是字符串拼接。
3. `tools/list` 中 5 个新工具均带 `annotations: { readOnlyHint: true, destructiveHint: false }`（走 `deriveMcpHints` 自动生成）。
4. `runtime_assert_screen_text` 在 game-bridge 未连接时返回明确错误（不静默失败）。
5. workflow.dev_loop 的 acceptance 行为不回归（现有 `test/tools/workflow.test.ts` 全绿）。
6. **headless 可用范围明确**：headless 模式可工作的工具 = `runtime_assert_node_state` + `runtime_assert_scene_structure`（**2 个**，验证 .tscn 文件结构）。`runtime_assert_perf` + `runtime_assert_screen_text` + `runtime_screenshot_diff` 共 **3 个 runtime-only**，无运行中游戏时必须 fail-fast（明确报错而非静默失败）。

## 6. 依赖与风险

**依赖**：
- `runtime_assert_screen_text` 与 `runtime_screenshot_diff` 强依赖 game-bridge 连接（运行中的游戏）。未连接时应 fail-fast。
- `runtime_assert_perf` 需要 proof-bundle 帧序列已捕获（要么由 `dev_loop.frame_sequence` 产出，要么 agent 自行提供 `frames_dir`）。

**风险**：
- **R1（中）**：从 workflow 内提取逻辑可能引入回归。缓解：先抽纯函数，保留 workflow 调用路径，跑全套现有 workflow 测试。
- **R2（低）**：`runtime_assert_node_state` 在 headless（无运行实例）模式下需要决定是验证 .tscn 静态结构还是当前运行时状态。spec 建议：`path` 以 `/root/` 开头时走运行时（需 game-bridge），否则走 .tscn 静态解析（复用 `scene.read_scene`）。
- **R3（低）**：断言协议的 `ASSERT PASS/FAIL` 文本匹配存在 B2 安全边界（`assert-protocol.ts` 注释已说明不可信代码可伪造）。新工具沿用相同约束，文档需显式标注。

## 7. 与其他 P0 的关系

- **P0-6（工具分层压缩）**：5 个新工具按调频归类——`runtime_assert_node_state` 进 P0 核心层，其余 4 个进 P1 单行+help 重定向层。
- **game-bridge**：本 spec 假定 bridge 已稳定；若 bridge 接口变更需同步。

---

## 修订记录

| 日期 | 修订项 | 对应审查报告 Issue |
|------|--------|------------------|
| 2026-08-05 | §1 行号 `:135-160` → `:135-164`；§1 行号 `:434-560` → `:434-653` | N-2 |
| 2026-08-05 | §3 行号 `:434-560` → `:434-653`（含 frame_degradation 568-619 和 gdscript default 621-643） | N-2 |
| 2026-08-05 | §2 拆分 readOnly 标注：纯查询类（node_state/scene_structure/screen_text）标 ✓；截图/帧序列类（screenshot_diff/perf）标 ✗，新增 write-temp 风险档说明 | R-fail |
| 2026-08-05 | §2 `runtime_assert_screen_text` 描述去掉"/ OCR"，改为"按节点 name/text 属性匹配，非图像 OCR" | N-1 |
| 2026-08-05 | §4 补工具数下游同步清单（rule-templates.ts / .claude/rules/godot-mcp-core.md / README 等 9 文件 17 处 / build-matrix / agentsmd-builder.ts） | B-1 |
| 2026-08-05 | §4 修正 `src/core/tool-registry.ts` 改动方向（实测无工具清单，TOOL_GROUPS 无 runtime 组，核心登记在 module-loader.ts ALL_MODULES） | N-3 |
| 2026-08-05 | §5 验收 6 明确 headless 范围：node_state + scene_structure（2 个）可工作；perf + screen_text + screenshot_diff（3 个 runtime-only）必须 fail-fast | N-5 |
