---
date: 2026-07-14
project: godot-mcp-enhanced
type: design
status: draft
systems:
  - "[[godot-mcp-enhanced]]"
source: 上游更新借鉴 2026-07-14（两轮子代理研究：6 借鉴点核实 + 5 落地方案）
---

# token 预算度量门禁 + 错误源码片段 设计

## 背景与动机

2026-07-14 上游借鉴研究（`D:\workspace\Obsidian\GodotMCP\系统文档\上游更新借鉴-2026-07-14.md`）核实 6 个借鉴点：5 个本项目已有等价或更优实现（A1 传输层/A2 安全门/A3 bridge 主体/A5 错误分类/A6 密钥脱敏），含金量偏低。本 spec 落地其中 2 个真实增量（D 落地优先级第 1、第 3）：

1. **token 预算度量与门禁**——唯一完全缺失且有运行时成本（每次 `tools/list` 推送线性消耗客户端上下文，随工具数增长递增）。
2. **错误消息源码片段**——error-analyzer 已有 file/line/type/suggestion（超上游），唯一缺口是源码片段，S 成本减 AI round-trip。

另两个值得做的（ring buffer、GDScript 生成器去重）属不同子系统，另批实施，不在本 spec 范围。

---

## 任务 1：token 预算度量与门禁

### 实测基线（2026-07-14，capability-matrix.json）

- 33 工具，`tools/list` 推送总量 **69834 B ≈ 70KB / ~17500 token**
- description 总 8239 B（11.8%），**inputSchema 总 61595 B（88.2%）**——体积瓶颈在 schema 不在 description
- TOP5（占总量 37%）：ui(9229) / scene(5057) / workflow(4452) / game(3849) / tilemap(3514)
- 最大单工具 ui 9.2KB（schema 占 96%，32 个 properties）
- **关键校正**：不照搬上游 GodotPrompter「description 16KB 硬上限」（针对自然语言文档），门禁重心必须在 schema

### 度量落地点

1. `D:\GitHub\godot-mcp-enhanced\src\capability\schema.ts`：`ToolCapability` 接口加 `size` 维度（E 组）
   ```ts
   size: { descBytes: number; schemaBytes: number; totalBytes: number }
   ```
2. `D:\GitHub\godot-mcp-enhanced\src\capability\extract.ts`：return 前用 `Buffer.byteLength` 计算（Node 内置，无需 import）
   - `descBytes = Buffer.byteLength(tool.description ?? '', 'utf8')`
   - `schemaBytes = Buffer.byteLength(JSON.stringify(tool.inputSchema), 'utf8')`（紧凑序列化，贴近 MCP SDK 推送）
3. `D:\GitHub\godot-mcp-enhanced\src\capability\build-matrix.ts`：概览节加 token 预算汇总行 + 新增 `## token 预算 TOP 5` 节；json 产物自动含 size 字段
4. `D:\GitHub\godot-mcp-enhanced\src\capability\diff-matrix.ts`：**不改**。diff-matrix 只比 4 维硬契约（added/removed 工具、requiredParams、security 降级），不比 description 文案；size 是独立维度，纳入会引入软变化噪声淹没真实契约变更。size 超限由独立 CI step 处理。

LF-normalized 测量天然满足（度量对象是内存字符串，JSON.stringify 产 LF；非读磁盘文件，无 CRLF 干扰）。

### 门禁设计（warn-only 基线，用户决策）

新建 `D:\GitHub\godot-mcp-enhanced\scripts\check-token-budget.mjs`：读 `docs/capability-matrix.json`，按下表检查，warn → console.warn，error → process.exit(1)。

| 维度 | warn | error（极高，当前 0 触发） |
|------|------|--------------------------|
| 单工具 description | ≥ 800 B | ≥ 2000 B |
| 单工具 inputSchema | ≥ 6000 B | ≥ 12000 B |
| 单工具 total | ≥ 7000 B | ≥ 14000 B |
| tools/list 总和 | ≥ 80 KB | ≥ 120 KB |

当前触发：warn 仅 ui（inputSchema 8921 + total 9229，合理提醒其 32 props 偏大），error 0 触发。阈值留 ~70% 增长空间。

CI 接线：`D:\GitHub\godot-mcp-enhanced\.github\workflows\ci.yml` 在 `build-matrix` + `diff-matrix` step 后加 `Check token budget` step（`node scripts/check-token-budget.mjs`）。`package.json` 加 `"check:budget": "node scripts/check-token-budget.mjs"`。check-token-budget 读的是上次 `build-matrix` 产出的 `capability-matrix.json` 快照（与 diff-matrix 同生命周期，非实时重算），故 CI 顺序须 build-matrix → diff-matrix → check:budget。

### 改动文件清单

| 文件 | 改动 |
|------|------|
| `src\capability\schema.ts` | ToolCapability 加 size 字段（+5） |
| `src\capability\extract.ts` | 计算 descBytes/schemaBytes，return 加 size（+5） |
| `src\capability\build-matrix.ts` | 概览汇总行 + TOP5 节（+12） |
| `scripts\check-token-budget.mjs` | 新建门禁脚本（~70） |
| `.github\workflows\ci.yml` | 加 Check token budget step（+4） |
| `package.json` | 加 check:budget script（+1） |

---

## 任务 2：错误消息源码片段

### 字段设计

`D:\GitHub\godot-mcp-enhanced\src\error-analyzer.ts`（当前无 import，需新增）：

