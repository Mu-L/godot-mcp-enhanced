// src/core/dynamic-schema.ts
// CMP-16-B (2026-08-08): live schema 构建 — 从 editor addon 拉 param docs 动态生成 MCP 工具。
//
// 对标竞品 regiellis/godot-mcp-go 的 serve.go fetchTypedTools + buildTypedTools。
// GD 侧 list_param_docs(command_handler.gd)返回 {method: {description, params: [{name,type,required,desc}]}}。
// 本模块拉取后构建成 MCP Tool[] 供 tools/list merge,让 AI 看到 addon 注册的命令为独立工具。
//
// 设计要点:
// - 懒加载 + 缓存:首次拉取后缓存,editor 重连时刷新(对标竞品,但修其"只 fetch 一次不刷新"缺陷)
// - 离线降级:editor 未连接时返回空数组(只留 godot_advanced_tool 兜底代理,对标竞品)
// - 排序保证幂等:method 名排序后构建,避免每次 tools/list 工具顺序变化
// - 名字冲突保留先到:多个 group 偶尔撞名,保留第一个 + 日志(对标竞品)
// - 体积自限:构建出的工具总字节超阈值则截断(防撑爆 tools/list)

import type { Tool } from '@modelcontextprotocol/server';
import { getLogger } from './logger.js';

const log = getLogger();

/** GD param docs 返回的单个参数定义(GD 侧 CommandHelpers.doc_param 产出) */
interface GdParamDoc {
  name: string;
  type: string;
  required: boolean;
  desc: string;
}

/** GD param docs 返回的单个 method 定义 */
interface GdCommandDoc {
  description: string;
  params: GdParamDoc[];
}

/** 拉取 docs 的 provider 接口(由 GodotServer 注入,解耦对 EditorConnection 的依赖) */
export type DocsFetcher = () => Promise<Record<string, GdCommandDoc> | null>;

/** 动态工具构建体积上限(防撑爆 tools/list)。总描述+schema 字节。 */
const MAX_DYNAMIC_TOOLS_BYTES = 100_000;

/** GD param docs 的 method 名 → MCP tool 名(去前缀/特殊字符)。
 * 竞品用 `.` → `_`;enhanced 的 method 名已是扁平下划线(engine_class_info 等),
 * 直接用作 tool 名。若与静态工具冲突则跳过(静态优先)。 */
function methodToToolName(method: string): string {
  return method.replace(/\./g, '_');
}

/** Godot 类型名 → JSON schema type(对标竞品 jsonSchemaType + GD CommandHelpers.godot_type_to_schema_type) */
export function godotTypeToSchemaType(t: string): string | undefined {
  switch (t) {
    case 'String': case 'NodePath': case 'Vector2': case 'Vector2i':
    case 'Vector3': case 'Vector3i': case 'Vector4': case 'Vector4i':
    case 'Color': case 'Rect2': case 'Rect2i':
    case 'Plane': case 'Quaternion': case 'Basis':
    case 'Transform2D': case 'Transform3D':
      return 'string';
    case 'int': return 'integer';
    case 'float': return 'number';
    case 'bool': return 'boolean';
    case 'Array': return 'array';
    case 'Dictionary': case 'Object': return 'object';
    default: return undefined; // JSON/未知/Variant → 省略 type(any)
  }
}

/** 从单个 GD command doc 构建 MCP Tool。
 * 对标竞品 buildTool:name = method,description = doc.description,
 * inputSchema.properties 从 params 构建,required 从 params.filter(required) 取。 */
export function buildToolFromDocs(methodName: string, doc: GdCommandDoc): Tool {
  const toolName = methodToToolName(methodName);
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const p of doc.params ?? []) {
    const prop: Record<string, unknown> = { description: p.desc };
    const schemaType = godotTypeToSchemaType(p.type);
    if (schemaType) {
      prop.type = schemaType;
    }
    // JSON/未知类型省略 type(等价 any),对标竞品
    properties[p.name] = prop;
    if (p.required) {
      required.push(p.name);
    }
  }

  const inputSchema: Tool['inputSchema'] = {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  } as Tool['inputSchema'];

  return {
    name: toolName,
    description: doc.description,
    inputSchema,
  };
}

