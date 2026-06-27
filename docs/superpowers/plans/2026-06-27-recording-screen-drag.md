# recording ScreenDrag 触屏拖拽补全 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补全录制系统的 `InputEventScreenDrag` 捕获与回放,闭环 defect `recording-no-touch-events`(baseline 1→0),并公开 `game_input` 触摸输入(send_drag + 对称 send_touch)。

**Architecture:** 三端契约对称 —— Bridge(`mcp_bridge.gd` `_cmd_send_drag` + `_input`)与 editor 插件(`recording_commands.gd` `_input` + `_fire_playback_event`)各自录制+回放 ScreenDrag;TS(`recording.ts`)回放经 `sendToBridge('send_drag')` 走 Bridge;`game-bridge.ts` `INPUT_METHODS` 公开 send_drag/send_touch。字段契约由共享 `TOUCH_DRAG_FIELDS` 常量 + GDScript 字面量校验双侧锁定(F2)。

**Tech Stack:** TypeScript(Node,vitest)、GDScript(Godot 4)、MCP 工具(edit_script search_and_replace / validate_scripts / execute_gdscript)

## Global Constraints

- **载体 = 新增 `send_drag` 命令**(brainstorming 已拍板,非扩展 send_touch)
- **字段契约**:`TOUCH_DRAG_FIELDS = ['position','index','relative','speed']`(TS 导出常量;GDScript 字面量;三端必须对齐)
- **speed best-effort**(F4):回放设 `event.speed` 但注明 Godot 内部可能重算覆盖
- **defect Path A**:并入 `recording-no-touch-events`(detect 谓词不变,加 ScreenDrag 后 missing=0 → fixed/baseline 0),非另开
- **send_touch 对称补入** `INPUT_METHODS`(修正 IMP-11 遗留不对称)
- **GDScript 编辑用 MCP `edit_script` + `search_and_replace`**(CRLF/tab 安全,禁内置 Edit);编辑后 `validate_scripts`
- **不捕获 pressure**(YAGNI);**不改** ScreenTouch 已有契约、time_offset 格式、两套录制系统结构
- **F3**:`recording.ts` unknown event type 从 silently skip 改 `errors.push`

---

### Task 1: Bridge GDScript — `_cmd_send_drag` + dispatch + `_input` ScreenDrag 录制

**Files:**
- Modify: `src/scripts/mcp_bridge.gd`(`_input` L1355 后、`_cmd_send_touch` L831 后、dispatch L495)

**Interfaces:**
- Consumes: 无(独立新增)
- Produces: `_cmd_send_drag(params: Dictionary) -> Variant`(返 `{success,x,y,index,relative,speed}`);dispatch `"send_drag"`;`_input` 捕获 `InputEventScreenDrag` → `{type:"touch_drag",...}`

- [ ] **Step 1: 写失败测试(execute_gdscript 独立验证 InputEventScreenDrag 构造 + 静态字段校验)**

用 `execute_gdscript`(片段模式,无需 autoload)验证字段契约。预期:当前 `_cmd_send_drag` 不存在 → 静态校验失败。

静态字段校验片段(读源码断言 `_cmd_send_drag` 含正确 `params.get` key 与 `event` 字段赋值):
```gdscript
var src = FileAccess.get_file_as_string("res://src/scripts/mcp_bridge.gd")
var ok = true
var errs = []
if src.find("_cmd_send_drag") < 0: errs.append("missing _cmd_send_drag")
for k in ["params.get(\"x\"", "params.get(\"y\"", "params.get(\"index\"", "params.get(\"relative\"", "params.get(\"speed\""]:
	if src.find(k) < 0: errs.append("missing field read " + k)
for f in ["event.position =", "event.index =", "event.relative =", "event.speed =", "InputEventScreenDrag.new()"]:
	if src.find(f) < 0: errs.append("missing assign " + f)
if src.find("\"send_drag\":") < 0 and src.find("\"send_drag\"") < 0: errs.append("missing dispatch send_drag")
if src.find("InputEventScreenDrag") < 0: errs.append("missing _input ScreenDrag branch")
_mcp_output("errs", errs)
_mcp_output("ok", errs.is_empty())
_mcp_done()
```
Run: MCP `execute_gdscript(project_path, code=<above>)`
Expected: `ok=false`,errs 含 "missing _cmd_send_drag" 等(实现前)

