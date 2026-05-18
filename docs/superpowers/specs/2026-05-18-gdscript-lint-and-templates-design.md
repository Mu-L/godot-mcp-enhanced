# GDScript Lint 规则引擎与代码模板系统设计

> 日期: 2026-05-18
> 状态: Draft
> 来源: 批量创建 33 个 3D demo 时踩过的所有 API 陷阱

## 问题背景

在 Godot 4.6 中批量创建 demo 时，LLM 生成的 GDScript 代码出现了 12 类重复性错误。这些错误在 Godot 编辑器中才暴露（运行时 crash 或属性赋值失败），而 MCP 工具的 `validate_scripts` 只能检查语法，无法检测 API 语义错误。

核心痛点：
1. **LLM 训练数据混杂** — Godot 3.x/4.x/4.6 的 API 共存，生成代码常引用已重命名/已移除的属性
2. **时序陷阱** — `look_at()` 要求节点在树中、`AStarGrid2D` 要求先 `update()` 等
3. **缺少正确模板** — 每次从零生成 Camera3D/RigidBody3D 代码，容易踩同一个坑

## 设计目标

1. `write_script` / `edit_script` / `batch_create_files` 写入 .gd 文件后，自动运行 lint 规则，在返回结果中包含警告
2. 常见模式（相机设置、刚体弹跳等）提供经过验证的代码模板
3. `get_class_info` 返回的属性列表标注 Godot 4.6 中的重命名/移除

## P0: GDScript 运行时 Lint 引擎

### 位置

`src/tools/gdscript-lint.ts`

### 规则列表

| ID | 严重度 | 规则 | 检测方式 |
|----|--------|------|----------|
| L001 | error | `look_at()` 在 `add_child()` 之前调用 | 扫描 `_ready`/init 函数中的调用顺序 |
| L002 | error | `RigidBody3D.bounce = ...` 直接赋值 | 正则匹配 `\.bounce\s*=` |
| L003 | error | `CylinderMesh.radius = ...` | 正则匹配 `CylinderMesh.*\.radius\s*=` |
| L004 | error | `Environment.adjustments_*` (带 s) | 正则匹配 `adjustments_` |
| L005 | error | `Environment.tone_mapper` | 正则匹配 `\.tone_mapper\s*=` |
| L006 | error | `SoftBody3D.mass = ...` (应用 total_mass) | 正则匹配 `SoftBody3D.*\.mass\s*=` |
| L007 | error | `Node3D.visibility_range_begin/end` | 正则匹配 `visibility_range_` |
| L008 | error | `ArrayMesh.create_triangle_shape()` | 正则匹配 `create_triangle_shape` |
| L009 | error | `Node.get_child_or_null()` (4.x 已移除) | 正则匹配 `get_child_or_null` |
| L010 | error | `FogMaterial.albedo_color` (应用 emission) | 正则匹配 `FogMaterial.*\.albedo_color` |
| L011 | error | `Environment.physically_based_lights_enabled` | 正则匹配 `physically_based_lights_enabled` |
| L012 | error | `Line2D.dash_pattern = [...]` 非类型化数组 | 检测 dash_pattern 赋值未用 PackedFloat32Array |
| L013 | error | `CharacterBody3D` 使用 `body_entered` 信号 | 正则匹配 `CharacterBody.*body_entered` |
| L014 | warn | `AStarGrid2D.set_point_solid()` 在 `update()` 之前 | 扫描调用顺序 |

### 实现方案

```typescript
interface LintRule {
  id: string;
  severity: "error" | "warning";
  pattern: RegExp;
  message: string;
  suggestion: string;
}

function lintGDScript(code: string): LintResult[] {
  const results: LintResult[] = [];
  for (const rule of RULES) {
    const matches = code.matchAll(rule.pattern.global ? rule.pattern : new RegExp(rule.pattern.source, "g"));
    for (const match of matches) {
      results.push({
        rule: rule.id,
        severity: rule.severity,
        line: getLineNumber(code, match.index),
        message: rule.message,
        suggestion: rule.suggestion,
      });
    }
  }
  return results;
}
```

### 集成点

1. `write_script` — 写入后自动 lint，返回结果中包含 `lintWarnings` 字段
2. `edit_script` — 编辑后自动 lint（仅 lint 变更区域 + 上下文）
3. `batch_create_files` — 批量创建后汇总所有 lint 结果
4. `validate_scripts` — 增强现有验证，语法检查通过后追加 lint 检查

### 返回格式增强

```json
{
  "success": true,
  "lint": {
    "errors": [
      {
        "rule": "L002",
        "line": 45,
        "message": "RigidBody3D.bounce 在 Godot 4 中不存在",
        "suggestion": "使用 PhysicsMaterial: var mat := PhysicsMaterial.new(); mat.bounce = 0.4; body.physics_material_override = mat"
      }
    ],
    "warnings": []
  }
}
```

## P1: 代码模板系统

### 位置

`src/tools/code-templates.ts`

### 模板列表

| 模板 ID | 名称 | 覆盖场景 |
|---------|------|----------|
| T001 | camera3d_setup | Camera3D + look_at，保证 add_child 在前 |
| T002 | rigidbody3d_with_bounce | RigidBody3D + PhysicsMaterial + CollisionShape3D |
| T003 | area3d_detection | Area3D 子节点用于碰撞检测（CharacterBody3D 场景） |
| T004 | environment_adjustments | WorldEnvironment + 色彩校正（正确属性名） |
| T005 | softbody3d_setup | SoftBody3D（正确属性名 total_mass/damping_coefficient） |
| T006 | astar_grid_setup | AStarGrid2D（先 update 再 set_point_solid） |
| T007 | line2d_dashed | Line2D + dash_pattern（PackedFloat32Array） |

