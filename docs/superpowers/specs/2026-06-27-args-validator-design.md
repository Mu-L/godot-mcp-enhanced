# ts-args-as-cast 统一入口参数验证设计 (args-validator)

**日期**: 2026-06-27
**分支**: feat/args-validator
**状态**: 已批准(R1 审查响应)→ 待 writing-plans
**来源**: superpowers:brainstorming + R1 审查
**对应 defect**: `ts-args-as-cast-no-validation`(OPEN,baseline 335)

## 修订记录

- **v1**(初版):brainstorming 产出(接入点 dispatchTool)
- **v1.1**(R1 审查响应,本次):接入点上移 `executeToolCall`(L229 `validateCommonArgs` 后、editor/headless 分叉前)+ 连带 detect 谓词/背景措辞/items 递归 + inline/additionalProperties/type 数组补充。审查 artifact:`D:\workspace\review\.claude\reviews\2026-06-27-args-validator-spec-review.md`

## 背景与问题

`test/regression/defects.ts` 的 `ts-args-as-cast-no-validation` defect detect:
```
countMatchesInDir('src/tools', /\bargs\.\w+\s+as\s+(string|number|Record<string,\s*unknown>|string\[\]|number\[\]|Array|unknown|boolean)/g)
```
baseline 335。

**实测(brainstorming 探索)**:
- 335 处 `args.x as type` 跨 30 文件(大头:`scene/index.ts` 21、`animtree.ts` 20、`particles.ts` 19、`game-bridge.ts` 16、`script.ts` 15)
- 模式:`const action = args.action as string;`(简单 const cast,部分有 truthy 检查,**无 typeof 验证**)
- **项目完全不用 zod**(0 处 `from 'zod'`)
- **无系统性 schema 验证**;已有 `validateCommonArgs`(`executeToolCall` L229)/`validatePathArgs`(L240)** ad-hoc 校验互补**,本设计补全**字段 schema 防线**(R1 #3 修订:非"无运行时验证")
- args 从 MCP request 来(`executeToolCall(name, args: Record<string, unknown>)`),**不可信**
- `src/capability/schema.ts` 是 `ToolCapability` **能力声明**(`inputSchema: object` 给 MCP 客户端),非服务端运行时验证
- 客户端传错类型 → 运行时 NaN/undefined/崩溃,**无清晰错误**

**inputSchema 实测**:每个 tool 有完整 JSON schema(`{ type:'object', properties:{ param:{type:'string',...} }, required:[...] }`),含 `type`/`required`/`enum`/`items`(含嵌套 object)。**可用于运行时验证**。

**tool 注册结构**:`ToolModule.getToolDefinitions(): Tool[]`(含 inputSchema),`getModuleForTool(name)` 返 module。inputSchema 可经 `getToolDefinition(name)` 访问。

## 目标

1. `executeToolCall` 统一入口(分叉前)对每个 tool 的 args 按 inputSchema 运行时验证(一处接入,全 tool 含 confirm 路径受益)
2. 验证失败 → 清晰 `INVALID_PARAMS` 错误(非崩溃)
3. 验证后 335 处 cast 变合理(args 已 type 校验)
4. defect detect 改查"入口验证接入",335→0

## 非目标 (YAGNI)

- **不**引入 zod/ajv(新依赖;手写覆盖 inputSchema 实际用的关键字够)
- **不**改 335 处 cast(验证后 cast 合理窄化;最小改动)
- **不**覆盖 JSON schema 高级关键字(`pattern`/`format`/`minLength`/`maxItems`)
- **不**改 MCP 客户端契约(inputSchema 不变,只加服务端验证)
- **不**拒未知字段(additionalProperties 兼容 MCP 客户端;见 §4 已知偏差)

## 设计

### §1 架构

| 组件 | 职责 | 动作 |
|------|------|------|
| `src/core/args-validator.ts` | 手写 JSON schema 验证器 `validateArgs` | Create |
| `src/core/tool-registry.ts` | 加 `getToolDefinition(name): Tool \| undefined` | Modify |
| `src/core/ToolDispatcher.ts` **`executeToolCall`** | **L229 `validateCommonArgs` 后、editor/headless 分叉前接入 `validateArgs`**(R1 #1:从 dispatchTool 上移) | Modify |
| `test/args-validator.test.ts` | 验证器单测 | Create |
| `test/regression/defects.ts` | detect 改查 `executeToolCall` 接入 + status/baseline 修订 | Modify |

**接入点 `executeToolCall` L229 后**(R1 #1):`validateCommonArgs`(L230)之后、`confirm_and_execute`(L244)/editor(L281)/headless(L337)分叉之前。**比 dispatchTool 早,全 tool 含 confirm 路径受益**。

**inline tool**(`confirm_and_execute`/`godot_advanced_tool`)经 `getToolDefinition` 返 `undefined` → 走 §4 跳过分支(R1 #5)。

**335 处 cast 保留不动**:验证后 args 已 type 校验,cast 是合理窄化。最小改动。

### §2 验证器覆盖(validateArgs)

```ts
validateArgs(args: Record<string, unknown>, schema: object): { ok: boolean; errors: string[] }
```

覆盖 inputSchema 实际用的 JSON schema 关键字:
- `type`:object/string/number/boolean/array/null + **支持 type 数组**(如 `['string','null']`,R1 #7;实施前 `grep "type:\s*\["` 确认 inputSchema 是否真用,无则记 TODO)
- `required`:必填字段缺失 → error
- `properties.<name>.type`:每字段类型校验(递归嵌套 object)
- `enum`:值在枚举内
- **`items` 递归**(R1 #4:`items.type` / `items.properties` / `items.required`;如 `batch-tools` `files[]` 是 array of object 含嵌套 `properties`(path/content/overwrite)+ `required:['path','content']` —— 验证器须递归,否则深层错类型漏到 handler 崩溃)

**不覆盖**(YAGNI):`pattern`/`format`/`minLength`/`maxItems`/`additionalProperties`。

**未知字段**:允许(不拒)。

### §3 数据流

MCP request → `handleCall` → **`normalizeArgs`**(args key → snake_case)→ `executeToolCall(name, args)` →
① 0.5 `project_path` 注入(L208)
② 0.6 findGodot 注入(L226)
③ 0. `validateCommonArgs`(L229-231)—— 已有 ad-hoc
④ **【新增】`validateArgs(args, getToolDefinition(name).inputSchema)`**(L231 后、L244 分叉前)→ 失败 `INVALID_PARAMS` / 通过继续
⑤ L233 ReadOnlyGuard、L240 `validatePathArgs`
⑥ L244 `confirm_and_execute` 分支 / L298 confirmation token / L337 `dispatchTool`(editor L281 / headless)

**`validateArgs` 接 `normalizeArgs` 之后的 args**(key 已 snake_case,与 inputSchema 一致;L208 `args.project_path` 实证)—— 顺带解决 key 一致性。

**`confirm_and_execute` 分支**(L244):外层 `args={token}` —— confirm_and_execute 为 inline tool,`getToolDefinition` 返 `undefined` → **④ 跳过**;token 由 L246 手动校验。**`pending.args`**(原始 tool args)在产生 token 那次调用(L303 `createPendingToken(name, args)`)已走 ④ 验证,**无需二次验证**。

### §4 错误处理

- 验证失败 → `opsErrorResult('INVALID_PARAMS', '参数 <field>: 期望 <type>,实际 <actual>')`,ToolResult 错误返回(**非抛异常/崩溃**)
- **inline tool**(`confirm_and_execute`/`godot_advanced_tool`)`getToolDefinition` 返 `undefined` → 跳过验证(不阻断),保留原行为(R1 #5)
- **已知偏差**:**7 处 inputSchema 设 `additionalProperties`(可能 false)将被忽略**(本设计未知字段允许;R1 #6。plan 阶段 grep 确认这 7 处是否需严格拒未知字段)
- tool 无 inputSchema(边缘)→ 跳过验证(不阻断)
- 未知字段:允许(additionalProperties 兼容)

### §5 detect 改法

当前(`defects.ts`):`countMatchesInDir(src/tools, /args.x as/)` = 335。

**改为查 `executeToolCall` 内含 `validateArgs`**(R1 #2:接入点已上移到 `executeToolCall`,原 detect 查 `dispatchTool` 会判未接入)。
新 detect 谓词:`readSrc('src/core/ToolDispatcher.ts')` 的 `executeToolCall` 段不含 `validateArgs` 调用 → detect=1(未接入);含 → detect=0(接入)。

**实施动作**(R1 #2):接入后在 `defects.ts` 把该条 `status:'open'→'fixed'`、`baseline:335→0`,移到 `FIXED_DEFECTS` 硬断言 `detect===0`(防去验证化回归)。

detect 语义从"335 处 cast"转为"入口验证是否就位"(直接衡量"无验证"风险)。baseline 335→0。

### §6 测试

- `test/args-validator.test.ts`:`validateArgs` 各关键字正反例
  - type 正反(string/number/boolean/array/object)+ **type 数组**(`['string','null']`)
  - required 缺失 → error
  - enum 非法值 → error
  - **items 递归**(batch-tools `files[]` array of object 嵌套 properties+required,深层错类型 → error)
  - 嵌套 properties
  - 未知字段允许
- `executeToolCall` 集成:错类型 args → `INVALID_PARAMS`(不传 handler)
- defect detect:接入后 detect=0

## 验收标准

- [ ] `src/core/args-validator.ts` 实现 `validateArgs`(type/required/enum/**items 递归**/properties/**type 数组**)
- [ ] `getToolDefinition(name)` 在 tool-registry 实现
- [ ] **`executeToolCall` L229 后接入**(validateArgs,非 dispatchTool)
- [ ] 错类型 args → `INVALID_PARAMS` 清晰错误(集成测试)
- [ ] `test/args-validator.test.ts` 全绿(含 items 递归用例)
- [ ] defect detect 改"`executeToolCall` 接入" + `status:'fixed'`/`baseline:0`(移 FIXED)
- [ ] 现有全测试无回归
- [ ] `npm run lint` + `tsc --noEmit` clean

## 影响范围

- 新增:`src/core/args-validator.ts`、`test/args-validator.test.ts`
- 修改:`src/core/tool-registry.ts`(`getToolDefinition`)、`src/core/ToolDispatcher.ts`(`executeToolCall` L229 后接入)、`test/regression/defects.ts`(detect 改 + status/baseline)
- 不改:`src/tools/*` 的 335 处 cast(保留)、inputSchema 定义、MCP 客户端契约、zod(不引入)
