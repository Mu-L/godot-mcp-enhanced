# 贪吃蛇确定性 qa 套件

> 跑法(项目根):`npx godot-mcp-enhanced qa run qa/snake.qa.md --project .`
> `options.seed=42` 锁食物随机位置;freeze+时间线锁转向输入;轨迹 up→left
> (20 格网格内 12 步不撞墙:上 3 格 + 左 9 格,离左缘 1 格余量)。

```qa-spec
{
  "name": "snake-deterministic",
  "options": { "seed": 42, "fixed_delta_hz": 60 },
  "steps": [
    { "type": "freeze", "label": "锁起播点" },
    { "type": "input", "method": "send_input_sequence",
      "params": { "timeline": [
        { "at_frame": 2,  "type": "key", "key": "up",   "pressed": true },
        { "at_frame": 4,  "type": "key", "key": "up",   "pressed": false },
        { "at_frame": 30, "type": "key", "key": "left", "pressed": true },
        { "at_frame": 32, "type": "key", "key": "left", "pressed": false }
      ], "settle_frames": 0 } },
    { "type": "step_until",
      "conditions": [ { "path": "/root/Main/GameSnake", "property": "steps_moved", "op": ">=", "value": 12 } ],
      "max_frames": 200,
      "label": "步进 12 格(8 帧/格 ≈ 96 帧)" },
    { "type": "assert", "assert": "node_state",
      "path": "/root/Main/GameSnake", "expect": { "steps_moved": 12 }, "tolerance": 0,
      "label": "AC-2 freeze 期零漂移,恰 12 步" },
    { "type": "assert", "assert": "node_state",
      "path": "/root/Main/GameSnake", "expect": { "direction": "left" }, "tolerance": 0,
      "label": "AC-4 最终方向 left(up 后 left 生效,非 180° 回头)" },
    { "type": "assert", "assert": "node_state",
      "path": "/root/Main/GameSnake", "expect": { "game_over": false }, "tolerance": 0,
      "label": "AC 轨迹安全未撞墙" },
    { "type": "unfreeze", "label": "释放" }
  ]
}
```
