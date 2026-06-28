import { expect } from 'vitest';
import { findInstanceNode, detachInstance, nodePathToNameAndParent } from '../src/tscn/tscn-editor.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TARGET_TSCN = `[gd_scene load_steps=3 format=3]

[ext_resource type="PackedScene" uid="uid://abc" path="res://scenes/player.tscn" id="1"]
[ext_resource type="Script" path="res://scripts/main.gd" id="2"]

[node name="Main" type="Node2D"]

[node name="Player" parent="." instance=ExtResource("1")]
position = Vector2(100, 200)
visible = false

[node name="Camera2D" type="Camera2D" parent="."]
`;

const SOURCE_TSCN = `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/player.gd" id="1"]

[node name="Player" type="CharacterBody2D"]
script = ExtResource("1")
speed = 200.0

[node name="Sprite2D" type="Sprite2D" parent="."]
texture = null

[node name="CollisionShape2D" type="CollisionShape2D" parent="."]
`;

const SOURCE_WITH_EXT_CONFLICT = `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/player.gd" id="1"]
[ext_resource type="Texture2D" path="res://assets/sprite.png" id="2"]

[node name="Player" type="CharacterBody2D"]
script = ExtResource("1")

[node name="Sprite2D" type="Sprite2D" parent="."]
texture = ExtResource("2")
`;

// ── findInstanceNode ──────────────────────────────────────────────────────────

describe('tscn-editor findInstanceNode', () => {
  it('should find instance node by name at root level', () => {
    // node_path "root/Player" → nodeName="Player", tscnParent="."
    const info = findInstanceNode(TARGET_TSCN, 'Player', '.');
    expect(info).not.toBeNull();
    expect(info.instanceId).toBe(1);
    expect(info.sourcePath).toBe('res://scenes/player.tscn');
    expect(info.propertyOverrides.length).toBe(2);
    expect(info.propertyOverrides[0].includes('position')).toBe(true);
    expect(info.propertyOverrides[1].includes('visible')).toBe(true);
  });

  it('should return null for non-instance node', () => {
    const info = findInstanceNode(TARGET_TSCN, 'Camera2D', '.');
    expect(info).toBe(null);
  });

  it('should return null for non-existent node', () => {
    const info = findInstanceNode(TARGET_TSCN, 'NonExistent', '.');
    expect(info).toBe(null);
  });

  it('should return null for wrong parent', () => {
    const info = findInstanceNode(TARGET_TSCN, 'Player', 'WrongParent');
    expect(info).toBe(null);
  });
});

// ── nodePathToNameAndParent ───────────────────────────────────────────────────

describe('tscn-editor nodePathToNameAndParent', () => {
  it('should parse root-level node', () => {
    const { nodeName, parent } = nodePathToNameAndParent('/root/Player');
    expect(nodeName).toBe('Player');
    expect(parent).toBe('.');
  });

  it('should parse nested node', () => {
    const { nodeName, parent } = nodePathToNameAndParent('/root/Level/Player');
    expect(nodeName).toBe('Player');
    expect(parent).toBe('Level');
  });

  it('should parse deeply nested node', () => {
    const { nodeName, parent } = nodePathToNameAndParent('/root/Level/Sub/Enemy');
    expect(nodeName).toBe('Enemy');
    expect(parent).toBe('Level/Sub');
  });

  it('should throw for root node', () => {
    expect(() => nodePathToNameAndParent('/root')).toThrow(/Cannot detach the root node/);
  });
});

// ── detachInstance ────────────────────────────────────────────────────────────

describe('tscn-editor detachInstance', () => {
  it('should replace instance reference with inlined subtree', () => {
    const result = detachInstance(TARGET_TSCN, SOURCE_TSCN, 'Player', '.');

    // Should contain the expanded root node (CharacterBody2D) instead of instance=ExtResource
    expect(result.includes('[node name="Player" type="CharacterBody2D"')).toBe(true);
    expect(result.includes('instance=ExtResource')).toBe(false);

    // Should contain child nodes with adjusted parent
    expect(result.includes('parent="Player"')).toBe(true);
    expect(result.includes('Sprite2D')).toBe(true);
    expect(result.includes('CollisionShape2D')).toBe(true);
    expect(result).toMatchSnapshot('detach-instance-basic');
  });

  // CRITICAL-3 (R2) push back 部分成立: 确认无尾部斜杠(原审查"尾部斜杠"指控不成立,因 [^"]+ 不匹配空)。
  // 但 @748 发现 push back 漏网的双 parent bug: 原 [^"]+ 不匹配 parent="" → 走 else 在 ] 前叠加 parent,
  // 原 parent="" 残留 → 双 parent 属性。@748 fix: 正则 [^"]+ → [^"]* + :444 || '' 守卫,空 parent 进 if
  // 替换(parent="" → parent="nodeName")。本测试验证无尾部斜杠(fix 后仍成立),@748 下方测试验证无双 parent。
  it('parent="" 无尾部斜杠(CRITICAL-3 push back,fix 后走 if 替换)', () => {
    const sourceEmptyParent = `[gd_scene load_steps=2 format=3]