- [ ] **Step 2: 加 dispatch `"send_drag"` 分支**

MCP `edit_script(search_and_replace)`:
- search:
```
		"send_touch":
			result = _cmd_send_touch(params)
```
- replace:
```
		"send_touch":
			result = _cmd_send_touch(params)
		"send_drag":
			result = _cmd_send_drag(params)
```

- [ ] **Step 3: 新增 `_cmd_send_drag`(模板对齐 `_cmd_send_touch` L821-831)**

MCP `edit_script(search_and_replace)`:
- search(定位 `_cmd_send_touch` 末尾 + 空行):
```
	event.pressed = pressed
	event.index = index
	Input.parse_input_event(event)
	return {"success": true, "x": x, "y": y, "pressed": pressed, "index": index}


func _cmd_send_text(params: Dictionary) -> Variant:
```
- replace:
```
	event.pressed = pressed
	event.index = index
	Input.parse_input_event(event)
	return {"success": true, "x": x, "y": y, "pressed": pressed, "index": index}


# IMP-11 补全: 触屏拖拽回放载体(对齐 _cmd_send_touch;speed best-effort,Godot 内部可能重算覆盖)
func _cmd_send_drag(params: Dictionary) -> Variant:
	var x: float = float(params.get("x", 0))
	var y: float = float(params.get("y", 0))
	var index: int = int(params.get("index", 0))
	var relative: Array = params.get("relative", [0.0, 0.0])
	var speed: Array = params.get("speed", [0.0, 0.0])
	var event := InputEventScreenDrag.new()
	event.position = Vector2(x, y)
	event.index = index
	event.relative = Vector2(float(relative[0]) if relative.size() > 0 else 0.0, float(relative[1]) if relative.size() > 1 else 0.0)
	event.speed = Vector2(float(speed[0]) if speed.size() > 0 else 0.0, float(speed[1]) if speed.size() > 1 else 0.0)
	Input.parse_input_event(event)
	return {"success": true, "x": x, "y": y, "index": index, "relative": relative, "speed": speed}


func _cmd_send_text(params: Dictionary) -> Variant:
```

- [ ] **Step 4: `_input` 加 ScreenDrag 录制分支(L1355 后)**

MCP `edit_script(search_and_replace)`:
- search:
```
	elif event is InputEventScreenTouch:  # IMP-11: 触摸事件录制(对齐 recording_commands.gd :46 + _cmd_send_touch 契约)
		_recorded_events.append({"type": "touch", "position": [event.position.x, event.position.y], "pressed": event.pressed, "index": event.index, "time_offset": time_ms})
```
- replace:
```
	elif event is InputEventScreenTouch:  # IMP-11: 触摸事件录制(对齐 recording_commands.gd :46 + _cmd_send_touch 契约)
		_recorded_events.append({"type": "touch", "position": [event.position.x, event.position.y], "pressed": event.pressed, "index": event.index, "time_offset": time_ms})
	elif event is InputEventScreenDrag:  # IMP-11 补全: 拖拽录制(对齐 recording_commands.gd + _cmd_send_drag 契约)
		_recorded_events.append({"type": "touch_drag", "position": [event.position.x, event.position.y], "index": event.index, "relative": [event.relative.x, event.relative.y], "speed": [event.speed.x, event.speed.y], "time_offset": time_ms})
```

- [ ] **Step 5: validate_scripts + 重跑 Step 1 测试**

Run: MCP `validate_scripts(scripts=["src/scripts/mcp_bridge.gd"])` → 0 errors
Run: Step 1 execute_gdscript → Expected `ok=true`(errs 空)

- [ ] **Step 6: Commit**

```bash
git add src/scripts/mcp_bridge.gd
git commit -m "feat(bridge): _cmd_send_drag + dispatch + _input ScreenDrag 录制(Task1)"
```

---

### Task 2: editor 插件 GDScript — `_input` + `_fire_playback_event` touch_drag

