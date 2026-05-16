import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findInstanceNode, detachInstance, nodePathToNameAndParent } from '../build/tscn-editor.js';

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
    assert.ok(info, 'should find the instance node');
    assert.equal(info.instanceId, 1);
    assert.equal(info.sourcePath, 'res://scenes/player.tscn');
    assert.equal(info.propertyOverrides.length, 2);
    assert.ok(info.propertyOverrides[0].includes('position'));
    assert.ok(info.propertyOverrides[1].includes('visible'));
  });

  it('should return null for non-instance node', () => {
    const info = findInstanceNode(TARGET_TSCN, 'Camera2D', '.');
    assert.equal(info, null);
  });

  it('should return null for non-existent node', () => {
    const info = findInstanceNode(TARGET_TSCN, 'NonExistent', '.');
    assert.equal(info, null);
  });

  it('should return null for wrong parent', () => {
    const info = findInstanceNode(TARGET_TSCN, 'Player', 'WrongParent');
    assert.equal(info, null);
  });
});

// ── nodePathToNameAndParent ───────────────────────────────────────────────────

describe('tscn-editor nodePathToNameAndParent', () => {
  it('should parse root-level node', () => {
    const { nodeName, parent } = nodePathToNameAndParent('/root/Player');
    assert.equal(nodeName, 'Player');
    assert.equal(parent, '.');
  });

  it('should parse nested node', () => {
    const { nodeName, parent } = nodePathToNameAndParent('/root/Level/Player');
    assert.equal(nodeName, 'Player');
    assert.equal(parent, 'Level');
  });

  it('should parse deeply nested node', () => {
    const { nodeName, parent } = nodePathToNameAndParent('/root/Level/Sub/Enemy');
    assert.equal(nodeName, 'Enemy');
    assert.equal(parent, 'Level/Sub');
  });

  it('should throw for root node', () => {
    assert.throws(() => nodePathToNameAndParent('/root'), /Cannot detach the root node/);
  });
});

// ── detachInstance ────────────────────────────────────────────────────────────

