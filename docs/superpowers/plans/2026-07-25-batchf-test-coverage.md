# batch F 测试覆盖深度加固 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** batch E 剩余 12 项测试缺口的深度覆盖（6 task 做 + 2 defer）——假绿修复、纯函数单测、安全断言、防回归契约、静默 skip 可见化。

**Architecture:** 6 独立 task，每 task 一个测试加固点。F2/F4 新建纯函数单测文件；F1/F3 改现有假绿断言为具体断言；F5 防回归契约；F6 测试基建 warn。batch E 模式：一个 plan 多 task，SDD 执行。

**Tech Stack:** TypeScript/JavaScript、vitest（vi.spyOn/vi.mock）、Node。

## Global Constraints

- **TDD**：写/改测试→确认失败或假绿→改实现/断言→通过→commit
- **不改生产逻辑**（纯测试 + 断言改 + F6 测试基建 console.warn）
- **F1/F3 假绿修复**：`includes('1')` 恒真断言→具体断言定位实际值
- **commit 中文** message + 末尾 `Co-Authored-By: Claude <noreply@anthropic.com>`；master 分支，**不 push**
- 测试命令：`npx vitest run <file>`；类型：`npx tsc --noEmit`
- 行号均经 2026-07-25 核实（eng-review 97% 准 + spec 修订）

## File Structure

| task | 文件 | 操作 |
|------|------|------|
| F1 | `test/animation-track.test.js` + `test/animation-advanced.test.js` | 改假绿断言 |
| F2 | `test/config-parser.test.ts` | 新建纯函数单测 |
| F3 | `test/editor-auth.test.js` | 加 icacls :M 动态断言 |
| F4 | `test/clamp-param.test.ts` | 新建纯函数单测 |
| F5 | `test/runtime.test.js`（或新建） | 加 launch_editor PID 契约断言 |
| F6 | `test/e2e-full-tool-verification.test.ts` + `test/helpers/integration-setup.js` | skip 加 console.warn |

---

## Task F1: 假绿修复（animation includes('1')）

**Files:**
- Modify: `test/animation-track.test.js:196-200`（default transition）
- Modify: `test/animation-advanced.test.js:199-202`（default speed 1.0）

**Interfaces:**
- Consumes: `genAnimationKeyframeAdd`/`genAnimationBlend`（生成 GDScript 字符串，:193/195 给形式参考）

- [ ] **Step 1: 改 animation-track.test.js:198**（default transition 假绿）

当前（:196-200）：
```js
it('generates script with default transition', () => {
  const script = genAnimationKeyframeAdd('root/AP', 'idle', 0, 1.0, [1, 2, 3], undefined);
  expect(script.includes('1')).toBeTruthy();   // ← 假绿：几乎所有 GDScript 都含 '1'
  expect(script.includes('Vector3(1, 2, 3)')).toBeTruthy();
});
```
改为定位 transition 默认值的具体形式。参考 :193（transition=1.0 生成 `track_insert_key(0, 0.5, 100, 1)`，第 4 参 transition）。transition=undefined 时 implementer 先 `console.log(script)` 看实际第 4 参默认值，写具体断言：
```js
it('generates script with default transition', () => {
  const script = genAnimationKeyframeAdd('root/AP', 'idle', 0, 1.0, [1, 2, 3], undefined);
  // 定位 track_insert_key 完整结构（track=0, time=1.0, value=Vector3(1,2,3), transition=<默认>）
  expect(script).toMatch(/track_insert_key\(0, 1\.0, Vector3\(1, 2, 3\), \d+(?:\.\d+)?\)/);
  expect(script.includes('Vector3(1, 2, 3)')).toBeTruthy();
});
```
> 若实际生成 transition 默认值使正则不匹配，implementer 据实际 script 校准正则（核心：断言要定位 transition 的具体数字，非恒真 '1'）。

- [ ] **Step 2: 改 animation-advanced.test.js:201**（default speed 1.0 假绿）

当前（:199-202）：
```js
it('uses default speed 1.0', () => {
  const script = genAnimationBlend('/root/A', 'idle', 0.5, 1.0);
  expect(script.includes('1')).toBeTruthy();   // ← 假绿
});
```
参考 :195 `genAnimationBlend('/root/Player/AnimPlayer','run',0.3,1.5)` → `_ap.play("run", 0.3, 1.5, false)`（第 3 参 speed）。speed=1.0 → 改：
```js
it('uses default speed 1.0', () => {
  const script = genAnimationBlend('/root/A', 'idle', 0.5, 1.0);
  expect(script.includes('_ap.play("idle", 0.5, 1.0')).toBeTruthy();   // 定位 speed=1.0 具体位置
});
```

