import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// CMP-4 (2026-08-08): engine 组 实时 ClassDB 内省——editor-only 工具。
// 字面量契约测试:验证 TS 工具定义 + GD handler 注册 + editor-method-map + ROUTING 登记。

describe('CMP-4: engine 工具定义（TS 契约）', () => {
  it('CMP-4a: engine.ts 定义工具 name=engine + action enum(含 CMP-9-A 新增 call_method)', async () => {
    const mod = await import('../src/tools/engine.js');
    const defs = mod.getToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('engine');
    const schema = defs[0].inputSchema as Record<string, unknown>;
    const props = schema.properties as Record<string, { enum?: string[] }>;
    // CMP-4 原 3 action + CMP-9-A 新增 call_method = 4
    expect(props.action?.enum).toEqual(['class_info', 'search', 'get_inheritance', 'call_method']);
  });

  it('CMP-4b: handleTool 在 headless 返回 EDITOR_ONLY(含 CMP-9-A call_method)', async () => {
    const mod = await import('../src/tools/engine.js');
    for (const action of ['class_info', 'search', 'get_inheritance', 'call_method']) {
      const result = await mod.handleTool('engine', { action }, {} as never);
      expect(result?.isError).toBe(true);
      expect(result?.content?.[0]?.text).toContain('EDITOR_ONLY');
    }
  });

  it('CMP-4c: TOOL_META 标 readonly(组级) + 各 action risk', async () => {
    const mod = await import('../src/tools/engine.js');
    // CMP-9-A 后含 call_method(write),组级 readonly=false(不再纯只读)
    expect(mod.TOOL_META.engine.readonly).toBe(false);
    expect(mod.TOOL_META.engine.actionRisks?.class_info).toBe('read');
    expect(mod.TOOL_META.engine.actionRisks?.search).toBe('read');
    expect(mod.TOOL_META.engine.actionRisks?.get_inheritance).toBe('read');
  });

  it('CMP-4d: handleTool 拒绝未知 action', async () => {
    const mod = await import('../src/tools/engine.js');
    const result = await mod.handleTool('engine', { action: 'unknown' }, {} as never);
    expect(result?.content?.[0]?.text).toContain('INVALID_ACTION');
  });
});

describe('CMP-4: engine 注册链路（源码字面量契约）', () => {
  it('CMP-4e: module-loader.ts 注册 engine 模块', () => {
    const src = readFileSync('src/module-loader.ts', 'utf8');
    expect(src.includes("import * as engine from"), 'module-loader 未 import engine').toBe(true);
    const allModStart = src.indexOf('const ALL_MODULES');
    const slice = src.slice(allModStart, allModStart + 1200);
    expect(/^\s+engine,/m.test(slice), 'ALL_MODULES 未含 engine 条目').toBe(true);
  });

  it('CMP-4f: editor-method-map.ts MAP 含 engine 族 + 3 action', () => {
    const src = readFileSync('src/core/editor-method-map.ts', 'utf8');
    const engineStart = src.indexOf('engine: {');
    expect(engineStart, 'editor-method-map MAP 未含 engine 族').toBeGreaterThan(-1);
    const slice = src.slice(engineStart, engineStart + 400);
    expect(slice.includes("'engine_class_info'"), 'MAP engine 族缺 engine_class_info method').toBe(true);
    expect(slice.includes("'engine_search'"), 'MAP engine 族缺 engine_search method').toBe(true);
    expect(slice.includes("'engine_get_inheritance'"), 'MAP engine 族缺 engine_get_inheritance method').toBe(true);
  });

  it('CMP-4g: static-grep.ts EDITOR_COMMAND_ROUTING 含 3 engine method', () => {
    const src = readFileSync('src/capability/static-grep.ts', 'utf8');
    expect(src.includes('engine_class_info:'), 'ROUTING 缺 engine_class_info').toBe(true);
    expect(src.includes('engine_search:'), 'ROUTING 缺 engine_search').toBe(true);
    expect(src.includes('engine_get_inheritance:'), 'ROUTING 缺 engine_get_inheritance').toBe(true);
    expect(src.includes("'commands/engine_commands.gd'"), 'ROUTING engine method 未指向 commands/engine_commands.gd').toBe(true);
  });
});

