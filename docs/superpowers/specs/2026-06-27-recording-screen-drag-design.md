# recording ScreenDrag 触屏拖拽事件补全 (recording-no-touch-events)

**日期**: 2026-06-27
**分支**: feat/recording-screen-drag
**状态**: 待用户 review → writing-plans
**来源**: superpowers:brainstorming(载体决策已拍板:新增 send_drag 命令)+ plan-eng-review 修订
**对应 defect**: `recording-no-touch-events`(OPEN, baseline 1, severity IMPORTANT, dimension Completeness)

## 修订记录

- **v1**(初版):brainstorming 产出(载体 = 新增 send_drag 命令)
- **v1.1**(plan-eng-review 响应,本次):纳入 F2 双侧字段契约测试(硬要求)+ F3 unknown→errors + F4 speed best-effort + F5 同 index 序列用例 + defects.md 闭环。审查 artifact:`D:\workspace\review\.claude\reviews\2026-06-27-recording-screen-drag-plan-eng-review.md`

## 背景

IMP-11(R2 c436587,2026-06-27)给录制系统补了 `InputEventScreenTouch`(单点触摸 down/up),但**漏了 `InputEventScreenDrag`**(拖拽/滑动)。触屏上"按住滑动"产生的是 ScreenDrag 事件流(含 `relative` 相对位移),与 ScreenTouch(down/up 离散)是两个独立事件类 —— 当前录制系统完全不捕获拖拽,回放也无载体。

**defect detect**(`test/regression/defects.ts:366`):计数 `recording_commands.gd` 缺失的触屏事件类型数(期望 ScreenTouch + ScreenDrag 共 2 类),baseline 1(缺 ScreenDrag)。detect 语义为计数实现(`missing++`,非二元命中),已实测确认。

**现状(三端契约)**:

| 端 | ScreenTouch 录制 | ScreenTouch 回放 | ScreenDrag |
|---|---|---|---|
| editor 插件 `addons/.../recording_commands.gd` | `_input` L46 ✅ | `_fire_playback_event` L197 ✅ | ❌ |
| Bridge `src/scripts/mcp_bridge.gd` | `_input` L1355 ✅ | `_cmd_send_touch` L821(dispatch L495)✅ | ❌ |
| TS `src/tools/recording.ts` | — | L357 `sendToBridge('send_touch')` ✅ | ❌ |

**已确认的不对称**:`send_touch` 不在 `game-bridge.ts` `INPUT_METHODS`(L401-403,仅 send_key/click/move/text),即它是**回放内部用的 Bridge 命令**,用户不能直接 `game_input(method='send_touch')`(IMP-11 遗留)。`send_drag` 需明确归属。

**跨库治理债**:`defects.ts:366`(项目测试权威)= open/baseline1,而 `defects.md:503` 标 fixed + "建议另开"(defects.md:804 自承已知债)。本 PR Path A 并入 `recording-no-touch-events`,实现后同步 defects.md 删"建议另开"(见 §7)。

## 目标

1. 录制系统捕获 `InputEventScreenDrag`(三端:`recording_commands.gd` + `mcp_bridge.gd` `_input`),序列化为 `type:"touch_drag"`
2. 回放系统还原 drag 事件(editor 插件 `_fire_playback_event` 加分支 + Bridge `_cmd_send_drag` 载体 + TS `recording.ts` 加分支)
3. `game_input` 公开 `send_drag` 输入能力(入 `INPUT_METHODS`),并**对称补入 `send_touch`**(修正 IMP-11 遗留不对称)
4. defect detect baseline 1→0,status open→fixed;同步 defects.md 闭环
5. **双侧字段契约测试**(F2):TS↔GDScript↔editor 三端 `touch_drag` 字段名一致,防静默错

## 非目标 (YAGNI)

- **不**捕获 `pressure`(ScreenDrag 有 pressure 字段,但录制/回放场景不需要压感,带 position/index/relative/speed 够)
- **不**做多点触控编排(单指拖拽 `index` 字段已支持多指区分,但不做"多指手势合成")
- **不**改 ScreenTouch 已有契约(position/pressed/index 不变)
- **不**改 editor 插件/Bridge 两套录制系统的整体结构(只在各自 `_input` + 回放加 drag 分支)

## 设计

### §1 事件格式与字段契约