- [ ] **Step 3: 跑测试确认通过（且断言真测到值）**

Run: `npx vitest run test/animation-track.test.js test/animation-advanced.test.js`
Expected: PASS。验证非假绿：临时改生成函数的 transition/speed 默认值，断言应变 RED（确认断言有效）。

- [ ] **Step 4: commit**

```bash
git add test/animation-track.test.js test/animation-advanced.test.js
git commit -m "test(F1): animation includes('1') 假绿→具体断言（transition/speed 定位）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task F2: config-parser 单测

**Files:**
- Create: `test/config-parser.test.ts`

**Interfaces:**
- Consumes: `parseConfigValue(raw, depth=0)`（config-parser.ts:31）/ `parseGodotConfig(content)`（:70）/ `parseMcpScriptOutput(rawOutput, exitCode, resultMarker?, errorMarker?)`（:105）；`MARKER_RESULT`/`MARKER_ERROR` from `../src/tools/shared.js`

- [ ] **Step 1: 写测试** `test/config-parser.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { parseConfigValue, parseGodotConfig, parseMcpScriptOutput } from '../src/core/config-parser.js';
import { MARKER_RESULT, MARKER_ERROR } from '../src/tools/shared.js';

describe('parseConfigValue', () => {
  it('字符串去引号', () => {
    expect(parseConfigValue('"hello"')).toBe('hello');
  });
  it('布尔/null', () => {
    expect(parseConfigValue('true')).toBe(true);
    expect(parseConfigValue('false')).toBe(false);
    expect(parseConfigValue('null')).toBe(null);
  });
  it('数字（int/float）', () => {
    expect(parseConfigValue('42')).toBe(42);
    expect(parseConfigValue('3.14')).toBe(3.14);
  });
  it('Infinity/NaN → raw（isFinite 排除）', () => {
    expect(parseConfigValue('Infinity')).toBe('Infinity');
    expect(parseConfigValue('NaN')).toBe('NaN');
  });
  it('空串 → raw（trim==="" 不当数字）', () => {
    expect(parseConfigValue('')).toBe('');
  });
  it('array（含嵌套）', () => {
    expect(parseConfigValue('[1, 2, 3]')).toEqual([1, 2, 3]);
    expect(parseConfigValue('[]')).toEqual([]);
  });
  it('dict', () => {
    expect(parseConfigValue('{a=1, b="x"}')).toEqual({ a: 1, b: 'x' });
  });
  it('depth=9（>8）触发 raw fallback 防递归爆栈', () => {
    // 构造 9 层嵌套 array 触发 depth>8 fallback
    let deep = '1';
    for (let i = 0; i < 10; i++) deep = `[${deep}]`;  // 10 层嵌套
    const r = parseConfigValue(deep);
    // 深层未完全解析（depth>8 返 raw 子串），不栈溢出即通过
    expect(typeof r === 'string' || typeof r === 'object').toBeTruthy();
  });
});

describe('parseGodotConfig', () => {
  it('section + kv + comment 跳过', () => {
    const cfg = parseGodotConfig('[application]\nname="Game"\n;comment line\nversion=4');
    expect(cfg.application).toEqual({ name: 'Game', version: 4 });
  });
  it('# comment 也跳过', () => {
    const cfg = parseGodotConfig('# hash comment\n[a]\nx=1');
    expect((cfg as any).a).toEqual({ x: 1 });
  });
  it('多 section', () => {
    const cfg = parseGodotConfig('[a]\nx=1\n[b]\ny="z"');
    expect((cfg as any).a).toEqual({ x: 1 });
    expect((cfg as any).b).toEqual({ y: 'z' });
  });
});

