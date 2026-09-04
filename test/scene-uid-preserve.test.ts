import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

// A5 (2026-08-19 反馈 headless save_scene 抹 uid) 测试套:
// - 契约段(无 Godot 依赖): godot_operations.gd 的 _save_atomic 支持 preserve_uids_from,
//   场景写盘调用点(save_scene/add_node/edit_node/batch/load_sprite)传原路径,
//   create_scene/mesh_library/resave 不传(语义边界)。
// - e2e 段(GODOT_PATH 门控,仿 e2e-resilience-headless 模式): 带 uid 的 tmp 项目跑
//   save_scene,断言 [gd_scene] header uid 与 [ext_resource] uid 保留。
//
// 根因背景: pack() 新建 PackedScene uid 为空 → ResourceSaver 不写 uid=;ext uid 依赖
// ResourceUID 注册表(headless 未 import 缺失)。Resource 无公开 uid 属性(4.6.3 实测
// Invalid access),文本回填是唯一兼容 4.5-4.7 的修法(_restore_uids_in_file)。

const gd = readFileSync('src/scripts/godot_operations.gd', 'utf8');

describe('A5 契约: _save_atomic preserve_uids_from(源码断言)', () => {
  it('_save_atomic 有第三参 preserve_uids_from 且 save 后调 _restore_uids_in_file', () => {
    expect(gd).toContain('func _save_atomic(res, full_path: String, preserve_uids_from: String = "") -> int');
    const body = gd.slice(gd.indexOf('func _save_atomic'), gd.indexOf('func _extract_uids'));
    expect(body.indexOf('ResourceSaver.save')).toBeLessThan(body.indexOf('_restore_uids_in_file(tmp, uids)'));
  });

  it('场景写盘 6 调用点传原路径(save_scene/add_node/edit_node/remove_node/batch/load_sprite)', () => {
    expect(gd.match(/_save_atomic\(packed_scene, absolute_scene_path, absolute_scene_path\)/g)?.length)
      .toBe(4);  // add_node/edit_node/remove_node/batch(remove_node 2026-08-27 反馈迁持久化链)
    expect(gd).toContain('_save_atomic(packed_scene, full_scene_path, full_scene_path)');  // load_sprite
    expect(gd).toContain('_save_atomic(packed_scene, save_path, full_scene_path)');        // save_scene(new_path 时 uid 仍取原文件)
  });

  it('create_scene/mesh_library/resave_resources 不传(新文件无原 uid / 资源非场景 / 语义=重生成)', () => {
    expect(gd).toContain('var save_error = _save_atomic(packed_scene, full_scene_path)\n');  // create_scene(无第三参)
    expect(gd).toContain('_save_atomic(mesh_library, full_output_path)');
    expect(gd).toContain('_save_atomic(scene, scene_path)');
  });

  it('回填仅补缺失 uid 不覆盖已有,失败不阻断 save', () => {
    // N-7(审查): _restore_uids_in_file 是 godot_operations.gd 最后一个函数之前的有界段,
    // 直接切到文件尾(该文件没有 _dir_ensure —— 那在 mcp_bridge.gd)。
    const restore = gd.slice(gd.indexOf('func _restore_uids_in_file'));
    expect(restore).toContain('not stripped.contains(\' uid="\')');  // 已有不覆盖(N-6 后带前导空格)
  });
});

// ── e2e 段: 真 Godot headless 跑 save_scene 断言 uid 保留 ─────────────────────
const GODOT_PATH = process.env.GODOT_PATH || '';
const hasGodot = GODOT_PATH !== '' && existsSync(GODOT_PATH);

describe.skipIf(!hasGodot)('A5 e2e: save_scene 保留 uid(GODOT_PATH=' + (hasGodot ? 'set' : 'unset') + ')', () => {
  const SCENE_UID = 'uid://e2etest11aaaaaa1';
  const SUB_UID = 'uid://e2etest22bbbbbb2';

  it('save_scene 后 header uid + ext_resource uid 保留', () => {
    const proj = join(tmpdir(), `uid-preserve-e2e-${Date.now()}`);
    mkdirSync(join(proj, 'scenes'), { recursive: true });
    writeFileSync(join(proj, 'project.godot'), 'config_version=5\n[application]\nconfig/name="uid-e2e"\n', 'utf-8');
    writeFileSync(join(proj, 'scenes', 'sub.tscn'),
      `[gd_scene load_steps=2 format=3 uid="${SUB_UID}"]\n\n[node name="Sub" type="Node2D"]\n`, 'utf-8');
    writeFileSync(join(proj, 'scenes', 'main.tscn'),
      `[gd_scene load_steps=3 format=3 uid="${SCENE_UID}"]\n\n` +
      `[ext_resource type="PackedScene" uid="${SUB_UID}" path="res://scenes/sub.tscn" id="1_e2e"]\n\n` +
      `[node name="Main" type="Node2D"]\n\n` +
      `[node name="Sub" parent="." instance=ExtResource("1_e2e")]\n`, 'utf-8');

    try {
      const opsScript = resolve('src/scripts/godot_operations.gd');
      const r = spawnSync(GODOT_PATH, [
        '--headless', '--path', proj, '--script', opsScript, 'save_scene',
        JSON.stringify({ scene_path: 'res://scenes/main.tscn' }),
      ], { encoding: 'utf-8', timeout: 60_000 });

      expect(r.status, `save_scene 退出码(输出: ${(r.stdout || '') + (r.stderr || '')})`).toBe(0);
      const saved = readFileSync(join(proj, 'scenes', 'main.tscn'), 'utf-8');
      expect(saved, 'header uid 保留').toContain(`uid="${SCENE_UID}"`);
      expect(saved, 'ext_resource uid 按 path 匹配回填').toContain(`uid="${SUB_UID}"`);
      expect(saved, 'ext_resource 行仍带 path(引用不破)').toContain('path="res://scenes/sub.tscn"');
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  }, 90_000);
});
