// test/scene-instance-detach.test.ts
// 补 src/tools/scene/scene-instance.ts handleDetachInstance 分支覆盖（原 :209-278 零直接单测）。
// handleDetachInstance 是纯文件操作（无 spawnGodot），测各错误分支 + happy path。
// 复用 test/tscn-editor.test.js 的 TARGET_TSCN/SOURCE_TSCN fixture（含 instance=ExtResource）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { handleDetachInstance } from '../src/tools/scene/scene-instance.js';

// 复用 tscn-editor.test.js 的 fixture（含 [node ... instance=ExtResource("1")]）
const TARGET_TSCN = `[gd_scene load_steps=3 format=3]

[ext_resource type="PackedScene" uid="uid://abc" path="res://scenes/player.tscn" id="1"]
[ext_resource type="Script" path="res://scripts/main.gd" id="2"]

[node name="Main" type="Node2D"]

[node name="Player" parent="." instance=ExtResource("1")]
position = Vector2(100, 200)
visible = false
`;

const SOURCE_TSCN = `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/player.gd" id="1"]

[node name="Player" type="CharacterBody2D"]
script = ExtResource("1")
speed = 200.0
`;

const NO_INSTANCE_TSCN = `[gd_scene load_steps=2 format=3]
[ext_resource type="Script" path="res://scripts/main.gd" id="1"]
[node name="Main" type="Node2D"]
`;

let projectDir: string;
let origAllowed: string | undefined;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'detach-'));
  // handleDetachInstance 经 requireProjectPath → resolveWithinRoot，需 ALLOWED_PROJECT_PATHS 放行 tmpdir
  origAllowed = process.env.ALLOWED_PROJECT_PATHS;
  process.env.ALLOWED_PROJECT_PATHS = projectDir;
  // 场景结构：projectDir/scenes/main.tscn（含 Player 实例）+ projectDir/scenes/player.tscn（源）
  mkdirSync(join(projectDir, 'scenes'), { recursive: true });
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  process.env.ALLOWED_PROJECT_PATHS = origAllowed;
});

describe('handleDetachInstance 分支覆盖', () => {
  it('缺 project_path → MISSING_PARAM', () => {
    const r = handleDetachInstance({ scene_path: 'res://scenes/main.tscn', node_path: 'Player' });
    expect(r.content[0].text).toContain('project_path');
  });

  it('缺 scene_path → MISSING_PARAM', () => {
    const r = handleDetachInstance({ project_path: projectDir, node_path: 'Player' });
    expect(r.content[0].text).toContain('scene_path');
  });

  it('缺 node_path → MISSING_PARAM', () => {
    const r = handleDetachInstance({ project_path: projectDir, scene_path: 'res://scenes/main.tscn' });
    expect(r.content[0].text).toContain('node_path');
  });

  it('场景文件不存在 → Error: Scene file not found', () => {
    const r = handleDetachInstance({
      project_path: projectDir,
      scene_path: 'res://scenes/nonexistent.tscn',
      node_path: 'Player',
    });
    expect(r.content[0].text).toContain('not found');
  });

  it('节点非实例 → NOT_AN_INSTANCE', () => {
    writeFileSync(join(projectDir, 'scenes', 'main.tscn'), NO_INSTANCE_TSCN, 'utf-8');
    const r = handleDetachInstance({
      project_path: projectDir,
      scene_path: 'res://scenes/main.tscn',
      node_path: 'Main',  // Main 是普通 Node 非 instance
    });
    expect(r.content[0].text).toContain('NOT_AN_INSTANCE');
  });

  it('源场景不存在 → Error: Source scene not found', () => {
    writeFileSync(join(projectDir, 'scenes', 'main.tscn'), TARGET_TSCN, 'utf-8');
    // 故意不写 player.tscn
    const r = handleDetachInstance({
      project_path: projectDir,
      scene_path: 'res://scenes/main.tscn',
      node_path: 'Player',
    });
    expect(r.content[0].text).toContain('Source scene not found');
  });

  it('happy path → Detached instance（property override 保留）', () => {
    writeFileSync(join(projectDir, 'scenes', 'main.tscn'), TARGET_TSCN, 'utf-8');
    writeFileSync(join(projectDir, 'scenes', 'player.tscn'), SOURCE_TSCN, 'utf-8');
    const r = handleDetachInstance({
      project_path: projectDir,
      scene_path: 'res://scenes/main.tscn',
      node_path: 'Player',
    });
    expect(r.content[0].text).toContain('Detached instance');
    expect(r.content[0].text).toContain('Player');
    // 验证文件真改了（position/visible override 内联进 main.tscn，instance 行消失）
    const updated = readFileSync(join(projectDir, 'scenes', 'main.tscn'), 'utf-8');
    expect(updated).not.toContain('instance=ExtResource');
    expect(updated).toContain('position = Vector2(100, 200)');
  });
});