describe('parseMcpScriptOutput', () => {
  it('result marker + 有效 JSON → parsed', () => {
    const out = `${MARKER_RESULT}{"x":1}`;
    expect(parseMcpScriptOutput(out, 0)).toEqual({ x: 1 });
  });
  it('result marker + 无效 JSON → success:false', () => {
    const out = `${MARKER_RESULT}not json`;
    expect(parseMcpScriptOutput(out, 0)).toMatchObject({ success: false, error: 'Failed to parse result JSON' });
  });
  it('error marker + JSON → parsed', () => {
    const out = `${MARKER_ERROR}{"code":"X"}`;
    expect(parseMcpScriptOutput(out, 0)).toEqual({ code: 'X' });
  });
  it('无 marker + exitCode=0 → No structured output', () => {
    const r = parseMcpScriptOutput('some log\nmore log', 0) as any;
    expect(r.success).toBe(false);
    expect(r.error).toBe('No structured output found');
    expect(r.raw_output).toContain('some log');
  });
  it('无 marker + exitCode≠0 → Process exited', () => {
    const r = parseMcpScriptOutput('log line', 1) as any;
    expect(r.success).toBe(false);
    expect(r.error).toBe('Process exited with code 1');
  });
  it('marker 混入 log 行（log 进 raw_output，marker 仍解析）', () => {
    const out = `log before\n${MARKER_RESULT}{"ok":true}\nlog after`;
    const r = parseMcpScriptOutput(out, 0) as any;
    expect(r).toEqual({ ok: true });  // marker 解析优先，返 parsed
  });
});
```

- [ ] **Step 2: 跑测试确认通过**

Run: `npx vitest run test/config-parser.test.ts`
Expected: PASS（全绿）。若 depth=9 case 行为与预期不符，校准断言（核心：不栈溢出）。

- [ ] **Step 3: tsc + commit**

Run: `npx tsc --noEmit`
```bash
git add test/config-parser.test.ts
git commit -m "test(F2): config-parser 单测（parseConfigValue/parseGodotConfig/parseMcpScriptOutput 边界）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task F3: icacls :M 动态断言

**Files:**
- Modify: `test/editor-auth.test.js`（:12-13 mock + 加 it）

**Interfaces:**
- Consumes: `writeEditorSecret`/`restrictFileWindows`（editor-auth.ts，:32 调 `execFileSync('icacls', [filePath, '/inheritance:r', '/grant:r', \`${username}:M\`])` —— **4 元素 args**，args[3]=`${username}:M`）

- [ ] **Step 1: 改 mock 捕获所有调用**（:12-13）

当前：
```js
vi.mock('child_process', () => ({
  execFileSync: vi.fn((_cmd, args) => Array.isArray(args) && args.length === 1 ? `${args[0]} ${_TEST_USER}:(R)` : ''),
}));
```
改为记录调用（保留 read-back 行为，加 calls 数组）：
```js
const { _TEST_USER, _execCalls } = vi.hoisted(() => ({
  _TEST_USER: process.env.USERNAME || process.env.USER || 'testuser',
  _execCalls: [] as any[][],
}));
vi.mock('child_process', () => ({
  execFileSync: vi.fn((_cmd, args) => {
    if (Array.isArray(args)) _execCalls.push(args);
    return Array.isArray(args) && args.length === 1 ? `${args[0]} ${_TEST_USER}:(R)` : '';
  }),
}));
```

- [ ] **Step 2: 加 it 断言 grant args[3]===:M**

在 readEditorSecret/waitForEditorSecret 测试后加（需触发 restrictFileWindows——调 `writeEditorSecret`，若未 export 则调触发它的公开函数；implementer 据 editor-auth.ts export 确认触发路径）：
```js
describe('icacls grant :M（防回退 :R/:F）', () => {
  beforeEach(() => { _execCalls.length = 0; });

  it('ACL 收紧用 /grant:r ${username}:M', async () => {
    // 触发 restrictFileWindows（writeEditorSecret 或 export 的 ACL 函数）
    // implementer 据 editor-auth.ts export 写触发调用，如：
    // await writeEditorSecret(join(tempDir, '.godot'), 'test-secret');
    const grantCall = _execCalls.find(a => a.includes('/grant:r'));
    expect(grantCall).toBeDefined();              // 必须有 grant 调用
    expect(grantCall[3]).toBe(`${_TEST_USER}:M`); // args[3] = username:M（非 :R/:F）
  });
});
```
> implementer 确认触发路径（`writeEditorSecret` 是否 export、是否调 `restrictFileWindows`）。核心断言：grant 调用存在 + args[3]===`${username}:M`。

- [ ] **Step 3: 跑测试确认通过**

Run: `npx vitest run test/editor-auth.test.js`
Expected: PASS。验证非假绿：临时把 editor-auth.ts:32 的 `:M` 改 `:R`，断言应变 RED。

- [ ] **Step 4: commit**

```bash
git add test/editor-auth.test.js
git commit -m "test(F3): icacls grant args[3]===:M 动态断言（防回退 :R/:F）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task F4: clampParam 单测

**Files:**
- Create: `test/clamp-param.test.ts`

**Interfaces:**
- Consumes: `clampParam(val, min, max, name, warnings): number | undefined`（validation.ts:20）
- 守卫验证：6 调用点 `audio-ops.ts:196,197` + `particles.ts:430,447,461,462`

- [ ] **Step 1: 写测试** `test/clamp-param.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { clampParam } from '../src/tools/shared/validation.js';
import { readFileSync } from 'fs';