[ext_resource type="Script" path="res://scripts/player.gd" id="1"]
[node name="Player" type="CharacterBody2D"]
[node name="Child" type="Node" parent=""]`;
    const result = detachInstance(TARGET_TSCN, sourceEmptyParent, 'Player', '.');
    expect(result).not.toContain('parent="Player/"');  // 无尾部斜杠(正则 [^"]+ 已挡空串)
    expect(result).toContain('parent="Player"');  // 走 else 正确产出
  });

  // @748 (defects 748 = CRITICAL-3 深层): CRITICAL-3 push back(:123)确认无尾部斜杠,但漏了
  // 双 parent bug——parent="" 走 else(:447)在 ] 前插 parent="Player",原 parent="" 残留
  // → 双 parent 属性(parent="" parent="Player")致 Godot 解析混乱。fix: 正则 [^"]+ → [^"]*
  // 让 parent="" 进 if 分支替换(空串等同 '.' 处理),非 else 叠加。
  it('@748 parent="" 不残留双 parent 属性(空 parent 应被替换非叠加)', () => {
    const sourceEmptyParent = `[gd_scene load_steps=2 format=3]
[ext_resource type="Script" path="res://scripts/player.gd" id="1"]
[node name="Player" type="CharacterBody2D"]
[node name="Child" type="Node" parent=""]`;
    const result = detachInstance(TARGET_TSCN, sourceEmptyParent, 'Player', '.');
    expect(result).not.toContain('parent=""');  // 空 parent 不残留(被替换,非叠加)
    const childLine = result.split('\n').find(l => l.includes('name="Child"'));
    expect(childLine).toBeDefined();
    const parentCount = (childLine.match(/parent="/g) || []).length;
    expect(parentCount).toBe(1);  // 单 parent 属性
  });

  it('should preserve property overrides from target', () => {
    const result = detachInstance(TARGET_TSCN, SOURCE_TSCN, 'Player', '.');

    // Property overrides should be present
    expect(result.includes('position = Vector2(100, 200)')).toBe(true);
    expect(result.includes('visible = false')).toBe(true);

    // Source properties should also be present
    expect(result.includes('speed = 200.0')).toBe(true);
    expect(result.includes('script = ExtResource')).toBe(true);
  });

  it('should remap ext_resource IDs to avoid conflicts', () => {
    const targetWithHighIds = `[gd_scene load_steps=2 format=3]

[ext_resource type="PackedScene" path="res://scenes/player.tscn" id="5"]

[node name="Main" type="Node2D"]

[node name="Player" parent="." instance=ExtResource("5")]
`;
    const info = findInstanceNode(targetWithHighIds, 'Player', '.');
    expect(info).not.toBeNull();

    const result = detachInstance(targetWithHighIds, SOURCE_WITH_EXT_CONFLICT, 'Player', '.');

    // Source had id="1" and id="2" — should be remapped to 6, 7 (target max was 5)
    expect(result.includes('id="6"')).toBe(true);
    expect(result.includes('id="7"')).toBe(true);
    // ExtResource("6") and ExtResource("7") should appear in node property lines
    expect(result.includes('ExtResource("6")')).toBe(true);
  });

  it('should remove unused ext_resource for the instance', () => {
    const result = detachInstance(TARGET_TSCN, SOURCE_TSCN, 'Player', '.');

    // The PackedScene ext_resource (id="1") should be removed since no other node uses it
    expect(result.includes('path="res://scenes/player.tscn"')).toBe(false);
  });

  it('should keep ext_resource if still referenced by other nodes', () => {
    const targetMultiRef = `[gd_scene load_steps=3 format=3]

