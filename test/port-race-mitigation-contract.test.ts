import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// 端口竞态缓解(2026-08-21 裁决)契约:默认场景起始候选随机化(crypto 源,非 randi)。
// 竞态实测:v1 无缓解 18/20 双 bind 假成功 → v3 随机起点 50 轮命中 2(≈4%),
// 剩余命中由 auth 拒绝兜底(secret 每实例密码学随机,危害=显式失败非静默错连)。
const gd = readFileSync('src/scripts/mcp_bridge.gd', 'utf8');

describe('端口竞态缓解契约(_bind_available_port 随机起点)', () => {
  const bindSlice = () => {
    const start = gd.indexOf('func _bind_available_port');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = gd.indexOf('func _port_in_use', start);
    return gd.slice(start, end);
  };

  it('env 未指定时起始候选随机化(crypto.generate_random_bytes 源)', () => {
    const s = bindSlice();
    expect(s.includes('elif _crypto != null:'), '缺随机化分支').toBe(true);
    expect(s.includes('_crypto.generate_random_bytes(2)'), '随机源必须是 crypto(非 randi)').toBe(true);
  });

  it('随机源不用 randi/randf(playtest.seed 锁全局 RNG,双实例同 seed 时同值随机化失效)', () => {
    const s = bindSlice();
    expect(/rand[if]\s*\(/.test(s), 'bind 段不得用 randi/randf(seed 可锁定)').toBe(false);
  });

  it('env 显式指定时保持确定性(用户契约:clampi 分支在前)', () => {
    const s = bindSlice();
    expect(s.indexOf('clampi(int(env_port)'), 'env 分支应在随机化分支之前').toBeLessThan(
      s.indexOf('elif _crypto != null:')
    );
  });
});