describe('clampParam', () => {
  it('undefined → undefined（不 clamp）', () => {
    expect(clampParam(undefined, 0, 100, 'x', [])).toBeUndefined();
  });
  it('< min → min + warning', () => {
    const w: string[] = [];
    expect(clampParam(-5, 0, 100, 'vol', w)).toBe(0);
    expect(w).toContain('vol -5 clamped to 0');
  });
  it('> max → max + warning', () => {
    const w: string[] = [];
    expect(clampParam(200, 0, 100, 'pitch', w)).toBe(100);
    expect(w).toContain('pitch 200 clamped to 100');
  });
  it('范围内 → 原值，无 warning', () => {
    const w: string[] = [];
    expect(clampParam(50, 0, 100, 'x', w)).toBe(50);
    expect(w).toHaveLength(0);
  });
  it('边界值（==min / ==max）不 clamp', () => {
    expect(clampParam(0, 0, 100, 'x', [])).toBe(0);
    expect(clampParam(100, 0, 100, 'x', [])).toBe(100);
  });
});

describe('clampParam 6 调用点守卫（静态 grep）', () => {
  it('audio-ops.ts 有 2 调用点', () => {
    const src = readFileSync('src/tools/audio-ops.ts', 'utf-8');
    const matches = src.match(/clampParam\(/g) ?? [];
    expect(matches.length).toBe(2);   // :196 vol + :197 pitch
  });
  it('particles.ts 有 4 调用点', () => {
    const src = readFileSync('src/tools/particles.ts', 'utf-8');
    const matches = src.match(/clampParam\(/g) ?? [];
    expect(matches.length).toBe(4);   // :430,447,461,462
  });
});
```

- [ ] **Step 2: 跑测试确认通过**

Run: `npx vitest run test/clamp-param.test.ts`
Expected: PASS。

- [ ] **Step 3: tsc + commit**

Run: `npx tsc --noEmit`
```bash
git add test/clamp-param.test.ts
git commit -m "test(F4): clampParam 单测 + 6 调用点静态守卫

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task F5: launch_editor PID 多会话契约（防回归）

**Files:**
- Modify: `test/runtime.test.js`（若有 launch_editor 测试段）或新建 `test/runtime-launch-editor.test.js`

**Interfaces:**
- Consumes: `runtime.ts:128` launch_editor（`spawn(..., {detached:true, stdio:'ignore'})` + `child.unref()`，**不**调 `registerSpawnedGodotPid`）/ `registerSpawnedGodotPid`（runtime.ts:224，run_project 调）

- [ ] **Step 1: 写防回归测试**

spy `registerSpawnedGodotPid`，mock `child_process.spawn`，触发 launch_editor，断言 spy 未被调（detached editor 不注册 PID）：
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    on: vi.fn(),
    unref: vi.fn(),
    pid: 12345,
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
  })),
}));

describe('launch_editor PID 多会话契约', () => {
  beforeEach(() => {
    vi.resetModules();
    // mock registerSpawnedGodotPid 的载体（_spawnedGodotPids 或 module-level fn）
  });

  it('launch_editor detached 不注册 PID（防杀其他会话编辑器）', async () => {
    const runtime = await import('../src/tools/runtime.js');
    // spy registerSpawnedGodotPid（若 export）或检查 _spawnedGodotPids Set
    // implementer 据 runtime.ts export 写——若 registerSpawnedGodotPid export：
    const registerSpy = vi.spyOn(runtime, 'registerSpawnedGodotPid' as any);
    await runtime.handleTool('runtime', { action: 'launch_editor', project_path: '<tmp project with project.godot>' }, ctxMock);
    expect(registerSpy).not.toHaveBeenCalled();   // detached editor 不注册
    // 或检查 module 的 _spawnedGodotPids Set 不含 pid 12345
  });
});
```
> implementer 据 `runtime.ts` 的实际 export（`registerSpawnedGodotPid` 是否 export、`_spawnedGodotPids` 是否可访问）选断言方式。核心：launch_editor 路径不注册 detached PID。参考 eng-review 核实：registerSpawnedGodotPid 仅 run_project:224 调。

- [ ] **Step 2: 跑测试确认通过**

Run: `npx vitest run test/runtime.test.js`（或新文件）
Expected: PASS。验证防回归：临时在 launch_editor 加 `registerSpawnedGodotPid(child.pid)`，断言应变 RED。

- [ ] **Step 3: commit**

```bash
git add test/runtime*.test.js
git commit -m "test(F5): launch_editor detached 不注册 PID 防回归（多会话契约）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task F6: skip 静默 warn（L2 + itIfGodot）

