# QA 深化 spec:应用级异步长跑 + MCP Tasks 协议层 + 断言扩展

- **日期**:2026-08-17
- **状态**:已过第三方审查并处置(见文末「第三方审查处置记录」)
- **来源**:用户方向"QA 深化(MCP Tasks 长跑/断言扩展)";对应 SDK 升级计划 P3-5(Tasks 扩展)+ QA 编排(v0.30 B 批)的自然深化
- **用户决策记录**:
  - 长跑策略:**两者都做**(应用级异步 + 协议级 tasks,分批交付)
  - 断言候选:**全选**(screenshot_diff / signal / errors / monitor)
  - 设计整体认可,**交付拆更细**:PR-1a(断言)→ PR-1b(异步)→ PR-2(tasks wire 层)

---

## 0. 背景与动机

### 现状(2026-08-17 实测)

- QA 编排闭环已交付:`qa run/report/diff` 三 action(`src/tools/qa/index.ts`),runner/spec(zod)/report 各一文件;nightly CLI 跑批 + `record_on_failure` + CLI audit 已收口(PR#28,722f74f)。
- `qa run` 是**同步阻塞**的 MCP 工具调用:整套件跑完才返回。套件预算 `suite_budget_ms` 默认 300000ms(5 分钟)。
- 断言仅开放 4 种:`node_state / scene_structure / screen_text / perf`(`src/tools/qa/spec.ts:82`)。

### 痛点

1. **客户端超时**:Claude Code 对 MCP 工具调用默认约 60 秒超时(`MCP_TOOL_TIMEOUT` 可配但存在不总被遵守的报告,anthropics/claude-code#16837),tasks 客户端支持仍在跟踪(anthropics/claude-code#43791 等)。同步模式下长套件(>60s)在 Claude Code 里大概率超时——报告会落盘但客户端拿不到结果。
2. **断言维度不足**:无信号触发断言(测"事件发生了吗")、无时间线断言(测"数值全程稳定吗")、无错误回归断言(测"改动后零新报错吗")、视觉回归断言未接线。
3. P3-5(Tasks 扩展)是 SDK v2 升级计划的既定后续项,前置 P0-1(SDK v2)已完成。

### 关键探索事实(设计依据,均已实测)

| # | 事实 | 出处 |
|---|------|------|
| F1 | SDK `@modelcontextprotocol/server` 2.0.0 **只有 task wire 类型、无 task 运行时** | SDK dist 类型文件原话 "Task methods are 2025-11-25 wire vocabulary with no SDK runtime";`isTaskAugmentedRequestParams`(及其 schema `TaskAugmentedRequestParamsSchema`)标 `@deprecated` |
| F2 | tasks 族(`tasks/get|result|list|cancel`)是 2025-11-25 协议词汇;**2026-07-28 era 已从注册表删除** | SDK 类型 + zread 文档(线路编解码与 Eras) |
| F3 | 主流客户端(Claude Code)未实现 tasks 支持,工具调用默认约 60s 超时(`MCP_TOOL_TIMEOUT` 可配但不可靠) | anthropics/claude-code#43791 / #16837(GitHub issue,WebSearch 验证) |
| F4 | task wire 契约(实测 safeParse 探测):`Task = {taskId, status: working\|input_required\|completed\|failed\|cancelled, statusMessage?, …}`(**无结构化 progress 字段**);`TaskStatusNotificationParams = {taskId, status, ttl, createdAt, lastUpdatedAt}`;`RelatedTaskMetadata = {taskId}`;`GetTaskRequest.params = {taskId}`;`ListTasksRequest.params = {}`;`CancelTaskRequest.params = {taskId}`;`GetTaskPayloadRequest.params = {taskId}` | `@modelcontextprotocol/core/internal` 实测 dump |
| F5 | `runtime-assert.ts:277` `assertScreenshotDiff` 是 **NOT_IMPLEMENTED 占位**(诚实拒绝防假绿,2026-08-06 审查 P0 修复产物);其 `threshold` 字段现描述为"相似度阈值(0-1,默认 0.85)"(`:55`,占位实现 `?? 0.85`)——**与像素 diff 的差异容忍语义相反** | `src/tools/runtime-assert.ts:55/277-295` |
| F6 | 像素级 diff 已有真实现:`diffPngBuffers(pngA, pngB, threshold)` 导出于 `src/tools/screenshot-detail.ts:62`,返回 `{width, height, diffPixels, diffRatio, bbox, diffImageData}`,尺寸不一致 throw;忽略 alpha 只比 RGB;threshold 默认 0.12(per-pixel 归一化欧氏距离,**严格大于才计差**;语义是"差异容忍",值越小越严) | `src/tools/screenshot-detail.ts:40-100` |
| F7 | bridge 原语真实契约(GD 侧实测):`watch.poll → {watching, node_path, signal_name, events: [{frame, time, args: […]}], event_count}`(**仅 active 时返回事件;非 active 返回空**);`watch.stop → {watching:false, events: 全量, event_count, node_path, signal_name, duration_seconds, previous_events?}`;`watch.start`(`mcp_bridge.gd:1839`)对已有活跃 watch 是**静默替换**(disconnect first,`:1859-1861`),事件数达 `max_events` 后**自动置 inactive**(`:1798-1800`),此后 poll 返回空;`monitor.poll → {monitoring, node_path, samples: [{frame, time, values: {prop: val}}], sample_count}`(同样仅 active 时返回样本);`monitor.start`(`:1616`)遇 node_lost 置 inactive 并在 **stop 的全量返回**里落 `{frame, time, error:'node_lost', stopped_reason}` 样本;`get_errors → {errors: [{seq, kind: error\|script\|shader\|warning, message, code, function, file, line}], next_seq}`(since_seq 增量;`clear=true` 才清空,默认保留);`watch.start` 需 `{node_path, signal_name, max_events?, push?}`,`monitor.start` 需 `{node_path, properties, interval_frames?}`(GD 侧 clamp 1-300,默认 10) | `src/scripts/mcp_bridge.gd:1839/1859-1861/1798-1800/1616/1682-1710/1713/1922/1578`,`_ErrorCapture` 类 `mcp_bridge.gd:2453` |
| F8 | watch/monitor 是 **per-peer 单订阅槽**(每连接同时最多 1 watch + 1 monitor;`watch.stop`/`monitor.stop` 无参全停);TS 侧单连接有 `_sendLock` 排队(`game-bridge.ts:425-427`),真正会互踩的是单订阅槽与 `setBridgeProjectDir` 切项目(`:403-423`) | `mcp_bridge.gd` `_watch_states`/`_monitor_states` 结构 |
| F9 | `qa` 工具 description 773B(另 schema 895B/total 1668B,`docs/capability-matrix.json` 实测),距 800B warn 线仅 27B → 断言扩展必须把细节移入 schema 字段 description | `docs/capability-matrix.json` + QA 收尾批审查 Nit-3(docs/reviews/2026-08-16-qa-closeout.md:57) |
| F10 | GodotServer 的 Server 构造已有 capabilities 声明惯例(tools/resources/prompts/completions/logging/extensions,含 era-gated 注释先例);`close()` 已有 killProcess 兜底(`GodotServer.ts:594-602`) | `src/GodotServer.ts:114-174/594-602` |
| F11 | 确认+审计两道门都在 `ToolDispatcher`(confirm :423-433、audit middleware :524-563);tools/call 的请求 `_meta` 只在 dispatcher 层可见(`:219` 提取 progressToken 先例),工具 handler 收到的 args 不含 `_meta`;result `_meta` 写回已有 G2 trace_id 注入先例(`:483-486`) | `src/core/ToolDispatcher.ts` |
| F12 | CLI qa 子命令走 `qaTool.handleTool('qa', {action:'run',…})`(`src/cli/qa.ts:76`),有独立 auditRun(`:89-107`)与退出码语义(`:145` `status==='PASSED'?0:1`;nightly `:189` `status!=='PASSED'` 判失败) | `src/cli/qa.ts` |
| F13 | `TaskAugmentedRequestParamsSchema` 字段全可选 → `safeParse` 对任何带 `_meta`(含标准 progressToken)的请求恒真,**不可作探测条件** | 实测 + SDK 类型(`auth-*.d.mts:67-80`) |

---

## 0.5 仓库级约束核查结论(第三方审查 B-4/I-10 处置)

以下为独立核查结论(不是缺省,是 grep 过的"不需要/需要"):

| 约束 | 核查结论 | 证据 |
|------|---------|------|
| `.claude/rules/` ↔ `rule-templates.ts` 双副本同步 | **本 spec 不触发同步义务**:`rule-templates.ts` 无 qa 段(grep 证实);模板内 dev_loop 的 screenshot_diff 描述走独立 `referenceSimScript` 余弦相似度路径(`src/tools/workflow.ts:529`),不经 runtime-assert,PR-1a 不触及。无需版本 bump、无需 `check:rules-sync` | grep + read |
| capability-matrix | **三批均需 `npm run build-matrix`**:matrix 由 `src/capability/extract.ts:64` 从工具定义实时采集;`check:budget` 读的是 committed 快照(`scripts/check-token-budget.mjs:57`)——不先重建则验收测的是旧值 | read |
| budget 阈线 | desc warn=800B/error=2000B;schema warn=6000B;total warn=7000B(`check-token-budget.mjs:14-17`)。qa schema 现 895B,细节迁入空间充足 | read |
| TOOL_META.actionRisks | qa 现有 run/report/diff 已声明;**status/cancel 新 action 必须补声明**并入 §2.6 改动面,否则 confirm+audit 门对未声明 action 静默失效(`src/core/guard.ts:67-68`)。`test/risk-declarations.test.ts` 现无 qa 块,需补锁定用例 | grep |
| `scripts/check-tool-groups.mjs` | 不受影响(qa 工具名不变) | read |
| e2e smoke 挂接 | `test/e2e-full-tool-verification.test.ts` 现无 qa 覆盖;bridge 类 L2 测试默认 skip 需 `GODOT_MCP_E2E_L2=1`(`:50-55`)。§5 验收按此挂接 | grep |
| 三入口 screenshot_diff 语义区分 | 本仓将存在三个视觉对比入口,**语义必须显式区分防误用**:①dev_loop acceptance 的 `screenshot_diff`(余弦相似度,阈值 0.85,**高=像**);②`screenshot` 工具 `action=diff`(像素差异,threshold 0.12,严格大于计差,**低=像**);③本 spec qa/runtime-assert 的 `screenshot_diff` 断言(与②同引擎 `diffPngBuffers`,同"差异容忍"语义)。spec 裁定:③ 统一用"差异容忍"词汇,**禁用**"相似度"措辞描述 ③ 的 threshold | `src/tools/workflow.ts:529` + `src/tools/screenshot-detail.ts:55-56` + `src/tools/rule-templates.ts:627` 校准数据 |

---

## 1. PR-1a:断言扩展(四件套 + 控制步骤 + 描述重构)

### 1.1 新增步骤类型(spec.ts)

控制步骤 4 个(bridge 原语直转,与既有 input/wait 步骤同风格):

```
{ type: 'watch_start',   node_path, signal_name, max_events?, label? }
{ type: 'watch_stop',    label? }
{ type: 'monitor_start', node_path, properties: string[], interval_frames?(1-300,bridge 侧 clamp,默认 10), label? }
{ type: 'monitor_stop',  label? }
```

断言步骤扩展 `assert` enum 增加 4 值,`assertStep` schema 新增字段:

```
{ type: 'assert', assert: 'screenshot_diff', reference: string(路径), threshold?: number(默认 0.12,像素差异容忍:per-pixel 归一化 RGB 距离严格大于此值才计为差异像素;值越小越严格), max_diff_ratio?: number(默认 0.05,允许的差异像素占比上限;严格像素回归可显式传 0,常规视觉回归建议以同布局好图对校准——本仓实测同布局好图对 ≈0.176,勿低于该量级), label? }
{ type: 'assert', assert: 'signal', min_count?: int(默认 1), max_count?: int, args_match?: unknown[](JSON 深比较;按 GD `_jsonify` 后形态:Vector2→{x,y}、Vector3→{x,y,z}、Color→{r,g,b,a}、Transform2D→仅 origin、Node→路径字符串), label? }
{ type: 'assert', assert: 'errors', kinds?: string[](默认 ['error','script','shader'],warning 排除), max_count?: int(默认 0), label? }
{ type: 'assert', assert: 'monitor', property: string, min?: number, max?: number, monotonic?: 'increasing'|'non_decreasing'|'decreasing'|'non_increasing', label? }
```

### 1.2 语义与实现(runner.ts)

- **screenshot_diff**:
  1. `take_screenshot` 存游戏侧 `user://mcp_qa_<run_id>_step<N>.png`(复用现有 screenshot 步骤的路径约定);
  2. `resolveGameDataPath` 拷到本机(qa runner 已有该函数);
  3. **`reference` 路径必须过 `isPathInAllowedRoots` 白名单**(与 `spec_path` 同标准;拒绝时返回 INVALID_PATH + 可行动提示);
  4. 调用 runtime-assert 导出的 `assertScreenshotDiff`(见 §1.3,核心对比逻辑同源),qa 侧传入 `evidence_dir = qa-reports 目录`;
  5. 判定:`diffRatio <= max_diff_ratio` → PASSED;否则 FAILED,mismatch 带 `{diff_ratio: {expected: ≤max, actual}, diff_pixels, bbox}`;
  6. 尺寸不一致(内部 `diffPngBuffers` throw)→ FAILED,detail 带双方尺寸;
  7. 提供了 `evidence_dir` 时,diff 图(染红版)编码落 `<evidence_dir>/<run_id>-step<N>-diff.png` 作证据;未提供(工具级直调)则只在结果里带数值不落盘。
- **signal**:
  - `watch_start` 步骤:`watch.start`(F7 契约);**注意 GD 侧对已有活跃 watch 是静默替换**(`mcp_bridge.gd:1859-1861` disconnect first)——qa 层自管"本套件是否已开 watch"状态,套件内重复 `watch_start` → ERROR('本套件已有活跃 watch,先 watch_stop');若替换的是用户经 game 工具开的 watch,qa 不报错但会在 detail 里注明"已替换既有 watch"。
  - `assert signal` **取数路径(B-2 修复)**:先 poll `watch.poll`;若返回 `watching:false` 但 qa 侧记录过本套件 active(典型:事件数达 `max_events` 后 GD 自动置 inactive,`mcp_bridge.gd:1798-1800`),**补发 `watch.stop` 取全量 events**(`watch.stop` 的全量返回含全部已采集事件,`:1900-1919`)再判定;qa 侧从未 active → ERROR('无活跃 watch,先 watch_start')。
  - 判定:统计 events 中(提供 `args_match` 时仅计 JSON 深等于它的事件,**按 `_jsonify` 后形态**比较)数量 ∈ [min_count, max_count ?? ∞];FAILED 时 mismatch `{count: {expected: 区间, actual}, last_event: 最近事件(截断)}`。
  - `watch_stop`:`watch.stop`(同时接收全量 events 供后续断言——qa 缓存最近一次 stop 返回的 events,`assert signal` 优先用 poll,stop 后用缓存);
  - **teardown finally 兜底**:teardown 时若 qa 侧记录仍有未 stop 的 active watch,补发 `watch.stop` 防泄漏(与 recording.stop 同哲学)。
- **errors**:
  - **baseline 锚点(I-2 修正:按需采集 + 降级)**:**仅当套件含 `assert errors` 步骤时**,在 setup 成功后(bridge ready 且 seed/fixed_delta 应用完)发 `get_errors {since_seq: 0}` 记录 `next_seq`;采集失败(旧 bridge 无错误捕获,返回 error)→ 记 `teardown_warning` 降级('错误捕获不可用'),后续 `assert errors` 步骤判 ERROR('errors 断言不可用:旧 bridge 无 get_errors')而非 failSetup——与 recording.start 的降级哲学一致,不影响套件其他步骤;
  - `assert errors`:`get_errors {since_seq: baseline_seq}` → 按 `kinds` 过滤计数,判定 `<= max_count`;FAILED 时 mismatch `{new_errors: {expected: ≤max_count, actual: N}, entries: 实际条目(前 5 条截断)}`。
- **monitor**:
  - `monitor_start`/`monitor_stop` 同 watch 模式(qa 侧单套件单 monitor 约束 + teardown 兜底 stop);
  - `assert monitor` **取数路径(B-2 修复)**:先 poll `monitor.poll`;若返回 `monitoring:false` 且 qa 侧记录过本套件 active(典型:node_lost 后 GD 置 inactive),**补发 `monitor.stop` 取全量 samples**再判定;qa 侧从未 active → ERROR。
  - 样本序列 = 全量 samples 中 `values` 含该属性的样本提取 `values[property]`;
  - 判据:**返回含 `stopped_reason` 或任一样本含 `error:'node_lost'` → ERROR**(数据不完整,不判假绿;注意这类样本只在 stop 的全量返回里出现,poll 阶段遇 `monitoring:false` 即走上述补 stop 路径);
  - 判定:全样本 ∈ [min, max](提供时);`monotonic` 按四档语义(严格递增/非降/严格递减/非增);
  - FAILED 时 mismatch 带越界/违规的首个样本 `{frame, value}`。

### 1.3 runtime-assert 占位修复(同源防 drift)

`runtime-assert.ts` 的 `assertScreenshotDiff` 从 NOT_IMPLEMENTED 占位升级为真实现:截图(take_screenshot)→ 读参考图(白名单校验)→ `diffPngBuffers`(`src/tools/screenshot-detail.ts:62`,已导出)→ 判定。函数签名扩展可选 `evidence_dir` 参数(默认不传=不落盘,服务工具级单次调用;qa 传 qa-reports 目录落证据)。qa runner 直调这一导出函数,不复制对比逻辑——与现有 4 断言"复用 runtime-assert 导出"的架构一致(runner.ts:7 注释)。

**B-1 语义修正(工具级 schema 必须改,不是"不变")**:现有 `threshold` 字段描述是"相似度阈值(0-1,默认 0.85)"(`runtime-assert.ts:55`,占位实现 `?? 0.85`),与像素 diff 的**差异容忍**语义(值越小越严)相反。若照旧描述,agent 传 0.85 = 容忍 85% 像素差异 → 视觉回归假绿。处置:
- `threshold` 字段 description 重写为"像素差异容忍阈值(0-1,默认 0.12;per-pixel 归一化 RGB 距离严格大于此值计为差异像素,值越小越严格)";
- 默认值 `?? 0.85` → `?? 0.12`;
- 新增 `max_diff_ratio` 字段(默认 0.05,语义同 §1.1 qa 侧);
- 描述禁用"相似度"措辞(三入口语义区分见 §0.5)。

**I-1 工具级直调的 project_path**:真实现需要 `resolveGameDataPath(projectPath, uri)` 把 user:// 截图拷到本机——`project_path` 对 `screenshot_diff` action 升为**必填**(schema required 按 action 条件校验,与现有 path/expect 的条件必填风格一致);未提供时返回 INVALID_PARAMS + 可行动提示。qa 侧调用时自动传入套件 projectPath。

`reference` 同样过 `isPathInAllowedRoots` 白名单。

### 1.4 描述重构(Nit-3)

`qa` 工具 `description` 重写:步骤类型收敛为一行概述(`input/wait/playtest/state/assert/screenshot` 分组词),全部断言语义与选项细节移入 `inputSchema` 字段 `description`(含新增字段的 per-断言说明)。**验收口径(B-4 修正)**:改动后先 `npm run build-matrix` 重建快照,再 `npm run check:budget` 无 error;以 `docs/capability-matrix.json` 中 qa 条目的 `size.descBytes < 600` 为准(schemaBytes < 6000、totalBytes < 7000 不新增 warn)。

### 1.5 PR-1a 改动面

| 文件 | 改动 |
|------|------|
| `src/tools/qa/spec.ts` | +4 控制步骤 schema、assertStep +4 值与新字段 |
| `src/tools/qa/runner.ts` | +4 步骤执行分支、+4 断言分支(poll 优先/补 stop 取全量)、teardown watch/monitor 兜底 stop、errors baseline 按需采集 + 降级 |
| `src/tools/runtime-assert.ts` | assertScreenshotDiff 占位 → 真实现(导出供 qa 复用);threshold 语义/默认值/描述修正(0.85→0.12 差异容忍)+ max_diff_ratio 字段 + project_path 条件必填(B-1/I-1) |
| `src/tools/qa/index.ts` | description 重构(细节移 schema) |
| `docs/capability-matrix.{json,md}` | `npm run build-matrix` 重建(工具定义变更) |
| `test/qa-spec.test.ts` 等 | 新步骤/字段正负用例;mock 带真实 shape(F7) |
| `test/runtime-assert*.test.*` | screenshot_diff 真实现用例(含尺寸不一致/白名单拒绝/threshold 新语义负向) |

---

## 2. PR-1b:应用级异步长跑(协议无关)

### 2.1 接口

- `qa run` 新增参数 `mode: 'sync' | 'async'`(**默认 sync,零破坏**;CLI nightly 同步路径不变)。
- async:tools/call 立即返回 `{success: true, data: {run_id, status: 'working', suite_name, steps_total, hint}}`,hint 为可行动文本("qa status <run_id> 轮询进度;qa report <run_id> 读结果报告")。
- 新增 action:
  - `qa status {run_id?}`:进行中 run → 实时进度(step/total + 当前步骤 type/label);已完成 → 终态 + 报告路径;不传 run_id → 列出全部注册表条目(含终态未过期的)。
  - `qa cancel {run_id}`:对 working run 设取消标志;非 working → INVALID_PARAMS。
- `qa status` 对未知 run_id(如 server 已重启,注册表丢失):返回可行动提示"不在运行注册表(server 可能已重启),尝试 qa report <run_id> 读落盘报告"。

### 2.2 run 注册表(单一事实源)

新文件 `src/tools/qa/registry.ts`:

```ts
interface RunRecord {
  taskId: string;            // = run_id(与报告 run_id 同值,单一标识)
  status: 'working' | 'completed' | 'failed' | 'cancelled';  // SEP-1686 词汇
  suite_name: string;
  project_path: string;
  createdAt: string;         // ISO
  lastUpdatedAt: string;
  ttl: number;               // 终态保留时长,透传给 wire TaskStatusNotificationParams.ttl(单位实现期对齐 2025-11-25 规范)
  progress: { step: number; total: number; current?: string };  // current = 步骤 type(+label);wire 侧经 statusMessage 文本承载
  cancelRequested: boolean;  // 内部字段,不出 wire
  done?: Promise<void>;      // 内部字段,不出 wire;close() 收尾 await 用(I-4)
  report?: QaReport;         // 终态后回填(含 summary.paths)
}
```

- 内存 `Map<string, RunRecord>` + 惰性清扫(每次 get/list 时顺带清过期终态;不起常驻 timer,close 干净)。
- **sync run 也入表**(瞬间 working→终态),保证 tasks 层(PR-2)单一事实源。
- **并发约束:全局同一时刻仅 1 个 working run**(sync 或 async)。第二个 async run 请求 → `BUSY` 错误(附当前 run_id 与进度);sync run 执行中,SDK Server 并发分发下第二个请求同样能到达 qa 入口(实测 `_onrequest` 同步分发不排队),BUSY 检查均生效。依据:watch/monitor per-peer 单订阅槽 + `setBridgeProjectDir` 切项目(F8),并行 run 必互踩。

### 2.3 取消语义

- runner 步骤循环**每步之间**检查 `cancelRequested`;置位后:当前步骤若已完成则记录之,剩余步骤 `SKIPPED('cancelled by user')`;
- teardown 照常执行(`recording.stop` → `stop_project`),防孤儿 Godot 进程与录制丢失;
- `summary.status` 扩展枚举:加 `'CANCELLED'`(`report.ts` 的 summary.status 类型 + `finalizeSummary` 判定 + renderMarkdown 显示);
- **CANCELLED 与周边生态的交互(I-5,必须定义)**:
  - CLI 单跑:退出码沿用 `status==='PASSED'?0:1`(`src/cli/qa.ts:145`)→ CANCELLED=1,输出明示"已取消";
  - nightly 基线:`findPreviousReport` **跳过 `summary.status==='CANCELLED'` 的报告**(手动取消的半途报告不作为 diff 基线,否则下一轮产生大量虚假 "fixed");
  - diffReports:CANCELLED run 的 SKIPPED('cancelled') 步骤按 not-passed 参与对比(如实反映),但因基线跳过规则不会被拿去当 base。
- **步骤内部不中断**:单步最长 `step_timeout_ms`(默认 30s)+ `suite_budget_ms` 总兜底,取消最迟在当前步骤结束后生效——诚实文档化,不做 AbortController 深改造(bridge 请求不可中断是底层现实)。

### 2.4 server close 收尾

`GodotServer.close()` 增加:对 working run 置 `cancelRequested` 并 await 其 `done` promise(settle 上限 = 该 run 的 `suite_budget_ms`,超时记 warning 放弃)。定位为**优雅收尾**(报告落 CANCELLED + 录制证据落盘);进程级兜底(killProcess)已有(`GodotServer.ts:594-602`),本项不重复。

### 2.5 审计与风险声明

- `run`(含 async 启动)维持 `process` 风险不变——confirm+audit 在 tools/call 边界一次性覆盖启动;
- `cancel` 新 action:`process` 风险(干预运行中进程);
- `status`:`read` 风险。

### 2.6 PR-1b 改动面

| 文件 | 改动 |
|------|------|
| `src/tools/qa/registry.ts`(新) | RunRecord + 注册表 + 并发检查 + TTL 清扫 |
| `src/tools/qa/runner.ts` | runQaSuite 接受取消信号(回调/对象)与进度上报钩子;finalizeSummary 加 CANCELLED |
| `src/tools/qa/index.ts` | mode 参数、status/cancel action、BUSY 错误;**TOOL_META.actionRisks 补 `status:'read'` / `cancel:'process'`**(I-6,漏声明则 confirm+audit 门静默失效) |
| `src/tools/qa/report.ts` | summary.status 类型 + renderMarkdown 支持 CANCELLED;`findPreviousReport` 跳过 CANCELLED 报告(I-5) |
| `src/GodotServer.ts` | close() 收尾进行中 run(优雅收尾) |
| `docs/capability-matrix.{json,md}` | `npm run build-matrix` 重建(B-4) |
| CLI 路径 | **代码零改动**(CLI 走 `qaTool.handleTool('qa',…)`(`src/cli/qa.ts:76`),默认 sync 行为零变化;CANCELLED 退出码语义见 §2.3);回归以 `test/qa-cli-nightly.test.ts` 全绿为准 |
| 测试 | 注册表单元(含 TTL/并发 BUSY)、cancel 中途态(mock 多步套件,第 2 步后取消)、close 收尾、sync 不回归;**qa actionRisks 声明锁定用例补进 `test/risk-declarations.test.ts`**(现无 qa 块,I-6) |

---

## 3. PR-2:MCP Tasks 协议层(2025-11-25 era 薄兼容层)

### 3.1 定位

SDK 无 task 运行时(F1)、2026 era 已删 tasks 词汇(F2)、客户端支持缺位(F3)→ 本层定位**薄兼容**:面向未来实现 tasks 的 2025-11-25 era 客户端,把 PR-1b 的注册表按 task wire 契约暴露。重投入止步于此;若协议前景进一步明朗或恶化,增删只动这一层。

### 3.2 组件

1. **`src/core/task-store.ts`(新)**:TaskStore——对 qa registry 的 task 视图封装 + wire schema 校验(schema 从 `@modelcontextprotocol/core/internal` 导入:F4 契约)。职责:taskId 对应、status 映射(qa 的 CANCELLED → wire 的 `cancelled`;PASSED → `completed`;FAILED/ERROR/setup_error → `failed`;working → `working`)、payload 组装(tasks/result 用)。
2. **GodotServer 接线**:
   - capabilities 加 tasks 能力声明(schema 支持细粒度形态,采用 `tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } }`;era-gated 注释同 `extensions` 先例,F10);
   - `setRequestHandler('tasks/get', …)`:按 taskId 返回 task(working 时经 `statusMessage` 文本承载进度,如 'step 3/12: input(send_key)'——**TaskSchema 无结构化 progress 字段**,F4/I-8);
   - `setRequestHandler('tasks/list', …)`:列注册表全部(未过期)条目;
   - `setRequestHandler('tasks/cancel', …)`:调 qa cancel 路径。**B-3 安全门机制(显式裁定)**:tasks/* 直连 handler 不经 ToolDispatcher 的 confirm+audit 门(F11),处置为——**audit 必补**:handler 内复刻 CLI auditRun 先例(`src/cli/qa.ts:89-107`:isAuditEnabled 检查 + appendAuditLine 直调 `src/core/audit-log.ts`),取消动作落审计;**confirm 不二次 elicitation**(裁定理由:被取消的 run 在启动时已过 `process` 风险 confirm 门,取消是收敛性操作——停掉已确认的进程,风险低于启动;且 tasks/cancel 的调用方就是刚走完 tools/call confirm 的同一客户端会话)。此裁定写进 §5.5 验收;
   - `setRequestHandler('tasks/result', …)`:终态 task 返回报告摘要 payload(run_id/summary/报告路径;进行中 → 明确错误);
   - **通知**:run 状态变化时发 `notifications/tasks/status` `{taskId, status, ttl, createdAt, lastUpdatedAt}`——仅当客户端 initialize 声明了 tasks 能力(未声明不发,遵守协议);
3. **tools/call 集成(I-7 修正:探测点在 dispatcher 层)**:tools/call 的请求 `_meta` 只在 `ToolDispatcher` 可见(F11,工具 handler 的 args 不含 `_meta`)——由 **ToolDispatcher 在 meta 提取处识别 task 增强信令,经 ToolContext 新增字段(如 `ctx.taskAugmented`)传入 qa**;`qa run` 收到后自动转 async,响应 `_meta.relatedTask = {taskId, status}` 的写回按 G2 trace_id 注入先例(`ToolDispatcher.ts:483-486`)。不带信令 → sync 现状。AI 客户端不认识 tasks 也能靠返回文本的 run_id 走应用级路径。

### 3.3 已识别风险(实现期必须验证)

| 风险 | 验证方式 | 处置/退路 |
|------|---------|--------------|
| `notifications/tasks/status` 的发送通道(SDK 无 task 运行时,通知需手发) | InMemoryTransport 实测客户端可收到 | 直用 server.notification() 通道(logger.ts 已有直发先例) |
| 客户端能力探测(initialize 时记录客户端是否声明 tasks) | SDK Server 是否暴露 client capabilities;若无,在 initialize handler 钩子记录 | initialize 由 SDK 内置处理时,改从 `ServerContext`/server 实例读协商产物;再不行 capabilities 恒发(2025 era 客户端容忍未知通知) |
| taskAugmented 信令形态与探测条件 | **已收敛(I-9,非 TBD)**:`TaskAugmentedRequestParamsSchema` 字段全可选(F13),safeParse 对任何带 `_meta`(含标准 progressToken)的请求**恒真,禁用作探测条件**;探测限定为 `_meta` 显式携带 related-task 专属 key,或客户端 capabilities.tasks.requests.tools.call 协商成功(读 2025-11-25 规范 tasks 节确认 key 名 + InMemoryTransport 实测) | 探测不可靠时退为:**恒走应用级**(async 返回 run_id 文本),`_meta.relatedTask` 尽力附加——客户端不认识也不影响 |

> 已证实的免风险项(N-8):2026-07-28 era 客户端发 `tasks/get` 会被 SDK 按时代注册表在分发层直接拒(METHOD_NOT_FOUND,到不了 handler)——原"handler 自查 era"退路用不上,handler 无需自查。

### 3.4 PR-2 改动面

| 文件 | 改动 |
|------|------|
| `src/core/task-store.ts`(新) | task 视图 + wire 校验 + payload |
| `src/core/ToolDispatcher.ts` | meta 提取处识别 task 增强信令 → ctx 注入;result `_meta.relatedTask` 写回(G2 先例)(I-7) |
| `src/types.ts` | ToolContext 加 `taskAugmented` 可选字段(I-7) |
| `src/GodotServer.ts` | capabilities.tasks(细粒度)、4 个 tasks/* handler、tasks/cancel 的 audit 留痕(audit-log 直调,B-3)、状态变化通知、客户端能力记录 |
| `src/tools/qa/index.ts` | `ctx.taskAugmented` → 自动 async |
| `docs/capability-matrix.{json,md}` | `npm run build-matrix` 重建(B-4) |
| 测试 | InMemoryTransport 端到端(2025-11-25 协商 → taskAugmented tools/call → tasks/get 轮询 → tasks/result;cancel 全链含 audit 断言;era 拒绝路径) |

---

## 4. 测试策略(总)

- **mock 真实 shape**(既有教训:mock 全绿≠真实契约):`watch.poll` mock 必须带 `{watching, events: [{frame, time, args}]}`;`monitor.poll` 带 `{monitoring, samples: [{frame, time, values: {…}}]}`;`get_errors` 带 `{errors: [{seq, kind, message, …}], next_seq}`。
- **负向用例**(既有教训:缺负向测试是 4 个 bug 的漏网根因):白名单拒绝(reference 越界路径)、单订阅槽重复 start、尺寸不一致、args_match 不误匹配、node_lost 样本不判假绿、warning 不计入 errors 默认口径、BUSY 拒绝、cancel 非 working run;**B-2 专项**:max_events 满自动停后 `assert signal` 仍能经补 stop 取到全部事件(不误判 0 事件)、node_lost 后 poll 返回空样本时 `assert monitor` 走补 stop 路径取全量并判 ERROR(不假绿不假红);**I-2 专项**:旧 bridge get_errors 失败 → 降级 warning + errors 断言 ERROR(不 failSetup);**CANCELLED 专项**:取消后的报告不作为 nightly 基线、CLI 退出码=1。
- **正例(I-11)**:Vector2 信号参数以 `{x,y}` 对象形态 args_match 匹配成功(按 `_jsonify` 后形态)。
- **判定纯函数属性测试**(fast-check):signal 计数区间、monitor 单调四档、min/max 越界首个样本定位。
- **回归**:sync 模式全量现有 qa 测试不动即绿;CLI nightly 路径回归(`test/qa-cli-nightly.test.ts`)。
- **e2e 冒烟(N-10 挂接)**:补进 `test/e2e-full-tool-verification.test.ts`(现无 qa 覆盖)——真 Godot 跑含 4 新断言的小套件 + async status/cancel 全链;需 `GODOT_PATH` + `GODOT_MCP_E2E_L2=1`(bridge 类 L2 默认 skip)。

## 5. 验收标准

1. `npm run lint` + `npm run build` + `npm test` 全绿;**`npm run build-matrix` 后 `npm run check:budget` 无 error,且 matrix 中 qa `size.descBytes < 600`**(B-4:budget 读 committed 快照,必须先重建;desc<800 只是 warn 线不是 error 线,故以 matrix 实测值为准)。
2. 含 4 新断言的套件在真 Godot 冒烟通过(PASSED);人为破坏(改参考图/改断言阈值)各产生 FAILED 且 mismatch 证据完整。
3. async run 在 >60s 套件上:Claude Code 式客户端(60s 超时模拟)发起 → 立即拿到 run_id → status 轮询见 working → 终态后 report 读到完整报告;cancel 中途 → 剩余步骤 SKIPPED('cancelled')、游戏被收尾、报告 CANCELLED。
4. BUSY:第二个 async run(第一个未终态)被拒,错误带当前 run_id。
5. tasks wire(仅 PR-2):InMemoryTransport 端到端 2025-11-25 协商全链绿;**tasks/cancel 产生 audit 记录**(B-3 裁定的留痕验证——cancel 免二次 elicitation 但必留审计)。
6. 每批(PR-1a/1b/2)按仓库强制流程出第三方审查文档 `docs/reviews/2026-MM-DD-<batch>.md` + memory 登记。

## 6. 明确不做(YAGNI)

- 不做 AbortController 深度可中断(bridge 请求不可中断,步骤间取消 + 超时兜底已诚实覆盖需求);
- 不做多 run 并行(bridge 单连接/单订阅槽是硬约束);
- 不做跨进程持久化注册表(重启后 status 引导读落盘报告即可);
- 不做 `qa status` 的阻塞等待参数(轮询 + progress 通知已够);
- 不实现 2026 era 的替代长跑词汇(等协议明朗);
- 不动 `input_required` task 状态(qa 套件无中途向 AI 要输入的场景)。

---

## 7. 第三方审查处置记录(2026-08-17)

独立 `code-reviewer` 子 agent 审查(隔离视角,全部声明 grep/read 实测),初判 **SPEC_NEEDS_REVISION**(4 Blocking + 11 Important + 12 Nit)。处置如下(关键声称经 coordinator 二次实测仲裁,"以代码事实为权威"):

### Blocking(4/4 全部采纳修复)

| # | 问题 | 处置 |
|---|------|------|
| B-1 | `threshold` 语义反转:runtime-assert 现描述"相似度 0.85"与像素 diff"差异容忍 0.12"相反,沿用旧 schema 会假绿 | §1.3 重写:字段描述/默认值/措辞全改差异容忍语义 + 三入口语义区分入 §0.5 |
| B-2 | signal/monitor 断言取数路径与 bridge 真实行为不符:max_events 满/node_lost 后 GD 置 inactive,poll 返回空 → 假红 | §1.2 重写:poll 优先、非 active 且 qa 记录过 active → 补 stop 取全量;node_lost 判据改为"返回含 stopped_reason 或样本含 error";§4 补专项负向。**二次实测确认**(`watch.stop` 全量返回 :1900-1919、自动置 inactive :1798-1800) |
| B-3 | tasks/cancel 直连 handler 绕过 ToolDispatcher 的 confirm+audit 门,spec 无机制 | §3.2 显式裁定:audit 必补(auditRun 先例直调 audit-log);cancel 免二次 elicitation(收敛性操作 + 启动时已过门);§5.5 验收对齐 |
| B-4 | 验收口径不可执行:budget 读 committed 快照须先 build-matrix;desc<800 是 warn 非 error 线;三批改动面漏 build-matrix | §0.5 约束表 + 三批改动面各补 build-matrix 行;§1.4/§5.1 验收改为"build-matrix 后以 matrix 的 descBytes<600 实测为准" |

### Important(11/11 全部采纳)

I-1 project_path 条件必填(§1.3)/ I-2 errors baseline 按需采集+降级(§1.2,§4)/ I-3 max_diff_ratio 默认 0→0.05 + 0.176 校准说明(§1.1)/ I-4 RunRecord 加 done 内部字段(§2.2)/ I-5 CANCELLED 与 CLI/diff/nightly 交互 + CLI 路径表述改正(§2.3/§2.6)/ I-6 actionRisks 补声明 + risk-declarations 测试(§2.6)/ I-7 探测点上移 dispatcher + ToolContext 传参 + G2 先例写回(§3.2/§3.4)/ I-8 progress 经 statusMessage 文本承载(§3.2,F4 补注)/ I-9 safeParse 恒真禁用、探测条件收敛(§3.3,F13)/ I-10 双副本核查结论显式入 spec + 三入口语义区分(§0.5)/ I-11 args_match 按 `_jsonify` 形态(Vector2→{x,y} 等)(§1.1,§4 正例)。

### Nit(采纳 10,不采纳 1,部分合并)

采纳:N-2(issue 引用改为 #43791/#16837 + 软化"硬 60s",F3)/ N-3(F7 行号修正:watch.start 1839、monitor.start 1616;"clear=true 才清")/ N-4(并发论据改精确,F8)/ N-6(删行数快照防漂移)/ N-7(ttl 改"透传,单位实现期对齐规范",§2.2)/ N-8(era 自查退路删除,§3.3 免风险注)/ N-9(capabilities 细粒度声明,§3.2)/ N-10(e2e 挂接 e2e-full-tool-verification + L2 env,§4/§5)/ N-11(close 定位改"优雅收尾",§2.4,F10 补 killProcess 兜底)/ N-12(interval_frames clamp 入 schema,§1.1)/ N-5(watch_start 静默替换文档化,§1.2)。

**不采纳 N-1**:审查者称 `isTaskAugmentedRequestParams` "全 node_modules 0 匹配、不存在"——**二次实测反驳**:该标识符存在于 `node_modules/@modelcontextprotocol/server/dist/createMcpHandler-dBHMsxwf.d.cts:1716`(declare const,标 @deprecated)与 `:4044`(export as `Tt`),coordinator 两次独立 grep 到。spec F1 保持原表述并补注 schema 名。

### 审查增值说明

审查前 spec 的三批拆分、分层架构、wire 契约、F5/F6/F9 等核心事实未被推翻;4 条 Blocking 全部是"实现后必然产生假绿/假红/安全门缺口/验收不可执行"级别——其中 B-2(bridge 非 active 返回空)与 B-3(tasks 直连绕门)是 spec 作者首版未实测到的真实行为差异,佐证「spec 引先例必含执行链路」的既有教训。
