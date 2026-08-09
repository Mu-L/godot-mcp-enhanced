# 第三方审查:Tier1-1 关键工具加 structuredContent

> 审查日期: 2026-08-09
> 审查者: code-reviewer 子 agent(隔离视角)
> 审查对象: 分支 feat/tier1-1-structured-content(commit 3f6361e)
> 审查方法: 所有声明经 grep / read / SDK 源码实测核实

## 总体判定

**SHIPPED WITH NITS**

改动设计正确,中间件透传链完整,测试覆盖核心路径且断言充分,仓库级约束(.claude/rules、capability-matrix、version-bump)均不触发。无 Blocking 问题。存在 3 个可改进的 Nit(负面断言缺失、BLOCKED_PROPS 部分成功路径未带 structuredContent、width/height 字段名无限定词),不影响发版。

**作者后续处理**:Nit-1(负面断言)与 Nit-3(width/height 重命名)已当场修复,Nit-2(BLOCKED_PROPS)留后续。

## 逐维度结论

### 1. 设计正确性 — 通过

**(a) structuredContent 类型安全(非对象 fallback 风险)** — 已核实 SDK 源码不触发 fallback。

核实 `D:\GitHub\godot-mcp-enhanced\node_modules\@modelcontextprotocol\server\dist\src-CX2iR2pK.mjs:579-591` 的 `appendTextFallbackForNonObject`:

- line 582: 对象型 structuredContent → 直接返回
- line 583: 已有 text block → 直接返回

本次 5 处 structuredContent 全是对象字面量,且全部由 textResult() 或 content 数组提供 text block,**不会**触发 stringify fallback。

**(b) add_node `persisted: true` 取值正确** — writeFileSync(line 205)在 structuredContent(line 215-225)之前。addNode 成功路径恒返回 scene 非空,writeFileSync 必执行。

**(c) blank_warning 条件展开正确** — `...(blankWarning !== '' && { blank_warning: true })`,空字符串 falsy 不展开,非空展开。测试覆盖两端。

**(d) spread 不破坏 content 数组** — textResult 返回的 content 数组引用被复制,不被修改。

### 2. 中间件透传 — 通过(关键风险点已全部核实)

| 中间件 | 文件:行 | 透传方式 | 结论 |
|--------|---------|---------|------|
| response-limiter(2-4MB 警告) | `src\core\response-limiter.ts:191-200` | `{ ...response, content: [...] }` | 保留 |
| response-limiter(>4MB 截断) | `src\core\response-limiter.ts:238` | `{ ...response, content: newContent }` | 保留 |
| response-limiter(fallback) | `src\core\response-limiter.ts:242-251` | `{ ...response, content: [...] }` | 保留 |
| persistence-warning | `src\tools\shared\persistence-warning.ts:20` | `{ ...result, content: [...] }` | 保留 |
| ToolDispatcher headless dispatch | `src\core\ToolDispatcher.ts:772` | `truncateResponse({ ...result, content: [...] })` | 保留 |
| ToolDispatcher editor 路径 | `src\core\ToolDispatcher.ts:440, 718` | `truncateResponse({ ...editorResult, content })` | 保留 |
| attachFallbackWarning | `src\core\ToolDispatcher.ts:824` | `{ ...result, content: [...] }` | 保留 |

7 个包装点全部用 spread,无字段白名单。透传链完整。

### 3. 测试质量 — 基本通过,补负面断言后完整

- scene-operations-mock 断言强(5 字段具体值)。
- screenshot 5 测试覆盖 capture(正常+blank_warning)+ analyze(三 detail)。
- mock 正确(captureScreenshot + findGodot)。
- **Nit-1 已修复**:补负面断言验证错误路径不带 structuredContent。

### 4. 范围完整性 — 通过,范围界定合理

- add_node spawn fallback 路径(行 196)未加 — stdout 来自 GDScript 无法解析,合理。
- BLOCKED_PROPS 部分成功路径(行 208)未加 — Nit-2,留后续。
- edit_node/batch_add_nodes 未加 — 同 spawn fallback 道理。
- screenshot capture + analyze 三 detail 全改 — 无遗漏。
- **原则**:只给 TS 侧有确定性结构化信息的路径加。

