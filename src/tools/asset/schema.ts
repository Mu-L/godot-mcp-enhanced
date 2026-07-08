// src/tools/asset/schema.ts — asset 工具静态元数据（11 shape + 10 材质预设）
//
// 仅含静态展示数据：list_shapes / list_materials 序列化此结构返回给客户端，
// getToolDefinitions 据此构建 inputSchema.enum。运行时参数校验在 GD 侧
// asset_commands.gd / AssetFactory.gd 完成，TS 不重复校验。

// ─── 11 shape 元数据 ─────────────────────────────────────────────────────────
// name 必须与 GD 侧 asset_factory.gd::create_mesh 的 match 分支逐字一致
// （前 6 个 PrimitiveMesh 由 create_mesh 调度，后 5 个由 custom_meshes.gd 手写）。
// params 仅作默认值展示；含 [x,y,z] 数组的 fence/ramp 字段对齐 GD 侧 _vec3 helper。
export const SHAPES = [
  { name: 'box', params: { size: [1, 1, 1] } },
  { name: 'cylinder', params: { height: 1, radius: 0.5 } },
  { name: 'sphere', params: { radius: 0.5 } },
  { name: 'prism', params: { size: [1, 1, 1], left_to_right: 0.5 } },
  { name: 'wall', params: { length: 2, height: 1, thickness: 0.1 } },
  { name: 'ramp', params: { length: 2, height: 1, width: 1, start_height: 0, end_height: 1 } },
  { name: 'cone', params: { height: 1, radius: 0.5, segments: 24 } },
  { name: 'tube', params: { height: 1, radius: 0.5, thickness: 0.1 } },
  { name: 'torus', params: { major_radius: 0.5, minor_radius: 0.2 } },
  { name: 'stairs', params: { steps: 5, step_height: 0.2, step_depth: 0.3, width: 1.2 } },
  { name: 'fence', params: { length: 3, height: 1.2, posts: 4, post_radius: 0.05, rail_thickness: 0.04, start_post: true, end_post: true } },
] as const;

// shape 名数组，供 inputSchema.enum 使用
export const SHAPE_NAMES = SHAPES.map(s => s.name);

// ─── 10 材质预设 ─────────────────────────────────────────────────────────────
// 必须与 GD 侧 material_library.gd::PRESETS 的 key 逐字一致。
// TS 不内嵌 PBR 参数（color/emissive/metallic/roughness 等），仅列名给 enum。
export const MATERIAL_PRESETS = [
  'wood', 'metal', 'stone', 'glass', 'gold',
  'coral', 'sand', 'seaweed', 'water', 'default',
] as const;

// ─── path continuous + ramp 互斥策略 ─────────────────────────────────────────
// 方案 A：ramp 在 continuous 模式被拒（GD 侧 asset_commands.gd 检查）。
// TS 侧仅作元数据标记，不在 handleTool 内做校验（editor 模式不到此处）。
export const RAMP_BLOCKED_IN_CONTINUOUS = true;