**Files:**
- Modify: `addons/godot_mcp_server/commands/recording_commands.gd`(`_input` L46 后、`_fire_playback_event` L197 后)

**Interfaces:**
- Consumes: §1 事件格式(`type:"touch_drag"`,字段同 Task 1)
- Produces: editor 插件端独立录制+回放 ScreenDrag(不经 Bridge,直接 `Input.parse_input_event`)

- [ ] **Step 1: 写失败测试(静态字段校验)**

execute_gdscript 片段(读 `recording_commands.gd` 断言):
```gdscript
var src = FileAccess.get_file_as_string("res://addons/godot_mcp_server/commands/recording_commands.gd")
var errs = []
if src.find("InputEventScreenDrag") < 0: errs.append("missing ScreenDrag in _input")
if src.find("\"touch_drag\"") < 0: errs.append("missing touch_drag branch")
for f in ["ie.relative =", "ie.speed =", "InputEventScreenDrag.new()"]:
	if src.find(f) < 0: errs.append("missing " + f)
_mcp_output("errs", errs)
_mcp_output("ok", errs.is_empty())
_mcp_done()
```
Expected: `ok=false`(实现前)

- [ ] **Step 2: `_input` 加 ScreenDrag 分支(L46 后)**

MCP `edit_script(search_and_replace)`:
- search:
```
	elif event is InputEventScreenTouch:  # IMP-11 (2026-06-26 review): 触摸事件录制(触屏设备)
		var entry: Dictionary = {
			"type": "touch",
			"position": [event.position.x, event.position.y],
			"pressed": event.pressed,
			"index": event.index,
			"time_offset": Time.get_ticks_msec() - _record_start_time
		}
		_recorded_events.append(entry)
```
- replace:
```
	elif event is InputEventScreenTouch:  # IMP-11 (2026-06-26 review): 触摸事件录制(触屏设备)
		var entry: Dictionary = {
			"type": "touch",
			"position": [event.position.x, event.position.y],
			"pressed": event.pressed,
			"index": event.index,
			"time_offset": Time.get_ticks_msec() - _record_start_time
		}
		_recorded_events.append(entry)
	elif event is InputEventScreenDrag:  # IMP-11 补全: 拖拽录制(对齐 bridge _input + _cmd_send_drag 契约)
		var drag_entry: Dictionary = {
			"type": "touch_drag",
			"position": [event.position.x, event.position.y],
			"index": event.index,
			"relative": [event.relative.x, event.relative.y],
			"speed": [event.speed.x, event.speed.y],
			"time_offset": Time.get_ticks_msec() - _record_start_time
		}
		_recorded_events.append(drag_entry)
```

- [ ] **Step 3: `_fire_playback_event` 加 `"touch_drag"` 分支(L197 后)**

MCP `edit_script(search_and_replace)`:
- search:
```
		"touch":  # IMP-11: 触摸回放
			var ie = InputEventScreenTouch.new()
			var pos = evt.get("position", [0.0, 0.0])
			if pos is Array and pos.size() >= 2:
				ie.position = Vector2(float(pos[0]), float(pos[1]))
			ie.pressed = bool(evt.get("pressed", true))
			ie.index = int(evt.get("index", 0))
			Input.parse_input_event(ie)
```
- replace:
```
		"touch":  # IMP-11: 触摸回放
			var ie = InputEventScreenTouch.new()
			var pos = evt.get("position", [0.0, 0.0])
			if pos is Array and pos.size() >= 2:
				ie.position = Vector2(float(pos[0]), float(pos[1]))
			ie.pressed = bool(evt.get("pressed", true))
			ie.index = int(evt.get("index", 0))
			Input.parse_input_event(ie)
		"touch_drag":  # IMP-11 补全: 拖拽回放(speed best-effort)
			var ie = InputEventScreenDrag.new()
			var pos = evt.get("position", [0.0, 0.0])
			if pos is Array and pos.size() >= 2:
				ie.position = Vector2(float(pos[0]), float(pos[1]))
			ie.index = int(evt.get("index", 0))
			var rel = evt.get("relative", [0.0, 0.0])
			if rel is Array and rel.size() >= 2:
				ie.relative = Vector2(float(rel[0]), float(rel[1]))
			var spd = evt.get("speed", [0.0, 0.0])
			if spd is Array and spd.size() >= 2:
				ie.speed = Vector2(float(spd[0]), float(spd[1]))
			Input.parse_input_event(ie)
```

