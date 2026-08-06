import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// P2-2 回归契约:validate_scripts 必须用 SceneTree `_initialize()` 跑在带 `--path` 的 Godot 进程里,
// 让项目 autoload 在 SceneTree 上下文注册 —— 这样能校验 autoload 脚本本身,
// 也让被校验脚本的 load() 能解析对 autoload 单例的引用。
//
// 来源:tugcantopaloglu v3.1 autoload 感知模式。plan(2026-08-05)原把它误归给 validate_gdd,
// 实际 validate_gdd(game-design.ts)是纯 markdown 校验,真正落地在 validate_scripts。
//
// 参 headless-whitelist.test.ts F2 模式:读 .ts 源码做字面量断言,防回退。
const TS = readFileSync(
  join(__dirname, '..', '..', 'src', 'tools', 'validation.ts'),
  'utf-8',
);

describe('validate_scripts autoload awareness (P2-2)', () => {
  it('validator GDScript uses `extends SceneTree` + `func _initialize()`', () => {
    // batchValidateScripts 内联构造的 validator GDScript 字面量(validation.ts:199-224)
    // 必须以 SceneTree 为载体并在 _initialize() 里跑,而不是走 @tool 或 _ready()。
    expect(TS).toMatch(/'extends SceneTree'/);
    expect(TS).toMatch(/'func _initialize\(\):'/);
  });

  it('runs validator with `--headless --path <projectPath> --script <validator>`', () => {
    // 关键:`--path projectPath` 让 Godot 加载项目的 project.godot,
    // autoload 单例在 SceneTree 上下文里被实例化挂到 root 下。
    // 没 `--path` 就退化成无上下文的纯脚本 parse,失去 autoload 感知。
    expect(TS).toMatch(/'--headless'/);
    expect(TS).toMatch(/'--path'/);
    expect(TS).toMatch(/'--script'/);
  });

  it('loads each script via `load()` so autoload refs are resolved', () => {
    // 用 load() 而非 ResourceLoader.load_threaded_* 或纯文本 parse:
    // load() 在 SceneTree 上下文里走完整 ClassDB/Resource 解析,
    // 被校验脚本对 autoload 单例的引用能被解析(autoload 已挂 root)。
    expect(TS).toMatch(/var res = load\(script_path\)/);
  });

  it('emits MCP_VALIDATE_DONE lifecycle marker (not silent)', () => {
    // 完成标记防静默漏报(validation.ts:222);MCP_LOAD_NULL 兜底防 load() 返 null 静默。
    expect(TS).toMatch(/MCP_VALIDATE_DONE/);
    expect(TS).toMatch(/MCP_LOAD_NULL/);
  });
});