/** 从全量 GD docs 构建排序后的 Tool[](对标竞品 buildTypedTools)。
 *  排序保证幂等;名字冲突保留先到 + 日志;体积超限截断。 */
export function buildAllDynamicTools(
  docs: Record<string, GdCommandDoc>,
  staticToolNames: Set<string>,
): Tool[] {
  const methods = Object.keys(docs).sort(); // 字母序排序(幂等)
  const seen = new Set<string>();
  const tools: Tool[] = [];
  let totalBytes = 0;

  for (const method of methods) {
    const toolName = methodToToolName(method);
    // 跳过与静态工具冲突的(method 名撞静态 tool 名,静态优先)
    if (staticToolNames.has(toolName)) {
      log.debug('dynamic-schema', `skip ${method}: conflicts with static tool name`);
      continue;
    }
    // 跳过名字冲突(多 group 撞名,保留先到)
    if (seen.has(toolName)) {
      log.debug('dynamic-schema', `skip ${method}: name collision (kept first)`);
      continue;
    }
    seen.add(toolName);

    const doc = docs[method];
    if (!doc) continue; // noUncheckedIndexedAccess 防御
    const tool = buildToolFromDocs(method, doc);
    const toolBytes = Buffer.byteLength(JSON.stringify(tool), 'utf8');
    if (totalBytes + toolBytes > MAX_DYNAMIC_TOOLS_BYTES) {
      log.warn('dynamic-schema', `truncating dynamic tools at ${totalBytes} bytes (limit ${MAX_DYNAMIC_TOOLS_BYTES})`);
      break;
    }
    totalBytes += toolBytes;
    tools.push(tool);
  }

  // 工具内部排序(名字字母序),保证 tools/list 输出稳定
  tools.sort((a, b) => a.name.localeCompare(b.name));
  return tools;
}

/** Live schema 缓存管理器。
 *  首次 getDynamicTools() 时拉取;editor 重连时调 invalidate() 刷新。
 *  editor 离线时返回空数组(降级)。 */
export class DynamicSchemaCache {
  private cachedTools: Tool[] | null = null;
  private fetcher: DocsFetcher | null = null;
  private staticToolNames: Set<string> = new Set();

  /** 设置 docs 拉取器(由 GodotServer 注入,封装 EditorConnection.request) */
  setFetcher(fetcher: DocsFetcher | null): void {
    this.fetcher = fetcher;
    this.invalidate(); // 换 fetcher 时清缓存
  }

  /** 设置静态工具名集合(用于冲突检测,动态工具不覆盖静态) */
  setStaticToolNames(names: Set<string>): void {
    this.staticToolNames = names;
  }

  /** 获取动态工具列表(带缓存)。
   *  editor 离线或拉取失败时返回空数组(降级,只留 godot_advanced_tool 兜底)。 */
  async getDynamicTools(): Promise<Tool[]> {
    if (this.cachedTools) return this.cachedTools;
    if (!this.fetcher) return [];

    try {
      const docs = await this.fetcher();
      if (!docs || Object.keys(docs).length === 0) {
        this.cachedTools = [];
        return [];
      }
      this.cachedTools = buildAllDynamicTools(docs, this.staticToolNames);
      log.info('dynamic-schema', `fetched ${this.cachedTools.length} dynamic tools from editor`);
      return this.cachedTools;
    } catch (err) {
      // editor 离线/超时/返回格式错 → 降级空数组(对标竞品 fetchTypedTools 失败降级)
      log.warn('dynamic-schema', `fetch dynamic tools failed (degraded to empty): ${(err as Error).message}`);
      this.cachedTools = [];
      return [];
    }
  }

  /** 清除缓存(下次 getDynamicTools 重新拉取)。
   *  editor 重连/断开时调用,确保工具集反映最新 addon 注册状态。 */
  invalidate(): void {
    this.cachedTools = null;
  }
}

/** 全局单例(GodotServer 持有并注入 fetcher) */
export const dynamicSchema = new DynamicSchemaCache();