`InputEventScreenDrag`(Godot 4)属性:`position`(Vector2)、`index`(int,多指索引)、`relative`(Vector2,相对上一帧位移)、`speed`(Vector2)、`pressure`(float,YAGNI 不带)。

**录制序列化**(三端一致):
```json
{ "type": "touch_drag", "position": [x, y], "index": 0, "relative": [dx, dy], "speed": [sx, sy], "time_offset": 123 }
```

**对齐已有 `touch` 格式**(`{type:"touch", position, pressed, index, time_offset}`):drag 多 `relative`/`speed`,无 `pressed`(drag 无 down/up 语义)。

**字段契约常量**(F2 双侧契约):TS 侧导出共享字段名集合,GDScript 侧用字面量(autoload 无法 import TS),测试用 TS 常量 + GDScript 源码字面量校验对齐(见 §6):
```ts
export const TOUCH_DRAG_FIELDS = ['position', 'index', 'relative', 'speed'] as const;
```

**speed best-effort**(F4):`InputEventScreenDrag.speed` 由 Godot 内部基于 relative/time 计算,回放时手动设置可能被引擎覆盖或忽略。录制端完整捕获(从 `event.speed` 读),回放端 best-effort 设置(`event.speed = Vector2(...)`),spec/代码注释注明"speed 回放为 best-effort,引擎可能重算"。

### §2 三端改动

**editor 插件 `recording_commands.gd`**:
- `_input`(L46 ScreenTouch 分支后)加 `elif event is InputEventScreenDrag:` → append `{type:"touch_drag", position:[x,y], index, relative:[rel.x,rel.y], speed:[spd.x,spd.y], time_offset}`
- `_fire_playback_event`(L197 "touch" 分支后)加 `"touch_drag":` match 分支 → 构造 `InputEventScreenDrag`(position/index/relative/speed)+ `Input.parse_input_event`

**Bridge `mcp_bridge.gd`**:
- `_input`(L1355 ScreenTouch 分支后)加 `elif event is InputEventScreenDrag:` → 同 §1 格式 append
- 新增 `_cmd_send_drag(params)`(模板对齐 `_cmd_send_touch` L821):读 x/y/index/relative/speed → `InputEventScreenDrag` + `parse_input_event` → 返回 `{success, x, y, index, relative, speed}`
- dispatch(L495 `"send_touch"` 旁)加 `"send_drag": result = _cmd_send_drag(params)`

**TS `recording.ts`**:
- 回放循环(L357 "touch" 分支后)加 `else if (evtType === 'touch_drag')` → `sendToBridge('send_drag', { x, y, index, relative:[dx,dy], speed:[sx,sy] }, 3000)`
- **F3**:L370 `// else: skip unknown event types silently` 改为 `errors.push(\`Unknown event type: ${evtType}\`)`(既有静默 skip 顺带修,提升回放可观测性;`played` 不增,保持原有"未知不计入已播放"语义)

### §3 game_input 公开(对称修正)

`game-bridge.ts` `INPUT_METHODS`(L401-403)加 `'send_drag'` + `'send_touch'`(后者修正 IMP-11 遗留不对称)。

**3 处 description 同步**(Q2 决策落地):
- L344 工具顶 description:`game_input (send_key, send_mouse_click, send_mouse_move, send_text)` → 加 `send_touch, send_drag`
- L357 method description:同上加 `send_touch, send_drag`
- L361 params description:加 `send_touch {x,y,pressed,index}, send_drag {x,y,index,relative,speed}`

### §4 数据流

**录制**(触屏设备产生 InputEventScreenDrag):
- editor:`_input` → `type:"touch_drag"` 入 `_recorded_events` → `recording_stop` 返 events_json
- bridge:同上(`_recorded_events`)

**回放**(两套系统):
- editor 插件:`recording_play` → `_fire_playback_event("touch_drag")` → 构造 `InputEventScreenDrag` → `parse_input_event`
- Bridge:TS `recording_play` → `sendToBridge('send_drag')` → `_cmd_send_drag` → `InputEventScreenDrag` → `parse_input_event`

**直接输入**(game_input 公开后):
- `game_input(method='send_drag', params={x,y,index,relative,speed})` → `INPUT_METHODS` 校验 → `_cmd_send_drag`

### §5 detect 改法