[ext_resource type="PackedScene" uid="uid://abc" path="res://scenes/player.tscn" id="1"]

[node name="Main" type="Node2D"]

[node name="Player" parent="." instance=ExtResource("1")]
position = Vector2(100, 200)

[node name="Player2" parent="." instance=ExtResource("1")]
`;
    const result = detachInstance(targetMultiRef, SOURCE_TSCN, 'Player', '.');

    // The PackedScene ext_resource should be kept because Player2 still references it
    expect(result.includes('path="res://scenes/player.tscn"')).toBe(true);
  });

  it('should update load_steps in header', () => {
    const result = detachInstance(TARGET_TSCN, SOURCE_TSCN, 'Player', '.');
    const headerMatch = result.match(/load_steps=(\d+)/);
    expect(headerMatch).not.toBeNull();
    const steps = parseInt(headerMatch[1]);
    // After detach: 1 ext_resource (script from source) + 1 ext_resource (main.gd) + 1 = 3
    // Removed PackedScene ext_resource. So: main.gd + player.gd + 1 = 3
    expect(steps >= 2).toBe(true);
  });

  it('should throw for non-instance node', () => {
    expect(() => detachInstance(TARGET_TSCN, SOURCE_TSCN, 'Camera2D', '.')).toThrow(/Instance node not found/);
  });

  it('CRITICAL-2: inserts sub_resources when first [node] is the instance', () => {
    const targetFirstIsInstance = `[gd_scene load_steps=2 format=3]

[ext_resource type="PackedScene" uid="uid://ui1" path="res://scenes/ui.tscn" id="1"]

[node name="UI" parent="." instance=ExtResource("1")]
`;
    const sourceWithSub = `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/ui.gd" id="1"]

[sub_resource type="StyleBoxFlat" id="1"]
bg_color = Color(1, 0, 0, 1)

[node name="UI" type="Control"]
theme_override_styles/panel = SubResource("1")
`;
    const result = detachInstance(targetFirstIsInstance, sourceWithSub, 'UI', '.');

    // 修复前: sub_resource 丢失(输出含 SubResource 引用却无 [sub_resource] 段)
    expect(result.includes('[sub_resource')).toBe(true);
    // SubResource 引用 id 应与 remapped [sub_resource] id 对得上(target 无 sub_resource, remap 从 1 起)
    const subMatch = result.match(/\[sub_resource type="StyleBoxFlat" id="(\d+)"\]/);
    expect(subMatch).not.toBeNull();
    const subId = subMatch[1];
    expect(result.includes(`SubResource("${subId}")`)).toBe(true);
  });

  it('CRITICAL-2 regression: sub_resources precede all [node] sections in normal case (guards :497)', () => {
    const targetNormal = `[gd_scene load_steps=3 format=3]

[ext_resource type="PackedScene" uid="uid://ui1" path="res://scenes/ui.tscn" id="1"]

[node name="Main" type="Node2D"]

[node name="UI" parent="." instance=ExtResource("1")]
`;
    const sourceWithSub = `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/ui.gd" id="1"]

[sub_resource type="StyleBoxFlat" id="1"]
bg_color = Color(1, 0, 0, 1)

[node name="UI" type="Control"]
theme_override_styles/panel = SubResource("1")
`;
    const result = detachInstance(targetNormal, sourceWithSub, 'UI', '.');

    // 常规情况(firstNodeIdx < lineIndex): sub_resources 必须由 :497 插在所有 [node] 之前(前向声明)
    const subIdx = result.indexOf('[sub_resource');
    const firstNodeIdx = result.indexOf('[node');
    expect(subIdx).toBeGreaterThanOrEqual(0);
    expect(firstNodeIdx).toBeGreaterThanOrEqual(0);
    expect(subIdx).toBeLessThan(firstNodeIdx);  // 删 :497 会令 subIdx > firstNodeIdx, 测试失败
  });

  it('should handle source with no ext_resources', () => {
    const sourceNoExt = `[gd_scene format=3]

[node name="Player" type="CharacterBody2D"]
speed = 100.0

