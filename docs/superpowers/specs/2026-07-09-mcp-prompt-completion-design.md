---
date: 2026-07-09
topic: mcp-prompt-completion
status: draft
related:
  - 2026-07-08-mcp-logging-design.md
  - 2026-07-09-mcp-elicitation-design.md
  - 资料-官方MCP servers借鉴对照.md（Phase 3 P2-6 Prompts 升级）
source: 官方 MCP servers 借鉴对照报告 Phase 3 P2-6
---

# MCP Prompt Completion（参数自动补全 MVP）设计

## 1. 背景与动机

官方 MCP servers 借鉴对照报告 Phase 3 P2-6「Prompts 升级」：

- MCP 协议规定 client 可对 prompt 参数请求补全（`completion/complete`），server 返回候选值。SDK 提供 `CompleteRequestSchema`（`node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts:5456`，低层）+ `completable()` 高层 API（`server/completable.d.ts:16`）。
- 本项目 `src/prompts.ts` 4 个静态 prompt 模板（create_platformer / setup_player_controller / optimize_scene / debug_performance），**纯字符串插值**，参数无补全配置。
- `src/GodotServer.ts:176/180` 有 ListPrompts / GetPrompt handler，但**无 Complete handler**——client 无法对 prompt 参数请求补全。
- 官方 everything server 用 `completable()`（含依赖补全）；godot-mcp 用低层 Server + 自定义 PromptDef，需 `setRequestHandler(CompleteRequestSchema)`。

**价值**：client（Claude Code）填 prompt 参数时弹补全（如 optimize_scene.scene_path 下拉项目场景列表，dimension 选 2d/3d），减少手输错误 + 提速。

## 2. 目标

1. 加 CompleteRequest handler：client 对 prompt 参数请求补全 → 返回候选值。
2. PromptDef 加 completion 配置（声明式，配 prompt 定义）。
3. enum + scenes 两类补全源。
4. **失败安全**：未知 prompt/参数/无配置/glob 失败 → 空 values（补全是增强，失败降级）。

## 3. 非目标（YAGNI）

- ❌ **动态 prompt**（build 读项目状态生成动态指导）：另 feature，留 follow-up。
- ❌ **内嵌资源**（PromptMessage content 嵌 resource）：低优先。
- ❌ **依赖补全**（argument 依赖另一 argument，如 everything completions.ts）：MVP 独立补全。
- ❌ **resource 补全**（`ref/resource`）：MVP 只 `ref/prompt` 参数。

## 4. 架构

### 4.1 prompts.ts 扩展（PromptDef.completion + getPromptDef 导出 + resolveCompletion）

```typescript
export type CompletionSource =
  | { type: 'enum'; values: string[] }   // 固定枚举
  | { type: 'scenes' };                   // 项目 .tscn 列表

export interface PromptDef {
  name: string;
  description: string;
  arguments?: Array<{
    name: string; description: string; required?: boolean;
    completion?: CompletionSource;        // 新增
  }>;
}

/** 按 name 查单个 PromptDef（CompleteRequest handler 用，访问 completion 配置的唯一干净路径） */
export function getPromptDef(name: string): PromptDef | undefined {
  return PROMPTS[name]?.def;
}

/** 解析补全源 → values（按 prefix 过滤） */
export async function resolveCompletion(
  source: CompletionSource, prefix: string, projectPath?: string
): Promise<string[]>
```

> **⚠️ PROMPTS 未导出（实现盲点，必须用 getPromptDef）**
>
> `PROMPTS`（prompts.ts:20）是模块私有（`const`，非 export）。CompleteRequest handler 在 GodotServer.ts，**访问不到 PROMPTS**。必须新增 `getPromptDef(name)` 导出（返回 `PROMPTS[name]?.def`），handler 经它拿 completion 配置。**不要** `export PROMPTS`（破坏封装）。

补全应用（4 prompt 参数，enum 值与 build 默认一致）：
- `create_platformer.resolution` → enum `['1280x720','1920x1080','2560x1440']`（build 默认 `1280x720`，:32）
- `setup_player_controller.dimension` → enum `['2d','3d']`（build 默认 `2d`，:46）
- `setup_player_controller.movement_type` → enum `['topdown','platformer','fps']`（build 默认 `platformer`，:46）
- `optimize_scene.scene_path` → scenes（项目 `res://**/*.tscn`，build 默认 `res://scenes/main.tscn`，:59）
- `create_platformer.project_name`（自由文本）/ `debug_performance`（无参数）→ 无 completion