describe('CMP-4: GD 侧 engine_commands.gd（源码字面量契约）', () => {
  it('CMP-4h: engine_commands.gd 含 3 handler + ClassDB API', () => {
    const gd = readFileSync('addons/godot_mcp_server/commands/engine_commands.gd', 'utf8');
    expect(gd.includes('func handle_class_info'), '缺 handle_class_info').toBe(true);
    expect(gd.includes('func handle_search'), '缺 handle_search').toBe(true);
    expect(gd.includes('func handle_get_inheritance'), '缺 handle_get_inheritance').toBe(true);
    // 直调 ClassDB API(不经沙箱)
    expect(gd.includes('ClassDB.class_get_property_list'), '缺 ClassDB.class_get_property_list').toBe(true);
    expect(gd.includes('ClassDB.class_get_method_list'), '缺 ClassDB.class_get_method_list').toBe(true);
    expect(gd.includes('ClassDB.get_class_list'), '缺 ClassDB.get_class_list').toBe(true);
    expect(gd.includes('ClassDB.get_parent_class'), '缺 ClassDB.get_parent_class').toBe(true);
    // search 上限(防全量返回过大)
    expect(gd.includes('SEARCH_LIMIT'), '缺 SEARCH_LIMIT 上限').toBe(true);
  });

  it('CMP-4i: command_handler.gd 注册 engine_commands(成员+setup+cleanup+handle)', () => {
    const gd = readFileSync('addons/godot_mcp_server/command_handler.gd', 'utf8');
    expect(gd.includes('var _engine_commands'), '缺 _engine_commands 成员变量').toBe(true);
    expect(gd.includes('preload("commands/engine_commands.gd")'), '缺 engine_commands.gd preload').toBe(true);
    const cleanupStart = gd.indexOf('var modules = [');
    const cleanupSlice = gd.slice(cleanupStart, cleanupStart + 500);
    expect(cleanupSlice.includes('_engine_commands'), 'cleanup modules 数组缺 _engine_commands').toBe(true);
    expect(gd.includes('"engine_class_info"'), 'handle() 缺 engine_class_info case').toBe(true);
    expect(gd.includes('"engine_search"'), 'handle() 缺 engine_search case').toBe(true);
    expect(gd.includes('"engine_get_inheritance"'), 'handle() 缺 engine_get_inheritance case').toBe(true);
  });

  it('CMP-4j (B-2): _type_name 映射含 Projection(19) + PackedVector4Array(38) 防 off-by-two', () => {
    // B-2 第三方审查:原表漏 Projection(19) 致 19+ 全部错位。验证关键字映射值。
    const gd = readFileSync('addons/godot_mcp_server/commands/engine_commands.gd', 'utf8');
    const fnStart = gd.indexOf('func _type_name');
    const slice = gd.slice(fnStart, fnStart + 2000);
    // Projection(19) 必须存在(原 bug 漏了这个)
    expect(/19:\s*return "Projection"/.test(slice), '_type_name 缺 Projection(19) 映射（B-2 off-by-two 根因）').toBe(true);
    // Color(20) 在 Projection 之后
    expect(/20:\s*return "Color"/.test(slice), '_type_name 映射 Color 不是 20（B-2 错位残留）').toBe(true);
    // PackedVector4Array(38) 必须存在
    expect(/38:\s*return "PackedVector4Array"/.test(slice), '_type_name 缺 PackedVector4Array(38)').toBe(true);
    // Packed ColorArray(37) 在 PackedVector4Array 之前
    expect(/37:\s*return "PackedColorArray"/.test(slice), '_type_name 映射 PackedColorArray 不是 37').toBe(true);
  });

  it('CMP-4-R1: handle_class_info 含 MEMBER_LIMIT 截断 + truncated 标志（防大类撑爆 1MB）', () => {
    const gd = readFileSync('addons/godot_mcp_server/commands/engine_commands.gd', 'utf8');
    const fnStart = gd.indexOf('func handle_class_info');
    const slice = gd.slice(fnStart, fnStart + 4000);  // GD-R4 加 enum constants 后函数体增长
    // MEMBER_LIMIT 常量必须存在
    expect(slice.includes('MEMBER_LIMIT'), 'handle_class_info 缺 MEMBER_LIMIT 截断（R1 根因）').toBe(true);
    // truncated 标志必须在返回的 info 里
    expect(/info\["truncated"\]/.test(slice), 'handle_class_info 返回缺 truncated 标志').toBe(true);
    // 截断提示必须引导用 no_inherit=true
    expect(slice.includes('truncation_hint'), 'handle_class_info 缺 truncation_hint 引导').toBe(true);
  });

  it('CMP-4-R3: handle_search 用 hit_limit flag 而非 size>=LIMIT 边界假阳性', () => {
    const gd = readFileSync('addons/godot_mcp_server/commands/engine_commands.gd', 'utf8');
    const fnStart = gd.indexOf('func handle_search');
    const slice = gd.slice(fnStart, fnStart + 1000);
    // 必须用 flag 变量(hit_limit)记录提前退出,而非 matches.size() >= SEARCH_LIMIT 边界比较
    expect(slice.includes('hit_limit'), 'handle_search 缺 hit_limit flag（R3 边界假阳性根因）').toBe(true);
    // truncated 必须引用 hit_limit 而非再做 size 比较
    expect(/truncated.*hit_limit/.test(slice), 'handle_search truncated 仍用 size 比较（R3 未修）').toBe(true);
  });

  it('CMP-4-R4: handle_get_inheritance 用 visited Set 做完整环检测（破互循环）', () => {
    const gd = readFileSync('addons/godot_mcp_server/commands/engine_commands.gd', 'utf8');
    const fnStart = gd.indexOf('func handle_get_inheritance');
    const slice = gd.slice(fnStart, fnStart + 800);
    // 必须用 visited Dictionary/Set 记录已访问类（完整环检测）
    expect(slice.includes('visited'), 'handle_get_inheritance 缺 visited Set（R4 互循环根因）').toBe(true);
    // 环检测必须是 visited.has(parent) 而非 parent == current（单点检测）
    expect(/visited\.has\(parent\)/.test(slice), 'handle_get_inheritance 仍用 parent==current 单点检测（R4 未修）').toBe(true);
  });

  it('CMP-4-R2: handle_class_info 过滤 PROPERTY_USAGE_INTERNAL 属性（AI 不应见 internal）', () => {
    const gd = readFileSync('addons/godot_mcp_server/commands/engine_commands.gd', 'utf8');
    const fnStart = gd.indexOf('func handle_class_info');
    const slice = gd.slice(fnStart, fnStart + 4000);  // GD-R4 加 enum constants 后函数体增长
    // 必须过滤 PROPERTY_USAGE_INTERNAL(0x2) flag
    expect(slice.includes('PROPERTY_USAGE_INTERNAL'), 'handle_class_info 缺 PROPERTY_USAGE_INTERNAL 过滤（R2 根因）').toBe(true);
  });
});

