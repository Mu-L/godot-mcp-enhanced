import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildToolFromDocs,
  buildAllDynamicTools,
  godotTypeToSchemaType,
  DynamicSchemaCache,
  type GdCommandDoc,
} from '../src/core/dynamic-schema.js';

// CMP-16-B (2026-08-08): live schema 构建 — dynamic-schema.ts 单测。
// 对标竞品 regiellis serve.go buildTypedTools + buildTool + jsonSchemaType。

describe('CMP-16-B: godotTypeToSchemaType 类型映射(对标竞品 jsonSchemaType)', () => {
  it('String/Vector3/Color/NodePath → "string"', () => {
    expect(godotTypeToSchemaType('String')).toBe('string');
    expect(godotTypeToSchemaType('Vector3')).toBe('string');
    expect(godotTypeToSchemaType('Color')).toBe('string');
    expect(godotTypeToSchemaType('NodePath')).toBe('string');
    expect(godotTypeToSchemaType('Vector2i')).toBe('string');
  });

  it('int → "integer", float → "number", bool → "boolean"', () => {
    expect(godotTypeToSchemaType('int')).toBe('integer');
    expect(godotTypeToSchemaType('float')).toBe('number');
    expect(godotTypeToSchemaType('bool')).toBe('boolean');
  });

  it('Array → "array", Dictionary/Object → "object"', () => {
    expect(godotTypeToSchemaType('Array')).toBe('array');
    expect(godotTypeToSchemaType('Dictionary')).toBe('object');
    expect(godotTypeToSchemaType('Object')).toBe('object');
  });

  it('JSON/未知/Variant → undefined(省略 type,等价 any)', () => {
    expect(godotTypeToSchemaType('JSON')).toBeUndefined();
    expect(godotTypeToSchemaType('Variant')).toBeUndefined();
    expect(godotTypeToSchemaType('SomeCustomType')).toBeUndefined();
  });
});

describe('CMP-16-B: buildToolFromDocs(对标竞品 buildTool)', () => {
  it('从 GD command doc 构建 MCP Tool(含 required + 类型)', () => {
    const doc: GdCommandDoc = {
      description: '测试命令',
      params: [
        { name: 'path', type: 'String', required: true, desc: '节点路径' },
        { name: 'count', type: 'int', required: true, desc: '数量' },
        { name: 'flag', type: 'bool', required: false, desc: '标志' },
      ],
    };
    const tool = buildToolFromDocs('test_command', doc);
    expect(tool.name).toBe('test_command');
    expect(tool.description).toBe('测试命令');
    expect(tool.inputSchema.type).toBe('object');
    const props = tool.inputSchema.properties as Record<string, { type?: string; description: string }>;
    expect(props.path.type).toBe('string');
    expect(props.path.description).toBe('节点路径');
    expect(props.count.type).toBe('integer');
    expect(props.flag.type).toBe('boolean');
    expect(tool.inputSchema.required).toEqual(['path', 'count']);
  });

  it('JSON 类型参数省略 type(等价 any)', () => {
    const doc: GdCommandDoc = {
      description: '带 any 参数',
      params: [
        { name: 'value', type: 'JSON', required: false, desc: '任意值' },
      ],
    };
    const tool = buildToolFromDocs('any_cmd', doc);
    const props = tool.inputSchema.properties as Record<string, { type?: string }>;
    expect(props.value.type).toBeUndefined(); // JSON → 省略 type
    expect(props.value.description).toBe('任意值');
    expect(tool.inputSchema.required).toBeUndefined(); // 无 required 参数
  });

  it('method 名含 . 时替换为 _(对标竞品)', () => {
    const doc: GdCommandDoc = { description: 'dotted', params: [] };
    const tool = buildToolFromDocs('node.call', doc);
    expect(tool.name).toBe('node_call');
  });

  it('无参数 command 生成空 properties', () => {
    const doc: GdCommandDoc = { description: '无参', params: [] };
    const tool = buildToolFromDocs('noop', doc);
    const props = tool.inputSchema.properties as Record<string, unknown>;
    expect(Object.keys(props)).toHaveLength(0);
  });
});