resolveCompletion 实现：
- enum：`source.values.filter(v => v.startsWith(prefix))`
- scenes：glob `projectPath/**/*.tscn`（复用现有 file-scanner 或 node:fs.glob），归一化为 `res://` 路径，过滤 prefix

### 4.2 GodotServer 加 CompleteRequest handler（:176 区 ListPrompts/GetPrompt 旁）

```typescript
import { ..., CompleteRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getPromptDef, resolveCompletion } from './prompts.js';

this.server.setRequestHandler(CompleteRequestSchema, async (request) => {
  const { ref, argument } = request.params;
  if (ref.type !== 'ref/prompt') {
    return { completion: { values: [], total: 0, hasMore: false } };
  }
  const argDef = getPromptDef(ref.name)?.arguments?.find(a => a.name === argument.name);
  if (!argDef?.completion) {
    return { completion: { values: [], total: 0, hasMore: false } };
  }
  const all = await resolveCompletion(argDef.completion, argument.value, resolveProjectPath());
  const MAX = 100;
  const truncated = all.slice(0, MAX);
  return { completion: { values: truncated, total: truncated.length, hasMore: all.length > MAX } };
});
```

## 5. 数据流

```
client completion/complete（ref={type:'ref/prompt', name}, argument={name, value}）
 → GodotServer CompleteRequest handler
   → ref.type === 'ref/prompt'? 否 → 空 values
   → getPromptDef(ref.name)?.arguments?.find(argument.name)?.completion
   → 无配置 → 空 values
   → resolveCompletion(source, value 前缀, projectPath)
     → enum: filter values.startsWith(prefix)
     → scenes: glob projectPath/**/*.tscn, 归一化 res://, 过滤 prefix
   → 上限截断（MAX=100, hasMore）
   → { completion: { values, total, hasMore } }
```

## 6. 错误处理

- **未知 prompt / 未知参数 / 参数无 completion** → 空 values（`{values:[],total:0,hasMore:false}`），不报错
- **ref 非 ref/prompt**（如 `ref/resource`）→ 空 values（MVP 只 prompt 参数补全）
- **scenes glob 失败**（无 projectPath / IO 错误）→ 空 values（补全是增强，失败降级空）
- **scenes 上限**：glob 结果可能很多（大项目几百 .tscn）。**截断 MAX=100 + hasMore:true**（MCP 规范允许 hasMore 提示 client 还有更多），避免 completion 响应过大。

## 7. 测试

**resolveCompletion 单元**（prompts.ts）：
- enum：filter prefix（`'12'` → `['1280x720']`；空 prefix → 全部）
- scenes：mock glob 返回 .tscn 列表，归一化 `res://`，filter prefix
- 无 projectPath（scenes）→ 空

**CompleteRequest handler 集成**（GodotServer）：
- 已知 prompt + enum 参数 → values 过滤 prefix
- 已知 prompt + scenes 参数 → 项目 .tscn（mock glob）
- 未知 prompt / 未知参数 / 无 completion → 空 values
- ref 非 ref/prompt → 空 values
- scenes 超 MAX → 截断 + hasMore:true

## 8. 决策记录

- **方案 A（PromptDef.completion 声明式）> B（registry）/ C（SDK completable）**：A 配 prompt 定义，集中可读。B 补全逻辑散落两处。C godot-mcp 低层 Server + 自定义 PromptDef，不适配 SDK completable 高层。
- **getPromptDef 导出（必须）**：PROMPTS 模块私有，handler 访问不到。getPromptDef 是唯一干净路径（不破坏封装）——勿 export PROMPTS。
- **enum + scenes 两类补全源**：enum 覆盖固定枚举参数（dimension/movement_type/resolution），scenes 覆盖项目资源参数（scene_path）。MVP 足够。
- **scenes 上限 MAX=100 + hasMore**：防大项目 completion 响应过大。
- **completion only MVP**：动态 prompt / 内嵌资源 / 依赖补全 = follow-up YAGNI。

## 9. 行号卫生 + plan 核对

本文行号基于当前 master（`12aab2e`，含 Elicitation feature）。**实现时以实际为准**。

**plan 阶段必须核对**（字段名推断，`ref` 结构已 100% 验证）：
- `CompleteRequestSchema`（types.d.ts:5456-5470）：`params.ref`（union `ref/prompt` | `ref/resource`）、`params.argument`（`{name, value}`）字段名
- `CompleteResultSchema`（types.d.ts:5492）：`completion`（`{values, total, hasMore}`）字段名
- plan 阶段对照 SDK 逐字确认，免得 `values`/`total`/`hasMore` 实际叫别的。
