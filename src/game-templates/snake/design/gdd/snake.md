# 贪吃蛇(Snake)

> 模板 slug: `snake` · 调参: `tuning/snake.csv` → `tuning/snake.tres` · qa: `qa/snake.qa.md`

## Overview

20×20 网格贪吃蛇:方向键控制蛇头转向,固定节奏逐格移动,吃到随机食物则得分加一并身体变长,撞墙或撞自身判负。经典的「贪多必险」风险经营循环。

## Player Fantasy

「蛇在我手里越盘越长」——每吃一颗食物都是一次主动加险:身体越长,腾挪空间越小,分数越高。转向的即时反馈与逐渐收紧的生存空间构成张力,死亡时立刻想「下次不贪那颗」。

## Detailed Rules

1. 开局:蛇 `initial_length`(默认 3)节横排于网格中部,行进方向右;随机空位生成 1 颗食物;
2. 每 `initial_speed_frames`(默认 8)物理帧移动一格(帧数越小越快);
3. 方向键转向,禁止 180° 直接回头(与当前行进方向相反的输入被忽略);
4. 蛇头进食物格:score+1、长度+1(尾部不缩)、随机空位再生成食物;`wrap_edges=false` 时蛇头出界判负,true 则环形穿越;
5. 蛇头撞自身任意节:判负;`game_over=true` 后停止移动,输入不再生效。

## Formulas

- `moves_interval = initial_speed_frames`(物理帧/格;60Hz 下 8 帧 = 7.5 格/秒);
- `score = foods_eaten`;
- `length = initial_length + score`;
- 食物位置 = 空位集合上 `randi_range`(全局 RNG,playtest.seed 可锁)。

## Edge Cases

- 连续快速两次转向(如 Up 紧接 Left)只按到达顺序逐格生效,不跳格;
- 180° 回头输入被忽略(不消耗转向、不死);
- 蛇几乎占满网格时食物仅在剩余空位生成(无空位则不生成,蛇继续);
- `wrap_edges` 为 true 时穿越边界但依然会撞自身;
- `initial_length` <1 或 >grid_size 时按 3 钳制。

## Dependencies

- Godot 4.5–4.7(仅内置节点 Node2D/ColorRect,零外部资产、零 autoload);
- 调参资源 `tuning/snake.tres`(`GameConfigSnake`,`_ready` 加载,缺失用默认值);
- 键盘方向键。

## Tuning Knobs

| 旋钮 | .tres 字段 | 默认 | 效果 |
|---|---|---|---|
| 网格边长 | `grid_size` | 20 | 小=高压,大=宽松 |
| 节奏 | `initial_speed_frames` | 8 | 越小越快 |
| 初始长度 | `initial_length` | 3 | 开局难度 |
| 环形边界 | `wrap_edges` | false | true=穿墙不死 |

改表工作流:编辑 `tuning/snake.csv` → `csv_to_resources` 重导 `snake.tres` → 重启生效。

## Acceptance Criteria

1. 开局蛇长恰为 `initial_length` 且场上有 1 颗食物;
2. 同 seed + 同输入序列 ⇒ 每步 score/length/蛇身布局一致(确定性);
3. 方向时间线两次转向 + 步进后 `length >= initial_length + 1`(吃到食物);
4. 180° 回头输入被忽略(方向不变);
5. 撞自身时 `game_over == true`。