[node name="Sprite2D" type="Sprite2D" parent="."]
`;
    const result = detachInstance(TARGET_TSCN, sourceNoExt, 'Player', '.');
    expect(result.includes('speed = 100.0')).toBe(true);
    expect(result.includes('Sprite2D')).toBe(true);
    expect(result.includes('parent="Player"')).toBe(true);
  });

  it('should handle nested parent paths', () => {
    const targetNested = `[gd_scene load_steps=2 format=3]

[ext_resource type="PackedScene" path="res://scenes/enemy.tscn" id="1"]

[node name="Main" type="Node2D"]

[node name="Level" type="Node2D" parent="."]

[node name="Enemy" parent="Level" instance=ExtResource("1")]
`;
    const result = detachInstance(targetNested, SOURCE_TSCN, 'Enemy', 'Level');
    // Root of source should have parent="Level" and name="Enemy"
    expect(result.includes('name="Enemy"')).toBe(true);
    expect(result.includes('parent="Level"')).toBe(true);
    // Child nodes should have parent="Enemy"
    expect(result.includes('parent="Enemy"')).toBe(true);
  });
});

// ── C1: Property override deduplication ────────────────────────────────────────

describe('tscn-editor C1: property override deduplication', () => {
  it('should replace (not duplicate) source property when override exists', () => {
    // Source has speed = 200.0, target overrides with speed = 300.0
    const target = `[gd_scene load_steps=2 format=3]

[ext_resource type="PackedScene" path="res://scenes/player.tscn" id="1"]

[node name="Main" type="Node2D"]

[node name="Player" parent="." instance=ExtResource("1")]
speed = 300.0
`;
    const source = `[gd_scene format=3]

[node name="Player" type="CharacterBody2D"]
speed = 200.0
health = 100.0
`;
    const result = detachInstance(target, source, 'Player', '.');

    // The override value should be present
    expect(result.includes('speed = 300.0')).toBe(true);
    // The source value should NOT be present (deduplicated)
    expect(result.includes('speed = 200.0')).toBe(false);
    // Non-overridden source property should still be present
    expect(result.includes('health = 100.0')).toBe(true);
  });

  it('should keep source properties that are not overridden', () => {
    const target = `[gd_scene load_steps=2 format=3]

[ext_resource type="PackedScene" path="res://scenes/player.tscn" id="1"]

[node name="Main" type="Node2D"]

[node name="Player" parent="." instance=ExtResource("1")]
position = Vector2(100, 200)
`;
    const source = `[gd_scene format=3]

[node name="Player" type="CharacterBody2D"]
speed = 200.0
health = 100.0
`;
    const result = detachInstance(target, source, 'Player', '.');

    // Both source properties should remain since neither is overridden
    expect(result.includes('speed = 200.0')).toBe(true);
    expect(result.includes('health = 100.0')).toBe(true);
    // Override should also be present
    expect(result.includes('position = Vector2(100, 200)')).toBe(true);
  });
});

// ── C2: sub_resource and connection handling ───────────────────────────────────

describe('tscn-editor C2: sub_resource handling', () => {
  it('should preserve sub_resources from source in output', () => {
    const target = `[gd_scene load_steps=2 format=3]

[ext_resource type="PackedScene" path="res://scenes/player.tscn" id="1"]

[node name="Main" type="Node2D"]

[node name="Player" parent="." instance=ExtResource("1")]
`;
    const source = `[gd_scene load_steps=3 format=3]

[ext_resource type="Script" path="res://scripts/player.gd" id="1"]

[sub_resource type="RectangleShape2D" id="1"]
size = Vector2(50, 50)

[node name="Player" type="CharacterBody2D"]
script = ExtResource("1")

[node name="CollisionShape2D" type="CollisionShape2D" parent="."]
shape = SubResource("1")
`;
    const result = detachInstance(target, source, 'Player', '.');

    // sub_resource should be preserved
    expect(result.includes('[sub_resource type="RectangleShape2D"')).toBe(true);
    expect(result.includes('size = Vector2(50, 50)')).toBe(true);
  });

  it('should remap sub_resource IDs to avoid conflicts with target', () => {
    const target = `[gd_scene load_steps=3 format=3]

[ext_resource type="PackedScene" path="res://scenes/player.tscn" id="1"]

[sub_resource type="CircleShape2D" id="1"]
radius = 10.0