`defects.ts:366` 保持查 `recording_commands.gd` 含 `InputEventScreenTouch` + `InputEventScreenDrag`(detect=0 即两类齐备)。`status:'open'→'fixed'`、`baseline:1→0`,移 `FIXED_DEFECTS` 硬断言 `detect===0`(防回归)。detect 谓词本身不变(已精确:计数两个类名)。

### §6 测试

- **F2 双侧字段契约测试(硬要求)**:
  - TS 侧导出 `TOUCH_DRAG_FIELDS = ['position','index','relative','speed']`
  - TS 单测:mock `sendToBridge`,回放 `touch_drag` 事件 → 断言 `sendToBridge('send_drag', {...})` 的参数 key 集合 ⊇ TOUCH_DRAG_FIELDS
  - GDScript 字面量校验:execute_gdscript 读 `_cmd_send_drag` 构造的 `InputEventScreenDrag`(或静态读源码断言 `params.get` 的 key + `event.position/index/relative/speed` 赋值),断言字段名集合 === TOUCH_DRAG_FIELDS
  - editor 插件 `_fire_playback_event` "touch_drag" 分支同理静态校验 `evt.get` key 集合
  - **目的**:三端字段名漂移 → 测试红(防 IMP-11 同类静默错)
- **F5 同 index 序列用例**:回放 `touch(pressed=true,index=0) → touch_drag(index=0,relative=[10,0]) → touch(pressed=false,index=0)` 三事件序列 → 断言三次 `sendToBridge` 按序调用(send_touch/send_drag/send_touch)+ 同 index + events_played=3
- **F4 speed 读回验证**:`_cmd_send_drag` 单测断言返回值含 `speed` 字段(静态读源码断言含 `event.speed =` 赋值 + best-effort 注释;运行时 Bridge 不可得时降级静态)
- **TS 回放 mock 基线**:扩既有 recording mock 用例含 touch_drag 单事件
- **defect detect**:接入后 `recording-no-touch-events` detect=0
- **game_input schema**:INPUT_METHODS 含 send_drag/send_touch(静态断言)+ 3 处 description 含(send_drag/send_touch 文本校验)

### §7 缺陷治理闭环

实现完成后更新 `docs/defects/defects.md`(或对应 defect 库)`recording-no-touch-events` note:
- 删除"建议另开"(Path A 并入,非另开)
- 标注:Path A 决策(并入 recording-no-touch-events)+ F2 双侧契约已纳入 + 修复 commit
- last-seen / found-in 追加本 PR(审查报告已预更新 defects.md:498-507,实现后补 commit)

## 验收标准

- [ ] `recording_commands.gd` `_input` + `_fire_playback_event` 含 `InputEventScreenDrag`/`touch_drag`
- [ ] `mcp_bridge.gd` `_input` 含 ScreenDrag 分支 + `_cmd_send_drag` + dispatch `send_drag`
- [ ] `recording.ts` 回放含 `touch_drag` 分支(sendToBridge('send_drag'))+ F3 unknown→errors
- [ ] `game-bridge.ts` `INPUT_METHODS` 含 `send_drag` + `send_touch` + 3 处 description 同步
- [ ] **F2** 双侧字段契约测试绿(TOUCH_DRAG_FIELDS 三端对齐)
- [ ] **F5** 同 index 序列用例绿
- [ ] defect `recording-no-touch-events` status fixed / baseline 0 / detect===0
- [ ] defects.md note 闭环(删"建议另开")
- [ ] TS 测试绿 + 现有全测试无回归
- [ ] `npm run lint` + `tsc --noEmit` clean + GDScript validate_scripts 0 errors

## 影响范围

- **修改**:`addons/godot_mcp_server/commands/recording_commands.gd`(_input + _fire_playback_event)、`src/scripts/mcp_bridge.gd`(_input + _cmd_send_drag + dispatch)、`src/tools/recording.ts`(回放分支 + F3 unknown→errors + 导出 TOUCH_DRAG_FIELDS)、`src/tools/game-bridge.ts`(INPUT_METHODS + description×3)、`test/regression/defects.ts`(status/baseline)、`docs/.../defects.md`(note 闭环)
- **测试**:`test/recording.test.ts`(扩 touch_drag mock + F2 字段契约 + F5 序列)
- **不改**:ScreenTouch 已有契约、两套录制系统结构、事件 time_offset 格式、pressure(YAGNI)