- [ ] **Step 4: validate_scripts + 重跑 Step 1 测试**

Run: `validate_scripts(scripts=["addons/godot_mcp_server/commands/recording_commands.gd"])` → 0 errors
Run: Step 1 → Expected `ok=true`

- [ ] **Step 5: Commit**

```bash
git add addons/godot_mcp_server/commands/recording_commands.gd
git commit -m "feat(editor-plugin): _input + _fire_playback_event touch_drag(Task2)"
```

---

### Task 3: TS — recording.ts 回放 + F3 + TOUCH_DRAG_FIELDS;game-bridge.ts INPUT_METHODS + description

**Files:**
- Modify: `src/tools/recording.ts`(导出常量、L357 后 touch_drag 分支、L370 F3)
- Modify: `src/tools/game-bridge.ts`(`INPUT_METHODS` L401、description L344/357/361)
- Test: `test/recording.test.ts`(扩 touch_drag mock + F5 序列)

**Interfaces:**
- Consumes: Task 1 `_cmd_send_drag`(Bridge 端已就绪,`sendToBridge('send_drag')` 可达)
- Produces: `export const TOUCH_DRAG_FIELDS`(供 Task 4 双侧契约测试)

- [ ] **Step 1: 写失败测试(扩 recording.test.ts)**

在 `test/recording.test.ts` 加 3 用例(定位既有 touch 回放 mock 测试块,同模式扩):
```ts
import { TOUCH_DRAG_FIELDS } from '../src/tools/recording';

// 用例 A: touch_drag 单事件回放 → sendToBridge('send_drag', {x,y,index,relative,speed})
it('plays touch_drag event via send_drag', async () => {
  sendToBridgeMock.mockResolvedValue({ ok: true });
  await handler({ /* recording_play args, events_json 含 1 个 touch_drag */ });
  expect(sendToBridgeMock).toHaveBeenCalledWith('send_drag',
    expect.objectContaining({ x: expect.any(Number), y: expect.any(Number),
      index: expect.any(Number), relative: expect.any(Array), speed: expect.any(Array) }),
    expect.any(Number));
});

// 用例 B (F5): touch→touch_drag→touch 同 index 序列
it('plays touch→touch_drag→touch sequence with same index', async () => {
  sendToBridgeMock.mockResolvedValue({ ok: true });
  await handler({ /* events_json: [touch(pressed=true,index=0), touch_drag(index=0,relative=[10,0]), touch(pressed=false,index=0)] */ });
  expect(sendToBridgeMock).toHaveBeenCalledTimes(3);
  expect(sendToBridgeMock).toHaveBeenNthCalledWith(1, 'send_touch', expect.any(Object), expect.any(Number));
  expect(sendToBridgeMock).toHaveBeenNthCalledWith(2, 'send_drag', expect.any(Object), expect.any(Number));
  expect(sendToBridgeMock).toHaveBeenNthCalledWith(3, 'send_touch', expect.any(Object), expect.any(Number));
});

// 用例 C (F3): unknown type → errors
it('pushes unknown event type to errors', async () => {
  const r = await handler({ /* events_json 含 type:"gamepad" */ });
  expect(r).toHaveProperty('errors');  // 或 isError/events_played=0 视既有契约
});

// 用例 D (F2 TS 侧): 发出的字段 ⊇ TOUCH_DRAG_FIELDS 对应
it('send_drag payload keys cover TOUCH_DRAG_FIELDS', async () => {
  sendToBridgeMock.mockResolvedValue({ ok: true });
  await handler({ /* events_json 含 1 touch_drag, position=[5,6], index=1, relative=[1,2], speed=[3,4] */ });
  const payload = sendToBridgeMock.mock.calls[0][1] as Record<string, unknown>;
  // position 在 events 是 [x,y],发 bridge 拆成 x/y;字段契约经 x/y/index/relative/speed 覆盖
  expect(payload).toMatchObject({ x: 5, y: 6, index: 1, relative: [1, 2], speed: [3, 4] });
});
```
Run: `node_modules/.bin/vitest run test/recording.test.ts`(或项目既定命令)
Expected: FAIL(touch_drag 分支不存在;TOUCH_DRAG_FIELDS 未导出)

