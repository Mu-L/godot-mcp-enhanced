# 贪吃蛇确定性 qa 套件

> 跑法(项目根):`npx godot-mcp-enhanced qa run qa/snake.qa.md --project .`
> `options.seed=42` 锁食物随机位置;freeze+时间线锁转向输入。

```qa-spec
{
  "name": "snake-deterministic",
  "options": { "seed": 42, "fixed_delta_hz": 60 },
  "steps": [
    { "type": "freeze", "label": "锁起播点" },
    { "type": "input", "method": "send_input_sequence",
      "params": { "timeline": [
        { "at_frame": 2,  "type": "key", "key": "Up",   "pressed": true },
        { "at_frame": 4,  "type": "key", "key": "Up",   "pressed": false },
        { "at_frame": 30, "type": "key", "key": "Right", "pressed": true },
        { "at_frame": 32, "type": "key", "key": "Right", "pressed": false }
      ], "settle_frames": 0 } },
    { "type": "step_until",
      "params": { "conditions": [ { "path": "/root/Main/GameSnake", "property": "steps_moved", "op": ">=", "value": 12 } ], "max_frames": 300 },
      "label": "步进 12 格以上(约 96 帧)" },
    { "type": "assert", "assertion": "node_state",
      "params": { "path": "/root/Main/GameSnake", "expect": { "game_over": false }, "tolerance": 0 },
      "label": "AC 未结束(开局区域安全)" },
    { "type": "assert", "assertion": "node_state",
      "params": { "path": "/root/Main/GameSnake", "expect": { "direction": "right" }, "tolerance": 0 },
      "label": "AC-4 最终方向 right(Up 后 Right 生效)" },
    { "type": "unfreeze", "label": "释放" }
  ]
}
```