// ─── CMP-9-A (2026-08-08): editor call_method — 编辑器场景树节点实例方法调用 ────

describe('CMP-9-A: engine call_method 工具定义（TS 契约）', () => {
  it('CMP-9a: engine.ts ACTIONS 含 call_method(4 个 action)', async () => {
    const mod = await import('../src/tools/engine.js');
    const defs = mod.getToolDefinitions();
    const schema = defs[0].inputSchema as Record<string, unknown>;
    const props = schema.properties as Record<string, { enum?: string[] }>;
    expect(props.action?.enum).toEqual(['class_info', 'search', 'get_inheritance', 'call_method']);
  });

  it('CMP-9b: inputSchema 含 node_path / method / args 字段', async () => {
    const mod = await import('../src/tools/engine.js');
    const defs = mod.getToolDefinitions();
    const schema = defs[0].inputSchema as Record<string, unknown>;
    const props = schema.properties as Record<string, unknown>;
    expect(props).toHaveProperty('node_path');
    expect(props).toHaveProperty('method');
    expect(props).toHaveProperty('args');
  });

  it('CMP-9c: TOOL_META call_method risk=write(非 readonly,方法有副作用)', async () => {
    const mod = await import('../src/tools/engine.js');
    expect(mod.TOOL_META.engine.actionRisks?.call_method).toBe('write');
  });

  it('CMP-9d: handleTool 对 call_method 返回 EDITOR_ONLY(headless 不可用)', async () => {
    const mod = await import('../src/tools/engine.js');
    const result = await mod.handleTool('engine', { action: 'call_method' }, {} as never);
    expect(result?.isError).toBe(true);
    expect(result?.content?.[0]?.text).toContain('EDITOR_ONLY');
  });

  it('CMP-9e: description 含 deny-list 安全提示', async () => {
    const mod = await import('../src/tools/engine.js');
    const defs = mod.getToolDefinitions();
    const desc = String(defs[0].description);
    expect(desc).toContain('call_method');
    expect(desc).toContain('deny-list');
  });
});

describe('CMP-9-A: engine call_method 注册链路（源码字面量契约）', () => {
  it('CMP-9f: editor-method-map.ts engine 族含 call_method → engine_call_method', () => {
    const src = readFileSync('src/core/editor-method-map.ts', 'utf8');
    const engineStart = src.indexOf('engine: {');
    const slice = src.slice(engineStart, engineStart + 400);
    expect(slice.includes("'engine_call_method'"), 'MAP engine 族缺 engine_call_method method').toBe(true);
    expect(slice.includes('call_method'), 'MAP engine 族缺 call_method action key').toBe(true);
  });

  it('CMP-9g: static-grep.ts ROUTING 含 engine_call_method', () => {
    const src = readFileSync('src/capability/static-grep.ts', 'utf8');
    expect(src.includes('engine_call_method:'), 'ROUTING 缺 engine_call_method').toBe(true);
  });
});