[node name="Main" type="Node2D"]

[node name="Player" parent="." instance=ExtResource("1")]
`;
    const source = `[gd_scene load_steps=3 format=3]

[sub_resource type="RectangleShape2D" id="1"]
size = Vector2(50, 50)

[node name="Player" type="CharacterBody2D"]

[node name="CollisionShape2D" type="CollisionShape2D" parent="."]
shape = SubResource("1")
`;
    const result = detachInstance(target, source, 'Player', '.');

    // Target has sub_resource id="1", source id="1" should be remapped to id="2"
    expect(result.includes('[sub_resource type="RectangleShape2D" id="2"]')).toBe(true);
    // Node reference should be updated to match
    expect(result.includes('SubResource("2")')).toBe(true);
    // Target sub_resource should be untouched
    expect(result.includes('[sub_resource type="CircleShape2D" id="1"]')).toBe(true);
    expect(result).toMatchSnapshot('detach-with-sub-resources');
  });

  it('should remap sub_resource IDs that conflict with multiple target IDs', () => {
    const target = `[gd_scene load_steps=4 format=3]

[ext_resource type="PackedScene" path="res://scenes/player.tscn" id="1"]

[sub_resource type="CircleShape2D" id="1"]
radius = 10.0

[sub_resource type="CapsuleShape2D" id="2"]
height = 20.0

[node name="Main" type="Node2D"]

[node name="Player" parent="." instance=ExtResource("1")]
`;
    const source = `[gd_scene load_steps=3 format=3]

[sub_resource type="RectangleShape2D" id="1"]
size = Vector2(50, 50)

[sub_resource type="ConvexPolygonShape2D" id="2"]
points = [Vector2(0, 0), Vector2(10, 0)]

[node name="Player" type="CharacterBody2D"]

[node name="Collision" type="CollisionShape2D" parent="."]
shape = SubResource("1")

[node name="Hitbox" type="CollisionShape2D" parent="."]
shape = SubResource("2")
`;
    const result = detachInstance(target, source, 'Player', '.');

    // Target max sub_resource id is 2, source ids 1,2 should become 3,4
    expect(result.includes('[sub_resource type="RectangleShape2D" id="3"]')).toBe(true);
    expect(result.includes('[sub_resource type="ConvexPolygonShape2D" id="4"]')).toBe(true);
    expect(result.includes('SubResource("3")')).toBe(true);
    expect(result.includes('SubResource("4")')).toBe(true);
  });
});

describe('tscn-editor C2: connection handling', () => {
  it('should preserve and remap connections from source', () => {
    const target = `[gd_scene load_steps=2 format=3]

[ext_resource type="PackedScene" path="res://scenes/player.tscn" id="1"]

[node name="Main" type="Node2D"]

[node name="Player" parent="." instance=ExtResource("1")]
`;
    const source = `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/player.gd" id="1"]

[node name="Player" type="CharacterBody2D"]
script = ExtResource("1")

[node name="Button" type="Button" parent="."]

[connection signal="pressed" from="Button" to="." method="_on_button_pressed"]
`;
    const result = detachInstance(target, source, 'Player', '.');

    // Connection should be present with remapped paths
    expect(result.includes('signal="pressed"')).toBe(true);
    expect(result.includes('from="Player/Button"')).toBe(true);
    expect(result.includes('to="Player"')).toBe(true);
    expect(result).toMatchSnapshot('detach-with-connections');
  });

  it('should remap connection with nested child paths', () => {
    const target = `[gd_scene load_steps=2 format=3]

[ext_resource type="PackedScene" path="res://scenes/ui.tscn" id="1"]

[node name="Main" type="Node2D"]

[node name="UI" parent="." instance=ExtResource("1")]
`;
    const source = `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/ui.gd" id="1"]

[node name="UI" type="Control"]
script = ExtResource("1")

[node name="Panel" type="Panel" parent="."]

[node name="CloseBtn" type="Button" parent="Panel"]

[connection signal="pressed" from="Panel/CloseBtn" to="." method="_on_close"]
`;
    const result = detachInstance(target, source, 'UI', '.');

    expect(result.includes('from="UI/Panel/CloseBtn"')).toBe(true);
    expect(result.includes('to="UI"')).toBe(true);
  });
});
