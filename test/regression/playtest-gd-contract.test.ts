import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// P2-4 GD 侧契约测试(审查 I-3):mcp_bridge.gd 是 bridge 运行时(TCP,游戏进程),
// headless SceneTree 测不了 _process/_handle_message 的 TCP 路由。改用源码字面量断言
// 防 B-1 类漂移(BLOCKED_PROPERTIES 多副本撕裂)+ 命令存在性。参 headless-whitelist.test.ts 模式。
const GD = readFileSync(join(__dirname, '..', '..', 'src', 'scripts', 'mcp_bridge.gd'), 'utf-8');

describe('P2-4 mcp_bridge.gd playtest 契约(审查 I-3)', () => {
  describe('B-1 守护:BLOCKED_PROPERTIES 必须含 instance(防 ExtResource 注入 RCE)', () => {
    it('BLOCKED_PROPERTIES 数组含 "instance"', () => {
      const m = GD.match(/const BLOCKED_PROPERTIES[\s\S]{0,500}?\]/);
      expect(m, 'BLOCKED_PROPERTIES block found').toBeTruthy();
      expect(m![0]).toMatch(/"instance"/);
    });

    it('snapshot 序列化器跳过 BLOCKED_PROPERTIES(_collect_node_snapshot)', () => {
      // _collect_node_snapshot 必须用同一个 BLOCKED_PROPERTIES 常量(不新抄)
      const m = GD.match(/func _collect_node_snapshot[\s\S]{0,600}?for child in/);
      expect(m, '_collect_node_snapshot found').toBeTruthy();
      expect(m![0]).toMatch(/in BLOCKED_PROPERTIES/);
    });

    it('restore 跳过 BLOCKED_PROPERTIES(_cmd_playtest_restore)', () => {
      // 到下一个 func 定义为边界(避免非贪婪到首个 return 截断)
      const m = GD.match(/func _cmd_playtest_restore[\s\S]*?\nfunc /);
      expect(m, '_cmd_playtest_restore found').toBeTruthy();
      expect(m![0]).toMatch(/in BLOCKED_PROPERTIES/);
    });
  });

  describe('5 个 playtest 命令存在 + match 分发', () => {
    it('match 分发含 5 个 playtest.method', () => {
      expect(GD).toMatch(/"playtest\.seed":/);
      expect(GD).toMatch(/"playtest\.fixed_delta":/);
      expect(GD).toMatch(/"playtest\.snapshot":/);
      expect(GD).toMatch(/"playtest\.restore":/);
      expect(GD).toMatch(/"playtest\.step":/);
    });

    it('5 个 _cmd_playtest_* 函数定义存在', () => {
      expect(GD).toMatch(/func _cmd_playtest_seed\(/);
      expect(GD).toMatch(/func _cmd_playtest_fixed_delta\(/);
      expect(GD).toMatch(/func _cmd_playtest_snapshot\(/);
      expect(GD).toMatch(/func _cmd_playtest_restore\(/);
      expect(GD).toMatch(/func _cmd_playtest_step\(/);
    });
  });

  describe('I-2 守护:step 走 _process 计数器(非 coroutine),frames=1 边界', () => {
    it('step 哨兵字符串格式正确(_handle_message 返回)', () => {
      // _handle_message 对 step 返回 __PLAYTEST_STEP__<frames>__
      expect(GD).toMatch(/__PLAYTEST_STEP__%d__/);
    });

    it('_process 末尾有 pending 处理 + _added_this_frame 边界守卫(I-2 修复)', () => {
      // I-2 修复:刚加入的 entry 本帧不递减,避免 frames=1 在同一 tick 完成(physics 未推进)
      expect(GD).toMatch(/_playtest_step_pending/);
      expect(GD).toMatch(/_added_this_frame/);
    });
  });

  describe('fixed_delta 安全:不碰 time_scale,restore 还原原值', () => {
    it('fixed_delta 改 physics_ticks_per_second + max_physics_steps_per_frame + jitter_fix 三连', () => {
      // 到下一个 func 定义为边界
      const m = GD.match(/func _cmd_playtest_fixed_delta[\s\S]*?\nfunc /);
      expect(m, '_cmd_playtest_fixed_delta found').toBeTruthy();
      expect(m![0]).toMatch(/Engine\.physics_ticks_per_second/);
      expect(m![0]).toMatch(/Engine\.max_physics_steps_per_frame/);
      expect(m![0]).toMatch(/Engine\.physics_jitter_fix/);
      // 反向:不碰 time_scale(避破坏 keepalive/recording Timer)
      expect(m![0]).not.toMatch(/Engine\.time_scale/);
    });

    it('restore 还原 fixed_delta 原值(_playtest_fixed_delta_saved)', () => {
      expect(GD).toMatch(/_playtest_fixed_delta_saved/);
    });
  });

  describe('_input 录制污染防护(_playtest_active 早 return)', () => {
    it('_input 在 recording 检查后有 _playtest_active 早 return', () => {
      const m = GD.match(/func _input\(event: InputEvent\)[\s\S]{0,200}?if _playtest_active/);
      expect(m, '_input playtest guard found').toBeTruthy();
    });
  });
});