describe('CMP-9-A: GD 侧 call_method 安全设计（源码字面量契约）', () => {
  it('CMP-9h: engine_commands.gd 含 handle_call_method + deny-list + did-you-mean', () => {
    const gd = readFileSync('addons/godot_mcp_server/commands/engine_commands.gd', 'utf8');
    expect(gd.includes('func handle_call_method'), '缺 handle_call_method').toBe(true);
    // deny-list 默认挡危险方法
    expect(gd.includes('DEFAULT_CALL_DENYLIST'), '缺 DEFAULT_CALL_DENYLIST 常量').toBe(true);
    const dlStart = gd.indexOf('DEFAULT_CALL_DENYLIST := [');
    const dlSlice = gd.slice(dlStart, dlStart + 400);
    expect(dlSlice.includes('"free"'), 'deny-list 缺 free').toBe(true);
    expect(dlSlice.includes('"queue_free"'), 'deny-list 缺 queue_free').toBe(true);
    expect(dlSlice.includes('"set_script"'), 'deny-list 缺 set_script(RCE)').toBe(true);
    expect(dlSlice.includes('"call"'), 'deny-list 缺 call(间接调用绕 deny-list)').toBe(true);
    expect(dlSlice.includes('"emit_signal"'), 'deny-list 缺 emit_signal').toBe(true);
    // did-you-mean
    expect(gd.includes('func _suggest_method'), '缺 _suggest_method(did-you-mean)').toBe(true);
    expect(gd.includes('similarity'), 'did-you-mean 缺 similarity 调用').toBe(true);
    // env 覆盖
    expect(gd.includes('GODOT_MCP_EDITOR_CALL_DENYLIST_OVERRIDE'), '缺 env 覆盖名').toBe(true);
    // undoable=false
    expect(gd.includes('"undoable": false'), '缺 undoable=false 声明').toBe(true);
  });

  it('CMP-9i: command_handler.gd match 含 engine_call_method 分支', () => {
    const gd = readFileSync('addons/godot_mcp_server/command_handler.gd', 'utf8');
    expect(gd.includes('"engine_call_method"'), 'handle() 缺 engine_call_method case').toBe(true);
    expect(gd.includes('handle_call_method'), 'handle() 缺 handle_call_method 调用').toBe(true);
  });

  it('CMP-9j: 类型强转覆盖 Vector2/3/Color/bool/int/float(String 和 Array 两种来源)', () => {
    const gd = readFileSync('addons/godot_mcp_server/commands/engine_commands.gd', 'utf8');
    const fnStart = gd.indexOf('func _coerce_single_arg');
    expect(fnStart, '缺 _coerce_single_arg 函数').toBeGreaterThan(-1);
    const slice = gd.slice(fnStart, fnStart + 2000);
    expect(slice.includes('TYPE_VECTOR3'), '强转缺 TYPE_VECTOR3').toBe(true);
    expect(slice.includes('TYPE_VECTOR2'), '强转缺 TYPE_VECTOR2').toBe(true);
    expect(slice.includes('TYPE_COLOR'), '强转缺 TYPE_COLOR').toBe(true);
    expect(slice.includes('TYPE_BOOL'), '强转缺 TYPE_BOOL').toBe(true);
    expect(slice.includes('TYPE_INT'), '强转缺 TYPE_INT').toBe(true);
    expect(slice.includes('TYPE_FLOAT'), '强转缺 TYPE_FLOAT').toBe(true);
    // Array 来源(Vector3 from [1,2,3])
    expect(slice.includes('raw is Array'), '强转缺 Array 来源分支').toBe(true);
    // String 来源(Vector3 from "(1,2,3)" Godot literal)
    expect(slice.includes('raw is String'), '强转缺 String 来源分支').toBe(true);
  });

  it('CMP-9k: 返回值序列化覆盖数学类型 + Resource + Node', () => {
    const gd = readFileSync('addons/godot_mcp_server/commands/engine_commands.gd', 'utf8');
    const fnStart = gd.indexOf('func _serialize_return_value');
    expect(fnStart, '缺 _serialize_return_value 函数').toBeGreaterThan(-1);
    const slice = gd.slice(fnStart, fnStart + 1200);
    expect(slice.includes('Vector3'), '序列化缺 Vector3').toBe(true);
    expect(slice.includes('Color'), '序列化缺 Color').toBe(true);
    expect(slice.includes('Resource'), '序列化缺 Resource').toBe(true);
    expect(slice.includes('Node'), '序列化缺 Node').toBe(true);
  });

  it('CMP-9l: args 数量上限 CALL_ARGS_LIMIT 存在(对标 bridge 的 8 限制)', () => {
    const gd = readFileSync('addons/godot_mcp_server/commands/engine_commands.gd', 'utf8');
    expect(gd.includes('CALL_ARGS_LIMIT'), '缺 CALL_ARGS_LIMIT 常量').toBe(true);
    expect(gd.includes('Too many arguments'), '缺 args 数量上限错误提示').toBe(true);
  });
});
