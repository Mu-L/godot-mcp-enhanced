# ts-args-as-cast 统一入口参数验证设计 (args-validator)

**日期**: 2026-06-27
**分支**: feat/args-validator
**状态**: 已批准 → 待 writing-plans
**来源**: superpowers:brainstorming 会话
**对应 defect**: `ts-args-as-cast-no-validation`(OPEN,baseline 335)

## 背景与问题

`test/regression/defects.ts` 的 `ts-args-as-cast-no-validation` defect detect:
```
countMatchesInDir('src/tools', /\bargs\.\w+\s+as\s+(string|number|Record<string,\s*unknown>|string\[\]|number\[\]|Array|unknown|boolean)/g)
```
baseline 335。

**实测(brainstorming 探索)**:
- 335 处 `args.x as type` 跨 30 文件(大头:`scene/index.ts` 21、`animtree.ts` 20、`particles.ts` 19、`game-bridge.ts` 16、`script.ts` 15、`signal/animation-ops` 14、`ik-tools` 12)
- 模式:`const action = args.action as string;`(简单 const cast,部分有 `if (!action)` truthy 检查,**无 typeof 验证**)
- **项目完全不用 zod**(0 处 `from 'zod'`),无运行时 schema 验证
- args 从 MCP request 来(`executeToolCall(name, args: Record<string, unknown>)` → `dispatchTool`),**不可信**
- `src/capability/schema.ts` 是 `ToolCapability` **能力声明**(`inputSchema: object` 给 MCP 客户端),非服务端运行时验证
- 客户端传错类型 → 运行时 NaN/undefined/崩溃,**无清晰错误**

**inputSchema 实测**:每个 tool 有完整 JSON schema(`{ type:'object', properties:{ param:{type:'string',description}, ... }, required:[...] }`),含 `type`/`required`/`enum`(如 `batch-tools` action enum)/`items`。**可用于运行时验证**。

**tool 注册结构**:`ToolModule.getToolDefinitions(): Tool[]`(含 inputSchema),`getModuleForTool(name)` 返 module,`dispatchTool` 是共同入口。inputSchema 可经 `getToolDefinition(name)` 访问。

## 目标

1. ToolDispatcher 统一入口对每个 tool 的 args 按 inputSchema 运行时验证(一处接入,全 tool 受益)
2. 验证失败 → 清晰 `INVALID_PARAMS` 错误(非崩溃)
3. 验证后 335 处 cast 变合理(args 已 type 校验)
4. defect detect 改查"入口验证接入",335→0

## 非目标 (YAGNI)

- **不**引入 zod/ajv(新依赖;手写覆盖 inputSchema 实际用的关键字够防类型崩溃)
- **不**改 335 处 cast(验证后 cast 合理窄化;最小改动)
- **不**覆盖 JSON schema 高级关键字(`pattern`/`format`/`minLength`/`maxItems`;inputSchema 少用,基础够)
- **不**改 MCP 客户端契约(inputSchema 不变,只加服务端验证)
- **不**拒未知字段(additionalProperties 兼容 MCP 客户端传额外字段)

## 设计

### §1 架构

| 组件 | 职责 | 动作 |
|------|------|------|
| `src/core/args-validator.ts` | 手写 JSON schema 验证器 `validateArgs` | Create |
| `src/core/tool-registry.ts` | 加 `getToolDefinition(name): Tool \| undefined`(从 module 找 inputSchema) | Modify |
| `src/core/ToolDispatcher.ts` | `dispatchTool` 入口接入 validateArgs | Modify |
| `test/args-validator.test.ts` | 验证器单测 | Create |
| `test/regression/defects.ts` | detect 改查"入口接入" | Modify |

**335 处 cast 保留不动**:验证后 args 已 type 校验,cast 是合理窄化。最小改动,不强制改 335 处。

### §2 验证器覆盖(validateArgs)

```ts
validateArgs(args: Record<string, unknown>, schema: object): { ok: boolean; errors: string[] }
```

覆盖 inputSchema 实际用的 JSON schema 关键字:
- `type`:object/string/number/boolean/array/null(顶层 + 每字段)
- `required`:必填字段缺失 → error
- `properties.<name>.type`:每字段类型校验
- `enum`:值在枚举内
- `items`:数组元素 type(基础)

**不覆盖**(YAGNI):`pattern`/`format`/`minLength`/`maxItems`/`additionalProperties` 等。

**未知字段**:允许(不拒)。MCP 客户端可能传额外字段(如 `project_path` 全局),拒会破坏兼容。

### §3 数据流

MCP request → `executeToolCall(name, args)` → `dispatchTool(name, args)` →
① `getModuleForTool(name)` 拿 module(已存在,line 517)
② `getToolDefinition(name)` 拿 inputSchema(新增,从 `module.getToolDefinitions()` 找)
③ `validateArgs(args, inputSchema)` →
  - **失败**:`opsErrorResult('INVALID_PARAMS', '参数 <field>: 期望 <type>,实际 <actual>')`
  - **通过**:`handleTool(name, args, ctx)`(args 已 type 校验,335 处 cast 合理)

### §4 错误处理

- 验证失败 → `opsErrorResult('INVALID_PARAMS', 字段 + 原因)`,ToolResult 错误返回(**非抛异常/崩溃**)
- tool 无 inputSchema(边缘,如内部分发工具):跳过验证(不阻断),保留原行为,记录 debug 日志
- 未知字段:允许(additionalProperties 兼容)

### §5 detect 改法(关键)

当前(`defects.ts`):`countMatchesInDir(src/tools, /args.x as/)` = 335(静态查 cast,无法知道已验证)。

**改为查"入口验证接入"**:`dispatchTool` 含 `validateArgs` 调用 = 1 处统一接入(全 tool 覆盖)。
新 detect 谓词:`readSrc('src/core/ToolDispatcher.ts')` 不含 `validateArgs` 调用 → detect=1(未接入);含 → detect=0(接入)。

detect 语义从"335 处 cast"(间接、噪音多)转为"入口验证是否就位"(直接衡量"无验证"风险)。
baseline:335 → 0(接入后)。defect 状态可后续转 FIXED(detect===0 硬断言)。

### §6 测试

- `test/args-validator.test.ts`:`validateArgs` 各关键字正反例
  - type 正反(string/number/boolean/array/object)
  - required 缺失 → error
  - enum 非法值 → error
  - items 数组元素 type
  - 嵌套 properties
  - 未知字段允许
- `ToolDispatcher` 集成(复用现有 dispatcher 测试或加):错类型 args → `INVALID_PARAMS`(不传 handler)
- defect detect:接入后 detect=0

## 验收标准

- [ ] `src/core/args-validator.ts` 实现 `validateArgs`(type/required/enum/items/properties)
- [ ] `getToolDefinition(name)` 在 tool-registry 实现
- [ ] `dispatchTool` 入口接入(validateArgs 后才 handleTool)
- [ ] 错类型 args → `INVALID_PARAMS` 清晰错误(集成测试)
- [ ] `test/args-validator.test.ts` 全绿
- [ ] defect detect 改"入口接入",接入后 detect=0
- [ ] 现有全测试无回归(2909+ 基线)
- [ ] `npm run lint` + `tsc --noEmit` clean

## 影响范围

- 新增:`src/core/args-validator.ts`、`test/args-validator.test.ts`
- 修改:`src/core/tool-registry.ts`(getToolDefinition)、`src/core/ToolDispatcher.ts`(dispatchTool 接入)、`test/regression/defects.ts`(detect 改)
- 不改:`src/tools/*` 的 335 处 cast(保留)、inputSchema 定义、MCP 客户端契约、zod(不引入)