### 模板格式

每个模板是一个函数，接收参数返回 GDScript 代码片段：

```typescript
interface CodeTemplate {
  id: string;
  name: string;
  description: string;
  params: TemplateParam[];
  generate: (params: Record<string, any>) => string;
}

// 示例: T002 rigidbody3d_with_bounce
const rigidbodyWithBounce: CodeTemplate = {
  id: "T002",
  name: "rigidbody3d_with_bounce",
  description: "创建带弹跳的 RigidBody3D",
  params: [
    { name: "position", type: "Vector3", default: "Vector3.ZERO" },
    { name: "radius", type: "float", default: "0.5" },
    { name: "bounce", type: "float", default: "0.4" },
    { name: "mass", type: "float", default: "1.0" },
    { name: "color", type: "Color", default: "Color.WHITE" },
  ],
  generate: (p) => `
var rb := RigidBody3D.new()
rb.position = ${p.position}
rb.mass = ${p.mass}
var phys_mat := PhysicsMaterial.new()
phys_mat.bounce = ${p.bounce}
rb.physics_material_override = phys_mat
var mesh_inst := MeshInstance3D.new()
var sphere := SphereMesh.new()
sphere.radius = ${p.radius}
sphere.height = ${p.radius} * 2.0
mesh_inst.mesh = sphere
var mat := StandardMaterial3D.new()
mat.albedo_color = ${p.color}
mesh_inst.material_override = mat
rb.add_child(mesh_inst)
var col := CollisionShape3D.new()
var shape := SphereShape3D.new()
shape.radius = ${p.radius}
col.shape = shape
rb.add_child(col)
add_child(rb)
`.trim(),
};
```

### 集成方式

不新增独立 MCP tool。模板通过以下方式使用：

1. **LLM 系统提示注入** — 在 Godot MCP 的系统提示中列出模板代码，LLM 生成代码时参考
2. **lint 修复建议** — L002 触发时，suggestion 直接返回 T002 的模板代码
3. **edit_script 自动修复** — 未来可支持 `edit_script` 的 `auto_fix: true` 参数，lint 触发后自动替换

## P2: get_class_info 废弃属性标注

### 位置

`src/tools/class-info.ts`

### 实现方案

在 `get_class_info` 返回的属性列表中，对 Godot 4.6 已重命名/移除的属性添加注释：

```typescript
// 已知废弃属性映射表
const DEPRECATED_PROPERTIES: Record<string, Record<string, { removed: boolean; replacement?: string }>> = {
  "Environment": {
    "adjustments_enabled": { removed: false, replacement: "adjustment_enabled" },
    "adjustments_brightness": { removed: false, replacement: "adjustment_brightness" },
    "adjustments_contrast": { removed: false, replacement: "adjustment_contrast" },
    "adjustments_saturation": { removed: false, replacement: "adjustment_saturation" },
    "tone_mapper": { removed: false, replacement: "tonemap_mode" },
    "physically_based_lights_enabled": { removed: true },
  },
  "Node3D": {
    "visibility_range_begin": { removed: true },
    "visibility_range_end": { removed: true },
  },
  "SoftBody3D": {
    "mass": { removed: false, replacement: "total_mass" },
    "linear_damping": { removed: false, replacement: "damping_coefficient" },
  },
  "RigidBody3D": {
    "bounce": { removed: true, replacement: "PhysicsMaterial.bounce via physics_material_override" },
    "friction": { removed: true, replacement: "PhysicsMaterial.friction via physics_material_override" },
  },
  "CylinderMesh": {
    "radius": { removed: true, replacement: "top_radius + bottom_radius" },
  },
  "FogMaterial": {
    "albedo_color": { removed: false, replacement: "emission" },
  },
};
```

### 返回格式增强

```json
{
  "class_name": "Environment",
  "properties": [
    {
      "name": "adjustment_enabled",
      "type": "bool",
      "deprecated_notes": null
    },
    {
      "name": "tonemap_mode",
      "type": "int",
      "deprecated_notes": "Godot 4.6 重命名自 tone_mapper"
    }
  ],
  "deprecated_warnings": [
    "注意: adjustments_enabled 在旧版本中为 adjustments_enabled（带 s），已重命名"
  ]
}
```

## 文件分布

```
src/
  tools/
    gdscript-lint.ts      # P0: lint 规则引擎
    code-templates.ts     # P1: 代码模板
    class-info.ts         # P2: 废弃属性标注（修改现有）
    validation.ts         # 修改: 集成 lint 到 validate_scripts
    scene.ts              # 修改: 集成 lint 到 write_script/edit_script
  GodotServer.ts          # 修改: get_class_info 增加废弃标注
```

## 实施优先级

1. **P0** (lint 引擎) — 投入产出比最高，一次实现永久受益
2. **P1** (代码模板) — 作为 lint suggestion 的副产品，减少未来生成错误
3. **P2** (废弃标注) — 锦上添花，防止 LLM 询问属性时拿到错误信息

## 测试方案

每个 lint 规则对应一个测试用例：

```typescript
describe("GDScript Lint", () => {
  it("L002: 检测 RigidBody3D.bounce 直接赋值", () => {
    const code = `rb.bounce = 0.4`;
    const results = lintGDScript(code);
    expect(results).toContainEqual(
      expect.objectContaining({ rule: "L002" })
    );
  });

  it("L002: 不误报 PhysicsMaterial.bounce", () => {
    const code = `phys_mat.bounce = 0.4`;
    const results = lintGDScript(code);
    expect(results.find(r => r.rule === "L002")).toBeUndefined();
  });
});
```