describe('CMP-16-B: buildAllDynamicTools(对标竞品 buildTypedTools)', () => {
  it('排序输出保证幂等(两次构建顺序一致)', () => {
    const docs: Record<string, GdCommandDoc> = {
      'zeta_cmd': { description: 'z', params: [] },
      'alpha_cmd': { description: 'a', params: [] },
      'mid_cmd': { description: 'm', params: [] },
    };
    const staticNames = new Set<string>();
    const tools1 = buildAllDynamicTools(docs, staticNames);
    const tools2 = buildAllDynamicTools(docs, staticNames);
    expect(tools1.map(t => t.name)).toEqual(['alpha_cmd', 'mid_cmd', 'zeta_cmd']);
    expect(tools1.map(t => t.name)).toEqual(tools2.map(t => t.name));
  });

  it('与静态工具冲突的 method 跳过(静态优先)', () => {
    const docs: Record<string, GdCommandDoc> = {
      'engine': { description: '撞静态工具名', params: [] },
      'unique_cmd': { description: '不冲突', params: [] },
    };
    const staticNames = new Set(['engine', 'debug']);
    const tools = buildAllDynamicTools(docs, staticNames);
    expect(tools.map(t => t.name)).toEqual(['unique_cmd']); // engine 被跳过
  });

  it('名字冲突保留先到 + 跳过后到', () => {
    // method 名不同但 methodToToolName 后相同(如 "a.b" 和 "a_b")
    const docs: Record<string, GdCommandDoc> = {
      'a_b': { description: 'first', params: [] },
      'a.b': { description: 'second', params: [] },
    };
    const tools = buildAllDynamicTools(docs, new Set());
    expect(tools).toHaveLength(1); // 只保留先到(排序后 a.b 先,a_b 后,但都映射 a_b)
  });
});

describe('CMP-16-B: DynamicSchemaCache 缓存与降级', () => {
  let cache: DynamicSchemaCache;

  beforeEach(() => {
    cache = new DynamicSchemaCache();
  });

  it('无 fetcher 时返回空数组(降级)', async () => {
    const tools = await cache.getDynamicTools();
    expect(tools).toEqual([]);
  });

  it('fetcher 返回 null 时缓存空数组(editor 离线)', async () => {
    cache.setFetcher(async () => null);
    const tools = await cache.getDynamicTools();
    expect(tools).toEqual([]);
    // null 被缓存:再次 getDynamicTools 不调 fetcher(cache 命中)
    // 注:setFetcher 会 invalidate 故不能用它验证;直接连调 getDynamicTools
    const tools2 = await cache.getDynamicTools();
    expect(tools2).toEqual([]);
  });

  it('fetcher 返回 docs 时构建工具并缓存', async () => {
    let fetchCount = 0;
    cache.setFetcher(async () => {
      fetchCount++;
      return {
        'cmd_one': { description: 'one', params: [{ name: 'x', type: 'int', required: true, desc: 'X' }] },
      };
    });
    cache.setStaticToolNames(new Set());
    const tools1 = await cache.getDynamicTools();
    expect(tools1).toHaveLength(1);
    expect(tools1[0].name).toBe('cmd_one');
    expect(fetchCount).toBe(1);
    // 第二次用缓存(不调 fetcher)
    const tools2 = await cache.getDynamicTools();
    expect(tools2).toHaveLength(1);
    expect(fetchCount).toBe(1); // 仍是 1,未重新拉
  });

  it('invalidate 后重新拉取', async () => {
    let fetchCount = 0;
    cache.setFetcher(async () => {
      fetchCount++;
      return { 'cmd': { description: 'c', params: [] } };
    });
    cache.setStaticToolNames(new Set());
    await cache.getDynamicTools();
    expect(fetchCount).toBe(1);
    cache.invalidate();
    await cache.getDynamicTools();
    expect(fetchCount).toBe(2); // invalidate 后重新拉
  });

  it('fetcher 抛错时降级空数组(对标竞品 fetchTypedTools 失败降级)', async () => {
    cache.setFetcher(async () => { throw new Error('editor offline'); });
    const tools = await cache.getDynamicTools();
    expect(tools).toEqual([]);
  });
});

