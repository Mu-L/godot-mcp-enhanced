# 打砖块确定性 qa 套件

> 跑法(项目根):`npx godot-mcp-enhanced qa run qa/breakout.qa.md --project .`
> `options.seed=42` 锁发球角;freeze+时间线锁挡板输入;自写 AABB 物理帧级确定。

```qa-spec
{
  "name": "breakout-deterministic",
  "options": { "seed": 42, "fixed_delta_hz": 60 },
  "steps": [
    { "type": "freeze", "label": "锁起播点" },
    { "type": "input", "method": "send_input_sequence",
      "params": { "timeline": [
        { "at_frame": 2,  "type": "key", "key": "left",  "pressed": true },
        { "at_frame": 40, "type": "key", "key": "left",  "pressed": false },
        { "at_frame": 44, "type": "key", "key": "right", "pressed": true },
        { "at_frame": 80, "type": "key", "key": "right", "pressed": false }
      ], "settle_frames": 0 } },
    { "type": "step_until",
      "conditions": [ { "path": "/root/Main/GameBreakout", "property": "frames_simulated", "op": ">=", "value": 200 } ],
      "max_frames": 260,
      "label": "模拟 200 帧" },
    { "type": "assert", "assert": "node_state",
      "path": "/root/Main/GameBreakout", "expect": { "lives": 3 }, "tolerance": 0,
      "label": "AC-1 生命未损(200 帧内)" },
    { "type": "assert", "assert": "node_state",
      "path": "/root/Main/GameBreakout", "expect": { "game_over": false }, "tolerance": 0,
      "label": "AC 未结束" },
    { "type": "unfreeze", "label": "释放" }
  ]
}
```