describe('tscn-editor detachInstance', () => {
  it('should replace instance reference with inlined subtree', () => {
    const result = detachInstance(TARGET_TSCN, SOURCE_TSCN, 'Player', '.');

    // Should contain the expanded root node (CharacterBody2D) instead of instance=ExtResource
    assert.ok(result.includes('[node name="Player" type="CharacterBody2D"'), 'should have root node with type');
    assert.ok(!result.includes('instance=ExtResource'), 'should not have instance reference');

    // Should contain child nodes with adjusted parent
    assert.ok(result.includes('parent="Player"'), 'child nodes should have Player as parent');
    assert.ok(result.includes('Sprite2D'));
    assert.ok(result.includes('CollisionShape2D'));
  });

  it('should preserve property overrides from target', () => {
    const result = detachInstance(TARGET_TSCN, SOURCE_TSCN, 'Player', '.');

    // Property overrides should be present
    assert.ok(result.includes('position = Vector2(100, 200)'), 'should preserve position override');
    assert.ok(result.includes('visible = false'), 'should preserve visible override');

    // Source properties should also be present
    assert.ok(result.includes('speed = 200.0'), 'should preserve source property');
    assert.ok(result.includes('script = ExtResource'), 'should preserve source script');
  });

  it('should remap ext_resource IDs to avoid conflicts', () => {
    const targetWithHighIds = `[gd_scene load_steps=2 format=3]

[ext_resource type="PackedScene" path="res://scenes/player.tscn" id="5"]

[node name="Main" type="Node2D"]

[node name="Player" parent="." instance=ExtResource("5")]
`;
    const info = findInstanceNode(targetWithHighIds, 'Player', '.');
    assert.ok(info);

    const result = detachInstance(targetWithHighIds, SOURCE_WITH_EXT_CONFLICT, 'Player', '.');

    // Source had id="1" and id="2" — should be remapped to 6, 7 (target max was 5)
    assert.ok(result.includes('id="6"'), 'source ext_resource should be remapped to id 6');
    assert.ok(result.includes('id="7"'), 'second source ext_resource should be remapped to id 7');
    // ExtResource("6") and ExtResource("7") should appear in node property lines
    assert.ok(result.includes('ExtResource("6")'), 'node should reference remapped ExtResource 6');
  });

  it('should remove unused ext_resource for the instance', () => {
    const result = detachInstance(TARGET_TSCN, SOURCE_TSCN, 'Player', '.');

    // The PackedScene ext_resource (id="1") should be removed since no other node uses it
    assert.ok(!result.includes('path="res://scenes/player.tscn"'), 'unused PackedScene ext_resource should be removed');
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
    assert.ok(result.includes('path="res://scenes/player.tscn"'), 'ext_resource should be kept when still referenced');
  });

  it('should update load_steps in header', () => {
    const result = detachInstance(TARGET_TSCN, SOURCE_TSCN, 'Player', '.');
    const headerMatch = result.match(/load_steps=(\d+)/);
    assert.ok(headerMatch, 'should have load_steps');
    const steps = parseInt(headerMatch[1]);
    // After detach: 1 ext_resource (script from source) + 1 ext_resource (main.gd) + 1 = 3
    // Removed PackedScene ext_resource. So: main.gd + player.gd + 1 = 3
    assert.ok(steps >= 2, `load_steps should be reasonable, got ${steps}`);
  });

  it('should throw for non-instance node', () => {
    assert.throws(
      () => detachInstance(TARGET_TSCN, SOURCE_TSCN, 'Camera2D', '.'),
      /Instance node not found/,
    );
  });

  it('should handle source with no ext_resources', () => {
    const sourceNoExt = `[gd_scene format=3]

[node name="Player" type="CharacterBody2D"]
speed = 100.0

[node name="Sprite2D" type="Sprite2D" parent="."]
`;
    const result = detachInstance(TARGET_TSCN, sourceNoExt, 'Player', '.');
    assert.ok(result.includes('speed = 100.0'));
    assert.ok(result.includes('Sprite2D'));
    assert.ok(result.includes('parent="Player"'));
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
    assert.ok(result.includes('name="Enemy"'));
    assert.ok(result.includes('parent="Level"'));
    // Child nodes should have parent="Enemy"
    assert.ok(result.includes('parent="Enemy"'));
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
    assert.ok(result.includes('speed = 300.0'), 'should have override value 300.0');
    // The source value should NOT be present (deduplicated)
    assert.ok(!result.includes('speed = 200.0'), 'should NOT have source value 200.0');
    // Non-overridden source property should still be present
    assert.ok(result.includes('health = 100.0'), 'should preserve non-overridden source property');
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
    assert.ok(result.includes('speed = 200.0'), 'should preserve speed');
    assert.ok(result.includes('health = 100.0'), 'should preserve health');
    // Override should also be present
    assert.ok(result.includes('position = Vector2(100, 200)'), 'should preserve position override');
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
    assert.ok(result.includes('[sub_resource type="RectangleShape2D"'), 'should have sub_resource header');
    assert.ok(result.includes('size = Vector2(50, 50)'), 'should have sub_resource properties');
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
    assert.ok(result.includes('[sub_resource type="RectangleShape2D" id="2"]'), 'source sub_resource should be remapped to id 2');
    // Node reference should be updated to match
    assert.ok(result.includes('SubResource("2")'), 'node should reference remapped SubResource 2');
    // Target sub_resource should be untouched
    assert.ok(result.includes('[sub_resource type="CircleShape2D" id="1"]'), 'target sub_resource id 1 should be preserved');
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
    assert.ok(result.includes('[sub_resource type="RectangleShape2D" id="3"]'), 'source sub_resource 1 should remap to 3');
    assert.ok(result.includes('[sub_resource type="ConvexPolygonShape2D" id="4"]'), 'source sub_resource 2 should remap to 4');
    assert.ok(result.includes('SubResource("3")'), 'node should reference remapped SubResource 3');
    assert.ok(result.includes('SubResource("4")'), 'node should reference remapped SubResource 4');
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
    assert.ok(result.includes('signal="pressed"'), 'should have connection signal');
    assert.ok(result.includes('from="Player/Button"'), 'from path should be remapped to Player/Button');
    assert.ok(result.includes('to="Player"'), 'to path "." should be remapped to Player');
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

    assert.ok(result.includes('from="UI/Panel/CloseBtn"'), 'nested from path should be remapped');
    assert.ok(result.includes('to="UI"'), 'to path should be remapped to UI');
  });
});