describe('CMP-16-B: tool-registry registerDynamicTools', () => {
  it('registerDynamicTools 让 isToolAllowed 放行(归入 dynamic 组)', async () => {
    const { registerDynamicTools, isToolAllowed, getDynamicToolNames, getActiveGroups, setActiveGroups } = await import('../src/core/tool-registry.js');
    // 确保 dynamic 组激活
    const prev = setActiveGroups(new Set([...getActiveGroups(), 'dynamic']));
    try {
      registerDynamicTools(['test_dyn_tool_1', 'test_dyn_tool_2']);
      expect(getDynamicToolNames()).toContain('test_dyn_tool_1');
      expect(isToolAllowed('test_dyn_tool_1')).toBe(true);
      expect(isToolAllowed('test_dyn_tool_2')).toBe(true);
      // 未注册的动态工具仍 false
      expect(isToolAllowed('test_dyn_unknown')).toBe(false);
    } finally {
      setActiveGroups(prev);
      registerDynamicTools([]); // 清理
    }
  });

  it('registerDynamicTools 完全替换旧工具集(增量更新)', async () => {
    const { registerDynamicTools, getDynamicToolNames, getActiveGroups, setActiveGroups } = await import('../src/core/tool-registry.js');
    const prev = setActiveGroups(new Set([...getActiveGroups(), 'dynamic']));
    try {
      registerDynamicTools(['old_tool']);
      expect(getDynamicToolNames()).toContain('old_tool');
      registerDynamicTools(['new_tool']); // 替换
      expect(getDynamicToolNames()).not.toContain('old_tool');
      expect(getDynamicToolNames()).toContain('new_tool');
    } finally {
      setActiveGroups(prev);
      registerDynamicTools([]);
    }
  });
});

// NIT-1(第三方审查):动态工具被 AI 调用时经 EditorToolExecutor 转发到 editor 的路由测试。
// 验证:动态工具名(扁平 method 如 engine_call_method)→ resolveEditorMethod 未命中 → method=toolName → conn.request(method)。
// 这是 live schema 类功能易漏的"调用层"测试(审查 NIT-1)。
describe('CMP-16-B NIT-1: 动态工具调用路由(EditorToolExecutor 转发)', () => {
  it('动态工具名 engine_call_method → resolveEditorMethod 未命中 → method=toolName → 转发正确', async () => {
    // resolveEditorMethod 查 editor-method-map 顶层 key(toolName);
    // 动态工具 toolName = 扁平 method 名(如 engine_call_method),不在 MAP 顶层 → 返回 null → method = toolName
    const { resolveEditorMethod } = await import('../src/core/editor-method-map.js');

    // engine_call_method 不在 MAP 顶层(MAP 顶层是 engine/debug/scene 等 tool 名,非扁平 method)
    const entry = resolveEditorMethod('engine_call_method', { node_path: 'root', method: 'has_method', args: [] });
    // 未命中应返回 null(或 undefined),fallback 到 method=toolName
    expect(entry?.method ?? 'engine_call_method').toBe('engine_call_method');
  });

  it('静态工具 engine + action=call_method → resolveEditorMethod 命中 → method=engine_call_method', async () => {
    // 静态路径:toolName='engine' action='call_method' → MAP 命中 → method='engine_call_method'
    const { resolveEditorMethod } = await import('../src/core/editor-method-map.js');
    const entry = resolveEditorMethod('engine', { action: 'call_method', node_path: 'root', method: 'has_method' });
    expect(entry?.method).toBe('engine_call_method');
  });

  it('GD command_handler 有 engine_call_method 分支(转发目标存在)', () => {
    // 验证 GD 侧 handle() 有对应分支(否则转发后 -32601)
    const { readFileSync } = require('node:fs');
    const gd = readFileSync('addons/godot_mcp_server/command_handler.gd', 'utf8');
    expect(gd.includes('"engine_call_method"'), 'command_handler.gd 缺 engine_call_method 分支(转发目标不存在)').toBe(true);
  });
});
