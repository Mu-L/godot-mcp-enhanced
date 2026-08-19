/**
 * 债务清理 Task 1（2026-08-18）：screenshot_capture.gd `_detect_blank_image` 采样退化回归锁。
 *
 * 根因：旧版线性采样 step=total/100，800x600 → step=4800=6x800（整除宽）→ x=i%w 恒 0，
 * 采样退化为最左单列；左列恰为均匀色（如黑边）时非空图被误报 BLANK。
 * 修复：10x10 网格分层采样（格中心，x∈{(2gx+1)w/20}）+ static func 化（纯函数，preload 直测）。
 *
 * 沿 gdscript-unit.test.ts 的 CHECK_PROJECT + executeGdscript + outputs 断言模式；
 * beforeAll 把最新 src/scripts/screenshot_capture.gd 拷进 fixture 的 src/scripts/，
 * 保证测的是当前源（fixture 的 src/ 是 .gitignore 生成物，check-gdscript.ts
 * syncCheckProjectFixture 同款拷贝，此处自包含不依赖 check:gdscript 先跑过）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeGdscript } from '../src/gdscript-executor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GODOT_PATH = process.env.GODOT_PATH || '';
const hasGodot = existsSync(GODOT_PATH);
const CHECK_PROJECT = resolve(__dirname, 'fixtures', 'gdscript-check');
const SRC_SCRIPT = resolve(__dirname, '..', 'src', 'scripts', 'screenshot_capture.gd');
const FIXTURE_SCRIPT = resolve(CHECK_PROJECT, 'src', 'scripts', 'screenshot_capture.gd');

if (!hasGodot) {
  process.stderr.write(
    `[screenshot-blank-detect-SKIP] 未找到 GODOT_PATH (${GODOT_PATH}) — 空白检测回归测试将被跳过。\n` +
    `  设置 GODOT_PATH 环境变量以启用（CI godot-matrix job 已配置）。\n`,
  );
}

/** 从 executeGdscript 结果里按 key 找 _mcp_output 收集的值 */
function out(result: { outputs: { key: string; value: string }[] }, key: string): string {
  const entry = result.outputs.find(o => o.key === key);
  if (!entry) throw new Error(`未找到 _mcp_output key="${key}"，已有 keys: ${result.outputs.map(o => o.key).join(',')}`);
  return entry.value;
}

/** preload 前导（class 级 declaration，wrapSnippet 会分到 declarationLines） */
const PRELUDE = 'const SC = preload("res://src/scripts/screenshot_capture.gd")';

describe.skipIf(!hasGodot)('screenshot_capture._detect_blank_image 采样行为（Task 1 回归锁）', () => {
  beforeAll(() => {
    // 拷最新源进 fixture（幂等覆盖；.uid 由 Godot 维持，不手改）
    mkdirSync(dirname(FIXTURE_SCRIPT), { recursive: true });
    copyFileSync(SRC_SCRIPT, FIXTURE_SCRIPT);
  });

  it('800x600 全黑 → true（均匀色判定）', async () => {
    const result = await executeGdscript({
      godotPath: GODOT_PATH,
      projectPath: CHECK_PROJECT,
      timeout: 30,
      code: [
        PRELUDE,
        'var img := Image.create(800, 600, false, Image.FORMAT_RGBA8)',
        'img.fill(Color.BLACK)',
        '_mcp_output("all_black", str(SC._detect_blank_image(img)))',
        '_mcp_done()',
      ].join('\n'),
    });
    expect(result.run_success).toBe(true);
    expect(out(result, 'all_black')).toBe('true');
  }, 30000);

  it('回归铁证： 800x600 左列(x=0)均匀黑、其余噪声 → false（旧线性算法此处误报 true）', async () => {
    // 旧算法 step=480000/100=4800=6×800 整除宽 → x=i%800 恒 0，只采最左列（本用例全黑）
    // → 100/100 uniform → 误报 true。新 10x10 网格采样 x∈{40,120,...,760} 全落噪声区 → false。
    // 480k 次 set_pixel 可能秒级，timeout 已放宽（executeGdscript 30s / vitest it 30s）。
    const result = await executeGdscript({
      godotPath: GODOT_PATH,
      projectPath: CHECK_PROJECT,
      timeout: 30,
      code: [
        PRELUDE,
        'var img := Image.create(800, 600, false, Image.FORMAT_RGBA8)',
        'img.fill(Color.BLACK)',
        'seed(42)',
        'for y in 600:',
        '\tfor x in range(1, 800):',
        '\t\timg.set_pixel(x, y, Color(randf(), randf(), randf()))',
        '_mcp_output("regression", str(SC._detect_blank_image(img)))',
        '_mcp_done()',
      ].join('\n'),
    });
    expect(result.run_success).toBe(true);
    expect(out(result, 'regression')).toBe('false');
  }, 30000);

  it('800x600 纯噪声 → false', async () => {
    const result = await executeGdscript({
      godotPath: GODOT_PATH,
      projectPath: CHECK_PROJECT,
      timeout: 30,
      code: [
        PRELUDE,
        'var img := Image.create(800, 600, false, Image.FORMAT_RGBA8)',
        'seed(42)',
        'for y in 600:',
        '\tfor x in 800:',
        '\t\timg.set_pixel(x, y, Color(randf(), randf(), randf()))',
        '_mcp_output("noise", str(SC._detect_blank_image(img)))',
        '_mcp_done()',
      ].join('\n'),
    });
    expect(result.run_success).toBe(true);
    expect(out(result, 'noise')).toBe('false');
  }, 30000);

  it('1x1 退化尺寸 → true', async () => {
    const result = await executeGdscript({
      godotPath: GODOT_PATH,
      projectPath: CHECK_PROJECT,
      timeout: 30,
      code: [
        PRELUDE,
        'var img := Image.create(1, 1, false, Image.FORMAT_RGBA8)',
        'img.fill(Color(0.5, 0.5, 0.5))',
        '_mcp_output("tiny", str(SC._detect_blank_image(img)))',
        '_mcp_done()',
      ].join('\n'),
    });
    expect(result.run_success).toBe(true);
    expect(out(result, 'tiny')).toBe('true');
  }, 30000);
});