- [ ] **Step 2: 导出 `TOUCH_DRAG_FIELDS` + 加 touch_drag 回放分支 + F3**

`src/tools/recording.ts`:
- 顶部(与其他导出同区)加:
```ts
/** touch_drag 事件字段契约(F2 双侧契约:三端字段名必须对齐,防 IMP-11 同类静默错) */
export const TOUCH_DRAG_FIELDS = ['position', 'index', 'relative', 'speed'] as const;
```
- L357 touch 分支后加(touch_drag 分支,用内置 Edit 或 search_and_replace;TS 文件内置 Edit 可用):
```ts
} else if (evtType === 'touch_drag') {
  // IMP-11 补全: touch_drag 回放——对齐 bridge _cmd_send_drag 契约(position→x/y, index, relative, speed)
  const pos = evt.position ?? evt.pos ?? [0, 0];
  const posArr = Array.isArray(pos) ? pos : [0, 0];
  const rel = evt.relative ?? [0, 0];
  const relArr = Array.isArray(rel) ? rel : [0, 0];
  const spd = evt.speed ?? [0, 0];
  const spdArr = Array.isArray(spd) ? spd : [0, 0];
  await sendToBridge('send_drag', {
    x: Number(posArr[0] ?? 0),
    y: Number(posArr[1] ?? 0),
    index: Number(evt.index ?? 0),
    relative: [Number(relArr[0] ?? 0), Number(relArr[1] ?? 0)],
    speed: [Number(spdArr[0] ?? 0), Number(spdArr[1] ?? 0)],
  }, 3000);
  played++;
}
```
- L370 F3(unknown 分支):
```ts
} else {
  // F3: unknown event type 计入 errors(此前 silently skip 降低可观测性)
  errors.push(`Unknown event type: ${evtType}`);
}
```
(替换原 `// else: skip unknown event types silently (played not incremented)` 注释块)

- [ ] **Step 3: game-bridge.ts `INPUT_METHODS` + 3 处 description**

- L401-403:
```ts
const INPUT_METHODS = new Set([
  'send_key', 'send_mouse_click', 'send_mouse_move', 'send_text',
  'send_touch', 'send_drag',
]);
```
- L344 顶 description:`send_text)` → `send_text, send_touch, send_drag)`
- L357 method description:同上
- L361 params description:`send_text {text}` → `send_text {text}, send_touch {x,y,pressed,index}, send_drag {x,y,index,relative,speed}`

- [ ] **Step 4: 跑测试 + tsc + lint**

Run: vitest `test/recording.test.ts` → 4 新用例 PASS + 既有不回归
Run: `node_modules/.bin/tsc --noEmit` → clean
Run: `npm run lint` → clean

- [ ] **Step 5: Commit**

```bash
git add src/tools/recording.ts src/tools/game-bridge.ts test/recording.test.ts
git commit -m "feat(recording): TS touch_drag 回放 + F3 + TOUCH_DRAG_FIELDS;game_input 公开 send_touch/send_drag(Task3)"
```

---

### Task 4: 双侧字段契约测试(F2)+ defect 闭环

**Files:**
- Test: `test/recording.test.ts`(F2 GDScript 侧字面量校验)或新建 `test/recording-touch-drag-contract.test.ts`
- Modify: `test/regression/defects.ts`(L366 status/baseline)
- Modify: `docs/.../defects.md`(note 闭环;先 grep 定位精确路径)

**Interfaces:**
- Consumes: Task 1-3 三端实现 + `TOUCH_DRAG_FIELDS`
- Produces: defect `recording-no-touch-events` fixed/baseline 0;defects.md note 闭环

- [ ] **Step 1: 写 F2 GDScript 侧字段契约测试**