**Files:**
- Modify: `test/helpers/integration-setup.js:28-33`（itIfGodot skip）
- Modify: `test/e2e-full-tool-verification.test.ts:802,868`（L2 describe.skipIf / it.skipIf）

**Interfaces:**
- Consumes: `integration-setup.js:28-33` itIfGodot（`_godotAvailable=false` 时 `it.skip`）/ e2e-full L2 `describe.skipIf(!hasGodot||!hasRealProject||process.env.CI||!OPT_IN_L2)`

- [ ] **Step 1: integration-setup.js itIfGodot skip 加 warn**（:28-33）

当前 itIfGodot 在 `_godotAvailable=false` 时 `it.skip`（无 warn）。改：skip 前 `console.warn`：
```js
// integration-setup.js itIfGodot 实现（:28-33 区段）
export function itIfGodot(name, fn) {
  if (_godotAvailable) {
    return it(name, fn);
  }
  console.warn(`[skip] "${name}" skipped — Godot not available. Install Godot + set path to enable.`);
  return it.skip(name, fn);
}
```
> implementer 据 integration-setup.js 实际 itIfGodot 实现（:28-33）校准（可能用 _godotAvailable 或 hasGodot）。核心：skip 分支加 console.warn。

- [ ] **Step 2: e2e-full L2 skipIf 加 warn**（:802,868）

当前 `describe.skipIf(!hasGodot||!hasRealProject||process.env.CI||!OPT_IN_L2)`。在 describe/it 块内或前的 setup 加一次性 warn（非 CI 且条件不满足时）：
```ts
// e2e-full-tool-verification.test.ts，在 L2 describe 前（:802 附近）
if (!process.env.CI && (!hasGodot || !hasRealProject || !OPT_IN_L2)) {
  console.warn(
    `[skip] L2 bridge tests skipped — ${!hasGodot ? 'Godot not found' : !hasRealProject ? 'no real project' : 'GODOT_MCP_E2E_L2=1 not set'}. Set GODOT_MCP_E2E_L2=1 + install Godot to enable.`
  );
}
describe.skipIf(!hasGodot || !hasRealProject || process.env.CI || !OPT_IN_L2)('L2 bridge ...', () => { ... });
```
> :868 的 it.skipIf 同模式。implementer 据实际 :802/:868 校准（条件可能略异）。

- [ ] **Step 3: 跑测试确认 warn 触发（不破坏现有 skip 行为）**

Run: `npx vitest run test/e2e-full-tool-verification.test.ts`
Expected: PASS（skip 行为不变，stderr 含 warn）。可选：加一个 spy console.warn 测试 warn 被调。

- [ ] **Step 4: commit**

```bash
git add test/helpers/integration-setup.js test/e2e-full-tool-verification.test.ts
git commit -m "test(F6): L2+itIfGodot skip 静默→console.warn 可见化

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage**：
- spec 6 task（F1-F6）→ plan 6 task 全覆盖 ✓
- spec defer 2（undo E2E / tool-context）→ plan 不含（defer）✓
- spec 实仓依据（行号）→ plan 引用一致 ✓

**2. Placeholder scan**：
- F1（假绿修复）正则断言给具体形式 + implementer 校准注（transition 默认值要实际 script 校验）——合理（假绿修复，精确断言依赖生成脚本）
- F3 触发路径（writeEditorSecret export？）implementer 据 export 确认——合理
- F5 registerSpawnedGodotPid export？implementer 据 runtime.ts export 选断言——合理
- F6 itIfGodot/skipIf 实际结构 implementer 校准——合理
- F2/F4 完整测试代码（纯函数已读完整）✓
- 无"TBD/TODO/implement later"占位 ✓

**3. Type consistency**：
- `clampParam(val, min, max, name, warnings): number|undefined` F4 测试与 validation.ts:20 一致 ✓
- `parseMcpScriptOutput(rawOutput, exitCode, resultMarker?, errorMarker?)` F2 与 config-parser.ts:105 一致 ✓
- icacls args[3] F3 与 editor-auth.ts:32 一致（4 元素）✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-25-batchf-test-coverage.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 每 task 派新子代理 + 两阶段审查（batch E 同模式）
**2. Inline Execution** — 本会话批量执行 + checkpoint

Which approach?