### 5. 仓库级约束核查 — 通过

- 不涉及 .claude/rules/ 或 rule-templates.ts(grep 无命中)。
- 不触发 build-matrix(structuredContent 是返回字段,不在 inputSchema)。
- 不触发 check-rules-version-bump。

### 6. 验证完整性 — 通过

- build 产物含 structuredContent(已核实 build/tools/screenshot.js + build/tools/scene/index.js)。
- git diff --stat 确认仅 4 文件(作者补跑)。
- lint+test 全绿(作者补跑:4802 passed,1 失败是无关 e2e 环境竞态)。

### 7. 潜在问题深挖

**(a) 字段命名 snake_case** — 有意对齐现有惯例(MCP inputSchema、capability-matrix、normalizeArgs 全 snake_case),非疏忽。

**(b) screenshot capture width/height 语义(Nit-3 已修复)** — 原用 viewportW/viewportH(入参配置)非 result.width(实际截图维度),字段名无限定词易误解。**已修复**:重命名为 viewport_width/viewport_height。

**(c) add_node parent 回显原始入参** — 与 inputSchema 描述一致(描述说"默认 root"),对 AI 透明。

## Blocking Issues

无。

## Nits

### Nit-1: 缺负面断言 ✅ 已修复

**位置**: test/screenshot-structured-content.test.ts、test/scene-operations-mock.test.js

**问题**: 现有测试只验证成功路径有 structuredContent,未验证错误路径不带。

**修复**: 作者补了负面断言(capture 失败路径验证 structuredContent undefined)。

### Nit-2: BLOCKED_PROPS 部分成功路径未带 structuredContent(留后续)

**位置**: src/tools/scene/index.ts:208-213

**问题**: 该路径节点已落盘但 BLOCKED_PROPS 属性未写,AI 拿不到结构化信息。persisted 语义模糊。

**建议**: 后续补 `structuredContent: { ..., persisted: true, blocked_props: result.blockedProps }`。

### Nit-3: screenshot capture width/height 字段名无限定词 ✅ 已修复

**位置**: src/tools/screenshot.ts:132-133

**问题**: width/height 取 viewportW/viewportH(配置),非 result.width(实际维度),字段名易误解。

**修复**: 作者重命名为 viewport_width/viewport_height,同步更新测试断言。

## 值得进 memory 的工程教训

### structuredContent 中间件透传核查方法

给工具加 structuredContent 后,必须核查整条中间件透传链是否用 spread。核查命令:`grep -rn "\.\.\.response\|\.\.\.result" src/core/response-limiter.ts src/core/ToolDispatcher.ts src/tools/shared/persistence-warning.ts`。本次 7 个包装点全用 spread,透传链完整。

### SDK appendTextFallbackForNonObject 触发条件

MCP SDK 的 appendTextFallbackForNonObject 只在 structuredContent 是非对象(array/primitive/null)且 handler 无 text block 时追加。对象型 + 已有 text block 不触发。源码:`node_modules/@modelcontextprotocol/server/dist/src-CX2iR2pK.mjs:579-591`。

### 范围界定原则:只给 TS 侧有结构化信息的路径加 structuredContent

structuredContent 只加在 TS 侧能确定性填充所有字段的路径;无法确定的留后续,不要编造或部分填充误导 AI。

---

**相关文件路径(绝对路径)**:
- 改动源: `D:\GitHub\godot-mcp-enhanced\src\tools\scene\index.ts`、`D:\GitHub\godot-mcp-enhanced\src\tools\screenshot.ts`
- 改动测试: `D:\GitHub\godot-mcp-enhanced\test\scene-operations-mock.test.js`、`D:\GitHub\godot-mcp-enhanced\test\screenshot-structured-content.test.ts`
- 中间件透传链(未改但已核查): `D:\GitHub\godot-mcp-enhanced\src\core\response-limiter.ts`、`D:\GitHub\godot-mcp-enhanced\src\core\ToolDispatcher.ts`、`D:\GitHub\godot-mcp-enhanced\src\tools\shared\persistence-warning.ts`
- SDK fallback 逻辑: `D:\GitHub\godot-mcp-enhanced\node_modules\@modelcontextprotocol\server\dist\src-CX2iR2pK.mjs:579-591`