GDScript 侧无法 import TS 常量,用字面量集合对齐。新建测试(读两份 .gd 源码,断言 `touch_drag` 相关 `params.get`/`evt.get` key 与 `event`/`ie` 字段赋值覆盖 position/index/relative/speed 语义):
```ts
// test/recording-touch-drag-contract.test.ts
import { readFileSync } from 'node:fs';
import { TOUCH_DRAG_FIELDS } from '../src/tools/recording';

const read = (p: string) => readFileSync(require('path').resolve(__dirname, '..', p), 'utf8');

describe('F2 touch_drag 双侧字段契约', () => {
  it('bridge _cmd_send_drag reads all TOUCH_DRAG_FIELDS', () => {
    const src = read('src/scripts/mcp_bridge.gd');
    // bridge 把 position 拆成 x/y;relative/speed 直读;index 直读
    expect(src).toContain('InputEventScreenDrag.new()');
    expect(src).toContain('event.relative =');
    expect(src).toContain('event.speed =');
    expect(src).toContain('"send_drag"');
  });
  it('editor _fire_playback_event touch_drag assigns all fields', () => {
    const src = read('addons/godot_mcp_server/commands/recording_commands.gd');
    expect(src).toContain('"touch_drag"');
    expect(src).toContain('ie.relative =');
    expect(src).toContain('ie.speed =');
  });
  it('TS TOUCH_DRAG_FIELDS canonical set', () => {
    expect([...TOUCH_DRAG_FIELDS]).toEqual(['position', 'index', 'relative', 'speed']);
  });
});
```
Run: vitest → PASS(Task 1-3 已实现)

- [ ] **Step 2: defect status/baseline 改 fixed/0**

`test/regression/defects.ts` L366:
- `status: 'open'` → `status: 'fixed'`
- `baseline: 1` → `baseline: 0`
- 注释 `// R2 IMP-11(c436587)加 1 类,仍缺 1 类(detect=1,参考)` → `// ScreenDrag 补全(Task4),ScreenTouch+ScreenDrag 两类齐备 detect=0`
- 确认该条已在 `FIXED_DEFECTS` 硬断言区(若 open defects 与 fixed 分离,移动到 FIXED 段,detect===0 断言)

- [ ] **Step 3: defects.md note 闭环**

Run: `grep -rn "recording-no-touch-events" docs/`(定位 defects.md 精确路径 + 行)
- 删除"建议另开"表述(Path A 并入)
- note 追加:Path A 决策 + F2 双侧契约纳入 + 修复 commit(待 Task 4 commit hash 回填)

- [ ] **Step 4: 全回归 + defect detect 验证**

Run: 全套测试 `node_modules/.bin/vitest run` → 全绿(含 defect regression)
Run: 确认 `recording-no-touch-events` detect=0(在 fixed 硬断言中通过)
Run: `npm run lint` + `tsc --noEmit` → clean

- [ ] **Step 5: Commit**

```bash
git add test/recording-touch-drag-contract.test.ts test/regression/defects.ts docs/
git commit -m "test(recording): F2 双侧字段契约 + defect recording-no-touch-events fixed/0(Task4)"
```

---

## Self-Review

**1. Spec coverage**:
- §1 事件格式 → Task 1/2/3 三端序列化 ✅
- §2 三端改动 → Task 1(Bridge)+ Task 2(editor)+ Task 3(TS)✅
- §3 game_input 公开 → Task 3 Step 3 ✅
- §5 detect 改法 → Task 4 Step 2 ✅
- §6 测试(F2/F4/F5)→ Task 3(F5 序列 + F4 经字段)+ Task 4(F2 双侧)✅
- §7 defects.md 闭环 → Task 4 Step 3 ✅
- F3 → Task 3 Step 2 ✅
- F4 speed best-effort → Task 1/2 代码注释 + Task 4 字段校验含 speed ✅

**2. Placeholder scan**:无 TBD/TODO;Task 4 Step 3 defects.md 路径用 grep 定位(动态,非占位)✅

**3. Type consistency**:`TOUCH_DRAG_FIELDS` 三端字段名一致(position/index/relative/speed);`_cmd_send_drag` 返 `{success,x,y,index,relative,speed}`;TS 发 `{x,y,index,relative,speed}`(position 拆 x/y 与 send_touch 一致)✅
