import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// CMP-16-A (2026-08-08): GD param docs metadata — 源码字面量契约测试。
// 每个 command module 实现 get_command_docs() -> Dictionary。
// command_handler.gd 的 list_param_docs 聚合,供 TS 侧 live schema 构建拉取。
// 对标竞品 regiellis base_command.gd doc_param + engine.commands {docs:true}。

const COMMANDS_DIR = 'addons/godot_mcp_server/commands';

// 13 个 command module 文件(含 asset 子目录;排除 recording 死代码 + command_helpers/helper 文件)
const MODULE_FILES = [
  'engine_commands.gd',
  'debug_commands.gd',
  'sync_commands.gd',
  'ui_commands.gd',
  'nav_commands.gd',
  'particle_commands.gd',
  'scene_commands.gd',
  'animation_commands.gd',
  'animtree_commands.gd',
  'test_commands.gd',
  'export_commands.gd',
  'node_commands.gd',
  'asset/asset_commands.gd',
];

describe('CMP-16-A: 每个 command module 有 get_command_docs', () => {
  for (const file of MODULE_FILES) {
    it(`${file}: 含 get_command_docs 函数`, () => {
      const gd = readFileSync(`${COMMANDS_DIR}/${file}`, 'utf8');
      expect(gd.includes('func get_command_docs'), `${file} 缺 get_command_docs`).toBe(true);
      // sync_commands 全是无参数 command(params:[]),不需 doc_param;其余文件应有 doc_param 调用
      if (file !== 'sync_commands.gd') {
        expect(gd.includes('CommandHelpers.doc_param'), `${file} 缺 doc_param 调用`).toBe(true);
      }
    });
  }
});

describe('CMP-16-A: get_command_docs 格式一致性', () => {
  it('CMP-16a: 每个 method 条目含 description + params 两个 key', () => {
    // 抽查 engine_commands(有参数)和 export_commands(含无参数 command)
    for (const file of ['engine_commands.gd', 'export_commands.gd', 'sync_commands.gd']) {
      const gd = readFileSync(`${COMMANDS_DIR}/${file}`, 'utf8');
      const start = gd.indexOf('func get_command_docs');
      const body = gd.slice(start, start + 3000);
      // 每个条目都应有 description 和 params
      expect(body.includes('"description"'), `${file} docs 缺 description`).toBe(true);
      expect(body.includes('"params"'), `${file} docs 缺 params`).toBe(true);
    }
  });

  it('CMP-16b: 无参数 command 用 "params": [](export_list_presets / asset_undo / sync 4 个)', () => {
    // export_list_presets 无参数
    const exportGd = readFileSync(`${COMMANDS_DIR}/export_commands.gd`, 'utf8');
    const exportStart = exportGd.indexOf('export_list_presets');
    const exportSlice = exportGd.slice(exportStart, exportStart + 200);
    expect(exportSlice.includes('"params": []'), 'export_list_presets 应为无参数 params:[]').toBe(true);
    // asset_undo 无参数
    const assetGd = readFileSync(`${COMMANDS_DIR}/asset/asset_commands.gd`, 'utf8');
    const assetUndoStart = assetGd.indexOf('"asset_undo"');
    const assetUndoSlice = assetGd.slice(assetUndoStart, assetUndoStart + 200);
    expect(assetUndoSlice.includes('"params": []'), 'asset_undo 应为无参数 params:[]').toBe(true);
  });
});

describe('CMP-16-A: command_helpers.gd doc_param helper', () => {
  it('CMP-16c: command_helpers.gd 含 doc_param static helper', () => {
    const gd = readFileSync(`${COMMANDS_DIR}/command_helpers.gd`, 'utf8');
    expect(gd.includes('static func doc_param'), '缺 doc_param static helper').toBe(true);
    // doc_param 返回 {name, type, required, desc}
    const dpStart = gd.indexOf('static func doc_param');
    const slice = gd.slice(dpStart, dpStart + 300);
    expect(slice.includes('"name"'), 'doc_param 缺 name 字段').toBe(true);
    expect(slice.includes('"type"'), 'doc_param 缺 type 字段').toBe(true);
    expect(slice.includes('"required"'), 'doc_param 缺 required 字段').toBe(true);
    expect(slice.includes('"desc"'), 'doc_param 缺 desc 字段').toBe(true);
  });

  it('CMP-16d: command_helpers.gd 含 godot_type_to_schema_type 映射', () => {
    const gd = readFileSync(`${COMMANDS_DIR}/command_helpers.gd`, 'utf8');
    expect(gd.includes('static func godot_type_to_schema_type'), '缺 godot_type_to_schema_type').toBe(true);
    const fnStart = gd.indexOf('static func godot_type_to_schema_type');
    const slice = gd.slice(fnStart, fnStart + 800);
    // 验证关键类型映射(对标竞品 jsonSchemaType)
    expect(slice.includes('String'), '映射缺 String→string').toBe(true);
    expect(slice.includes('"integer"'), '映射缺 int→integer').toBe(true);
    expect(slice.includes('"number"'), '映射缺 float→number').toBe(true);
    expect(slice.includes('"boolean"'), '映射缺 bool→boolean').toBe(true);
    expect(slice.includes('"array"'), '映射缺 Array→array').toBe(true);
  });
});

