/**
 * T1 PoC: headless 反射链路可行性验证。
 *
 * 4 断言(spec §8 风险 1):
 *   1. load(class_path) 非 null
 *   2. 反射拿到 @export 字段(damage + kind)
 *   3. 枚举字段 hint_string 非空(kind 字段)
 *   4. ResourceSaver 落盘 + 重新 load 读回字段值一致
 *
 * 全 True → GDScript 反射主路径成立;任一 False → 切 TS 拼 .tres 备选(controller 决策)。
 *
 * 注:本测试为 PoC,T8 前可删/合入集成测试。依赖真实 Godot(GODOT_PATH),无 Godot 时跳过。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { executeGdscript } from '../../src/gdscript-executor.js';
import { findGodot } from '../../src/core/godot-finder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_PROJECT = resolve(__dirname, '..', 'fixtures', 'real-project');

const GODOT_PATH = process.env.GODOT_PATH || '';
const hasGodot = existsSync(GODOT_PATH);

if (!hasGodot) {
  process.stderr.write(
    `[T1-POC-SKIP] 未找到 GODOT_PATH (${GODOT_PATH}) — T1 PoC 依赖真实 Godot,将被跳过。\n`,
  );
}

// 清理 PoC 产生的临时 .tres(可能残留于上次运行)
const POC_TRES = resolve(REAL_PROJECT, 'resources', '_t1_poc.tres');
afterAll(() => {
  if (existsSync(POC_TRES)) {
    rmSync(POC_TRES, { force: true });
  }
});

// GDScript 强制 tab 缩进 —— 模板字符串里的空格会被引擎拒(Parse Error)。
// 用 \t 显式构造,避免编辑器/格式化工具把空格混入。
// 注:GDScript bool 字面量 print 输出小写 "true"/"false"(非 "True"/"False")。
const POC_SCRIPT = [
  'extends SceneTree',
  'func _initialize():',
  '\tvar C = load("res://resources/test_resource.gd")',
  '\tprint("ASSERT LOAD:", C != null)',
  '\tvar inst = C.new()',
  '\tvar props = inst.get_property_list()',
  '\tvar names = []',
  '\tfor p in props:',
  '\t\tif p.usage & PROPERTY_USAGE_SCRIPT_VARIABLE:',
  '\t\t\tnames.append(p.name)',
  '\tprint("ASSERT FIELDS:", "damage" in names and "kind" in names)',
  '\t# 枚举 hint 诊断:对比 kind(纯 int,无 hint)与 weapon_kind(@export_enum,有 hint)',
  '\tvar kind_field = null',
  '\tvar weapon_field = null',
  '\tfor p in props:',
  '\t\tif p.name == "kind": kind_field = p',
  '\t\tif p.name == "weapon_kind": weapon_field = p',
  '\tprint("ENUM_DIAG kind hint=", kind_field.hint, " hint_string=[", kind_field.hint_string, "]")',
  '\tprint("ENUM_DIAG weapon_kind hint=", weapon_field.hint, " hint_string=[", weapon_field.hint_string, "]")',
  '\t# 断言 3: @export_enum 字段的 hint_string 非空(枚举探测可行)',
  '\tprint("ASSERT ENUM_HINT:", weapon_field != null and weapon_field.hint_string != "")',
  '\tinst.kind = 2',
  '\tinst.weapon_kind = 1',
  '\tinst.damage = 15',
  '\tResourceSaver.save(inst, "res://resources/_t1_poc.tres")',
  '\tvar back = load("res://resources/_t1_poc.tres")',
  '\tprint("ASSERT SAVEBACK:", back != null and back.damage == 15 and back.kind == 2)',
  '\tquit()',
  '',
].join('\n');

describe.skipIf(!hasGodot)('T1 PoC: headless 反射链路', () => {
  it('load + 反射 + 枚举 hint + ResourceSaver 读回 全通', async () => {
    const godot = GODOT_PATH || await findGodot(REAL_PROJECT);
    const r = await executeGdscript({
      godotPath: godot,
      projectPath: REAL_PROJECT,
      code: POC_SCRIPT,
      timeout: 30,
    });
    const out = r.raw_output ?? '';
    // 诊断:失败时打印完整输出便于定位
    if (!out.includes('ASSERT LOAD:true') ||
        !out.includes('ASSERT FIELDS:true') ||
        !out.includes('ASSERT ENUM_HINT:true') ||
        !out.includes('ASSERT SAVEBACK:true')) {
      process.stderr.write(`[T1-POC-DEBUG] raw_output:\n${out}\n[T1-POC-DEBUG] success=${r.success} compile_error=${r.compile_error ?? ''}\n`);
    }
    // GDScript bool print 小写。4 断言:load/反射/@export_enum hint/ResourceSaver 读回
    expect(out).toContain('ASSERT LOAD:true');
    expect(out).toContain('ASSERT FIELDS:true');
    expect(out).toContain('ASSERT ENUM_HINT:true');
    expect(out).toContain('ASSERT SAVEBACK:true');
  }, 60000);
});
