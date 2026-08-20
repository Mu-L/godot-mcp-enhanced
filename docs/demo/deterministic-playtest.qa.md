# 确定性 Playtest 演示(L3 真确定性闭环)

> **一条命令复现**(仓库根):
> `node build/index.js qa run docs/demo/deterministic-playtest.qa.md --project test/fixtures/input-seq-e2e`
>
> 套件演示 L3 确定性三要素协同:**seed 锁随机 + freeze 锁起播点 + 帧定时输入时间线锁输入**,
> 再以结构化条件步进收尾并断言游戏真实读到了时间线输入。
> **跨 run 可复现实证**:同 spec 连跑两次(实测 2026-08-20 两跑均 5/5 PASSED)+
> `node build/index.js qa diff` → `NO_STATUS_CHANGE, regressions: 0`——两次运行游戏状态
> 演化一致(断言的 press_count/动作序列逐项相等;全局帧号因进程启动时序天然不同,不在断言面)。
> gif 录制素材:并排展示两份报告 + diff 零回归输出。
>
> 配套探针:`test/fixtures/input-seq-e2e/probe.gd`(运行时注册 action "jump",
> `_physics_process` 计数 `frames_run`/`press_count` 并记录首个读到 press 的帧号)。

```qa-spec
{
  "name": "deterministic-playtest-demo",
  "options": { "seed": 42, "fixed_delta_hz": 60 },
  "steps": [
    { "type": "freeze", "label": "L3-① 锁定起播点(freeze,bridge 仍响应)" },
    { "type": "input", "method": "send_input_sequence",
      "params": { "timeline": [
          { "at_frame": 1, "type": "action", "name": "jump", "pressed": true },
          { "at_frame": 8, "type": "action", "name": "jump", "pressed": false }
        ], "settle_frames": 20 },
      "label": "L3-② 帧定时输入时间线(press@帧1 / release@帧8,完成自动 refreeze)" },
    { "type": "step_until",
      "conditions": [{ "path": "/root/Main", "property": "frames_run", "op": ">=", "value": 40 }],
      "max_frames": 120,
      "label": "L3-③ 结构化条件步进(推进至物理帧 frames_run>=40)" },
    { "type": "assert", "assert": "node_state", "path": "/root/Main",
      "expect": { "press_count": 1, "first_seen_action": "jump" },
      "label": "断言:时间线恰好注入一次 press 且被游戏 _physics_process 读到" },
    { "type": "unfreeze", "label": "释放控制层(还原游戏 paused 原值)" }
  ]
}
```

> 叙事背景:赛道里 "deterministic" 正被挪用(帧步进≠真确定性)。本套件是 README
> 「确定性分级」表的 L3 可运行注脚——L1(仅 freeze/固定帧 step)与 L2(仅输入时序)
> 都做不到「同输入+同 seed ⇒ 跨 run 可复现」。