- `ParsedError` 加 `snippet?: string`
- `AnalyzeOptions` 加 `projectPath?: string` + `snippetLines?: number`（默认 3）
- 新增私有 `buildSnippet(file, targetLine, projectPath, contextLines): string | undefined`（~30 行）
- 复用 `normalizeUserProjectPath` + `resolveWithinRoot`（`src\core\path-utils.ts`）两步惯例——resolveWithinRoot throw 即跳过（5 层安全校验兜底，零新安全面）

snippet 格式（出错行标 `>`）：
```
  83: func _ready():
  84:     var node = get_node("Player")
> 85:     node.position = Vector3.ZERO
  86:     print("done")
```

调用时机：`analyzeOutput` 的 3 个 push error 位置统一插入（抽 `enrichWithSnippet(error, options)` 避免重复）。

### 启用范围（三处都启用，用户决策）

| 调用点 | 文件:行 | 启用 | 说明 |
|--------|---------|------|------|
| run_and_verify | `src\tools\validation.ts:564` | ✓ | analyzeOpts 加 projectPath（:536 已有） |
| validate_scripts | `src\tools\validation.ts:784-889` | ✗ | 经 batchValidateScripts 路径产 `errors: string[]` 非 ParsedError，无 snippet 落点（实测确认全文仅 :586/:630 两处调 analyzeOutput） |
| execute_gdscript | `src\gdscript-executor.ts:1224` | ✓ | projectPath 在 :948 作用域内可用；临时 wrapper 路径非 res:// 自动跳过，项目脚本（如 preload 出错的 res://foo.gd）能获得 snippet |
| analyze_error action | `src\tools\validation.ts:630` | ✗ | 用户粘贴裸日志，无项目上下文，不传 projectPath |
| batch-tools | `src\tools\batch-tools.ts:319` | ✗ | :324 `errors.map(e => e.message)` 丢弃 snippet，改了无效（YAGNI） |

### 边界处理

| 情况 | 处理 |
|------|------|
| execute_gdscript 临时 wrapper 路径 | 自动跳过（非 `res://` 开头，buildSnippet 第 1 步守卫） |
| `user://` / 编辑器内置脚本 / 绝对路径 | 跳过（非 `res://`） |
| file 空 / line 空 / line ≤ 0 | 调用前守卫跳过 |
| 文件不存在 | `existsSync` 检查后跳过 |
| 路径遍历（伪造 `res://../../etc/passwd`） | resolveWithinRoot throw → catch 跳过 |
| CRLF / LF | `split(/\r?\n/)` |
| 行号越界 | `Math.min(lines.length, ...)` 钳位 |
| projectPath 未提供 | 调用前守卫，不启用 |

### 改动文件清单

| 文件 | 改动 |
|------|------|
| `src\error-analyzer.ts` | 新增 import + ParsedError.snippet + AnalyzeOptions 字段 + buildSnippet + enrichWithSnippet（+50） |
| `src\tools\validation.ts` | run_and_verify 的 analyzeOpts 加 projectPath（+1）。validate_scripts 走 batchValidateScripts 产 string[] 非 ParsedError，不启用 |
| `src\gdscript-executor.ts` | analyzeOutput 传 { projectPath }（改 1 行） |

---

## 验证方式

1. `npm run build-matrix` → `docs/capability-matrix.json` 每工具含 size 字段；`docs/capability-matrix.md` 含 token 预算汇总 + TOP5
2. `npm run check:budget` → 输出体积表，当前预期 1 warn（ui）、0 error、exit 0
3. `npx tsc --noEmit` → 0 error
4. `npx vitest run` → 全绿（size 是增量字段不破坏现有断言；error-analyzer 测试加 snippet 用例）
5. `npm run diff-matrix` → no drift（size 不进 drift）
6. error-analyzer 单元测试：构造 res:// file+line 的 ParsedError，mock 文件系统，验证 snippet 格式 + 边界（空文件/行号越界/CRLF/非 res:// 跳过/projectPath 不传跳过）

## 实施注记（审查 ADVISORY 补充）

- **analyzeOutput 纯函数性变化**：snippet 的 readFileSync 使 analyzeOutput 从纯解析函数引入 fs 副作用，单测须 mock fs（见验证方式第 6 条）。选内部 enrich（3 处 push 复用 `enrichWithSnippet`）是 DRY 权衡，接受此副作用。
- **schemaBytes 为下界估计**：紧凑序列化（无缩进）是 MCP 推送体积下界；若 SDK 带缩进推送，真实值更大。门禁留 ~70% 裕度覆盖此偏差。
- **execute_gdscript snippet 命中率**：用户错误是否以 res:// 上报取决于 wrapper inject 方式；命中不了仅降级为无 snippet（buildSnippet 返回 undefined），不影响错误本身的 type/message/suggestion。
- **budget check 非实时**：见上门禁设计注记（读 committed 快照，CI 顺序固定）。

## 不做的事（YAGNI）

- size 不纳入 diff-matrix drift（避免文案修改报 drift 噪声）
- batch-tools.ts 不启用 snippet（:324 丢弃 snippet，改了无效）
- analyze_error action 不启用（无项目上下文）
- ring buffer / GDScript 生成器去重不在本 spec（另批，不同子系统）
- error 阈值不收紧到阻塞发版（warn-only 基线，留增长空间）