describe('CMP-16-A: command_handler.gd list_param_docs 聚合入口', () => {
  it('CMP-16e: match 含 list_param_docs 分支', () => {
    const gd = readFileSync('addons/godot_mcp_server/command_handler.gd', 'utf8');
    expect(gd.includes('"list_param_docs"'), '缺 list_param_docs match 分支').toBe(true);
  });

  it('CMP-16f: 含 get_all_command_docs 聚合函数', () => {
    const gd = readFileSync('addons/godot_mcp_server/command_handler.gd', 'utf8');
    expect(gd.includes('func get_all_command_docs'), '缺 get_all_command_docs 函数').toBe(true);
    const fnStart = gd.indexOf('func get_all_command_docs');
    const slice = gd.slice(fnStart, fnStart + 800);
    // 遍历所有 module
    expect(slice.includes('has_method("get_command_docs")'), '聚合缺 has_method 检查').toBe(true);
    expect(slice.includes('_engine_commands'), '聚合缺 _engine_commands').toBe(true);
    expect(slice.includes('_debug_commands'), '聚合缺 _debug_commands').toBe(true);
    expect(slice.includes('_asset_commands'), '聚合缺 _asset_commands').toBe(true);
  });
});

describe('CMP-16-A: docs 覆盖完整性(13 module × 对外 command)', () => {
  // 核实每个 module 的 docs method 数与实际 handler 数一致。
  // 精确匹配:method key 格式为 2-tab 缩进 "name": { (Dictionary 开始,同一行)。
  // body 截取用函数边界(到下一个 ^func),避免跨入 handler 区域误匹配 "result": { 等。
  const expectedCounts: Record<string, number> = {
    'engine_commands.gd': 4,      // class_info/search/get_inheritance/call_method
    'debug_commands.gd': 3,        // set/clear/list_breakpoint
    'sync_commands.gd': 4,         // start/stop/get_scene_tree/get_scene_stats
    'ui_commands.gd': 8,           // create_control/set_layout/get_layout/anchor_preset/set_theme/container_add/theme_create/theme_set_property
    'nav_commands.gd': 5,          // create_region/bake_mesh/create_agent/set_params/create_link
    'particle_commands.gd': 5,     // create/set_emission/set_process/load_preset/set_material
    'scene_commands.gd': 4,        // open/save/instance/set_instance_property
    'animation_commands.gd': 4,    // track/keyframe/curve/blend
    'animtree_commands.gd': 5,     // create/add_state/add_transition/set_blend/play
    'test_commands.gd': 3,         // assert/run/manage
    'export_commands.gd': 3,       // list_presets/get_preset/build
    'node_commands.gd': 4,         // add/remove/edit/batch_add_nodes
    'asset/asset_commands.gd': 5,  // create/path/batch/undo/save
  };

  /** 提取 get_command_docs 函数体内的 method key(2-tab "name": { 同行) */
  function countDocMethods(gd: string): number {
    const start = gd.indexOf('func get_command_docs');
    if (start < 0) return -1;
    // 截到下一个顶层函数(^\nfunc),避免跨入 handler
    const nextFunc = gd.indexOf('\nfunc ', start + 10);
    const body = gd.slice(start, nextFunc < 0 ? start + 4000 : nextFunc);
    const keys = body.match(/^\t\t"[a-z_0-9]+": \{/gm) || [];
    return keys.length;
  }

  for (const [file, expected] of Object.entries(expectedCounts)) {
    it(`${file}: docs 含 ${expected} 个 method`, () => {
      const gd = readFileSync(`${COMMANDS_DIR}/${file}`, 'utf8');
      const count = countDocMethods(gd);
      expect(count, `${file} docs method 数 ${count} ≠ 预期 ${expected}`).toBe(expected);
    });
  }

  it('CMP-16g: 全部 13 module docs 总数 = 57', () => {
    let total = 0;
    for (const file of MODULE_FILES) {
      const gd = readFileSync(`${COMMANDS_DIR}/${file}`, 'utf8');
      total += countDocMethods(gd);
    }
    expect(total, `13 module docs 总数 ${total} ≠ 57`).toBe(57);
  });
});
