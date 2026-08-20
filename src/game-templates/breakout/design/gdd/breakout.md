# 打砖块(Breakout)

> 模板 slug: `breakout` · 调参: `tuning/breakout.csv` → `tuning/breakout.tres` · qa: `qa/breakout.qa.md`

## Overview

经典打砖块:左右键移动挡板接球,球在砖墙与挡板间反弹,击碎砖块得分;球落底损失生命,砖清空获胜。**自写 AABB 物理**(非引擎刚体)保证帧级确定性——同 seed 同输入完全可复现。

## Player Fantasy

「球是我弹出去的箭」——挡板命中位置决定反弹角的控球感是核心手感:擦边打出险角清死角砖,正面稳托过渡。碎砖连响与生命倒数构成节奏张弛。

## Detailed Rules

1. 开局:`brick_rows × brick_cols` 矩阵砖墙置于上方,挡板居底部,球从挡板上方以随机角度(`randf_range`)发出;
2. 球每物理帧按速度向量移动 `ball_speed` 像素(自写 AABB:不做引擎物理);
3. 球撞上/下边界反弹;撞左/右边界反弹;撞挡板按命中偏移决定水平分量(中心近垂直,边缘更斜);撞砖块反弹且砖消失、score+1;
4. 球落出下边界:lives-1,球重置到挡板上方再次随机角发出;lives 归零 `game_over=true`;
5. `bricks_left == 0` 时 `won=true` 且 `game_over=true`;
6. `game_over` 后停止模拟,输入不再生效。

## Formulas

- 反弹:撞面法线翻转速度分量(上/下面翻 vy,左/右面翻 vx),速率恒定 `ball_speed`;
- 挡板反弹角:`vx = hit_offset × ball_speed × 0.8;vy = -sqrt(ball_speed² - vx²)`(hit_offset ∈ [-1,1]);
- `score = bricks_broken`;
- `lives` 起始 `lives`(默认 3);
- 发球角:与竖直方向 ±30°..±60° 内 `randf_range`(全局 RNG,seed 可锁)。

## Edge Cases

- 球一帧内同时接触砖与墙:先处理砖(更近面),墙反弹下一帧生效;
- 挡板移动到球下方接球判定用 AABB 交集(非中心点),擦边也算接到;
- 球速水平分量极端接近 ±ball_speed 时钳制最小垂直分量(防水平死循环);
- 发球角避开纯水平/纯垂直;
- 砖块行列数为 0 时直接判胜(防御)。

## Dependencies

- Godot 4.5–4.7(仅内置节点 Node2D/ColorRect/AreaRect 绘制,零外部资产、零 autoload、零引擎物理节点);
- 调参资源 `tuning/breakout.tres`(`GameConfigBreakout`,`_ready` 加载,缺失用默认值);
- 键盘左右键。

## Tuning Knobs

| 旋钮 | .tres 字段 | 默认 | 效果 |
|---|---|---|---|
| 挡板宽 | `paddle_width` | 120 | 宽=易接,窄=高压 |
| 球速 | `ball_speed` | 6.0 | 像素/物理帧 |
| 砖行数 | `brick_rows` | 4 | 砖墙厚度 |
| 砖列数 | `brick_cols` | 10 | 砖墙宽度 |
| 生命 | `lives` | 3 | 容错次数 |

改表工作流:编辑 `tuning/breakout.csv` → `csv_to_resources` 重导 `breakout.tres` → 重启生效。

## Acceptance Criteria

1. 开局砖数恰 `brick_rows × brick_cols`,lives=默认值;
2. 同 seed + 同输入 ⇒ 每步球位置/bricks_left/score 一致(自写 AABB 确定性);
3. 时间线左右移动 + 步进后 `score >= 1`(至少碎一砖);
4. 球反复撞上下左右边界均反弹(不出界);
5. lives 归零或砖清空时 `game_over == true`。
