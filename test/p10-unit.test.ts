/**
 * P10 批 (2026-09-12): sync_state 多人状态同步(masteryee 移植裁剪)。
 *
 * 断言分层:
 * - GD 源码契约: collect_state 命令注册/_mcp_state 约定/group 存在性/上限/递归安全化
 * - TS 纯函数: compareStates 浮点容差递归比对(masteryee 亲读坑的修复验证)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareStates } from '../src/tools/game-bridge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const GD = readFileSync(resolve(REPO, 'src/scripts/mcp_bridge.gd'), 'utf-8');
const TS = readFileSync(resolve(REPO, 'src/tools/game-bridge.ts'), 'utf-8');
const FIXTURE = readFileSync(resolve(REPO, 'test/fixtures/p3-e2e/main.gd'), 'utf-8');

describe('P10: sync_state — GD 源码契约', () => {
  it('GD-a: collect_state 命令注册 + _mcp_state 约定 + group 存在性标记', () => {
    expect(GD.includes('"collect_state":')).toBe(true);
    expect(GD.includes('func _cmd_collect_state(')).toBe(true);
    expect(GD.includes('has_method("_mcp_state")')).toBe(true);
    expect(GD.includes('"__present__": true')).toBe(true);  // group 成员存在性(无 _mcp_state)
    expect(GD.includes('"__error__": "_mcp_state() must return a Dictionary"')).toBe(true);
  });

  it('GD-b2(B-1 清偿): 几何类型走 _jsonify 转 {x,y,z}——裸 Vector2 序列化退化字符串会让容差失效', () => {
    // 裸 Vector2 经 JSON.stringify 退化为 "(10.000001, 20)" 字符串(send_drag 先例真机实证),
    // TS 容差只对 number 生效——必须转 dict 走分量级容差;float INF/NaN 降级 str()
    expect(GD.includes('if v is Vector2 or v is Vector2i or v is Vector3 or v is Vector3i or v is Vector4 or v is Vector4i or v is Color:')).toBe(true);
    expect(GD.includes('return _jsonify(v)')).toBe(true);
    expect(GD.includes('if v is float and not is_finite(v):')).toBe(true);
  });

  it('GD-b3(N-2 清偿): 256 截断显式 truncated 标记(防两侧同截断 in_sync 假阴性)', () => {
    expect(GD.includes('truncated = true')).toBe(true);
    expect(GD.includes('"truncated": truncated')).toBe(true);
  });

  it('TS-b3(全仓审查): truncated 标志的 TS 消费侧接线(原 GD 产出但 TS 丢弃,N-2 只修了一半)', () => {
    // snapshot 存储/透传警告/compare 标注 unreliable/list 透传——四点源码契约
    const BRIDGE = readFileSync(resolve(__dirname, '..', 'src', 'tools', 'game-bridge.ts'), 'utf-8');
    // SyncSnapshot 接口带 truncated 字段
    expect(BRIDGE.includes('truncated: boolean')).toBe(true);
    // snapshot 存储读 parsed.truncated
    expect(BRIDGE.includes('parsed.truncated === true')).toBe(true);
    // snapshot 返回透传 + 截断警告
    expect(BRIDGE.includes('collected: parsed.collected ?? [], truncated')).toBe(true);
    // compare 任一侧截断 → unreliable 标注
    expect(BRIDGE.includes('truncated_a: truncatedA, truncated_b: truncatedB')).toBe(true);
    expect(BRIDGE.includes('unreliable: true')).toBe(true);
  });

  it('GD-b: 防爆量上限(256 节点/深度 8)+ Object 递归降级 str()', () => {
    expect(GD.includes('count >= 256')).toBe(true);
    expect(GD.includes('depth > 8')).toBe(true);
    expect(GD.includes('return "[depth-limit]"')).toBe(true);
    // 非 _is_safe_value 的 Object 降级字符串,不炸整体 JSON
    expect(GD.includes('if _is_safe_value(v):\n\t\treturn v\n\treturn str(v)')).toBe(true);
  });

  it('GD-c: fixture main.gd 实现 _mcp_state 约定(e2e 联动)', () => {
    expect(FIXTURE.includes('func _mcp_state() -> Dictionary:')).toBe(true);
    expect(FIXTURE.includes('"flag": p10_flag')).toBe(true);
    expect(FIXTURE.includes('toggle_p10_flag')).toBe(true);  // GDA_CALLABLE 可改状态
  });

  it('GD-d: game_time_ms 戳在快照里(时间线可对齐)', () => {
    expect(GD.includes('"game_time_ms": Time.get_ticks_msec()')).toBe(true);
  });
});

describe('P10: sync_state — TS 契约与 compareStates 纯函数', () => {
  it('TS-a: action 面 + schema 参数 + 快照原语', () => {
    expect(TS.includes("'sync_state',")).toBe(true);
    expect(TS.includes("enum: ['snapshot', 'compare', 'list', 'clear']")).toBe(true);
    for (const key of ['label_a', 'label_b', 'tolerance']) {
      expect(TS.includes(`          ${key}: {`)).toBe(true);
    }
    expect(TS.includes('sync_state: \'read\'')).toBe(true);  // 只收集+比对,不改游戏状态
  });

  it('CMP-a: 完全一致 → in_sync=true', () => {
    const a = { '/root/Main': { scene: 'x', flag: false, ticks: 0 } };
    const r = compareStates(a, { ...a }, 0.0001);
    expect(r.in_sync).toBe(true);
    expect(r.paths_compared).toBe(1);
    expect(r.diffs).toHaveLength(0);
  });

  it('CMP-b: 浮点容差——|a-b|<=tol 视为相等(masteryee 亲读坑的修复)', () => {
    const a = { '/root/Player': { pos: { x: 10.0, y: 20.0 }, hp: 100 } };
    const b = { '/root/Player': { pos: { x: 10.00005, y: 19.99995 }, hp: 100 } };
    // 容差 0.001:微差视为同步
    expect(compareStates(a, b, 0.001).in_sync).toBe(true);
    // 容差 0(严格):同数据判 diff——证明容差是比对语义的一部分而非恒真
    const strict = compareStates(a, b, 0);
    expect(strict.in_sync).toBe(false);
    expect(strict.diffs).toHaveLength(1);  // 键级 diff:pos 一个键(x/y 微差聚合在该键的值里)
    expect(strict.diffs[0]!.key).toBe('pos');
  });

  it('CMP-c: 节点集差异——missing_in_b / missing_in_a', () => {
    const a = { '/root/A': { v: 1 }, '/root/B': { v: 2 } };
    const b = { '/root/B': { v: 2 }, '/root/C': { v: 3 } };
    const r = compareStates(a, b, 0.0001);
    expect(r.in_sync).toBe(false);
    expect(r.missing_in_b).toEqual(['/root/A']);
    expect(r.missing_in_a).toEqual(['/root/C']);
    expect(r.paths_compared).toBe(1);  // 只有 B 两边都有
  });

  it('CMP-d: 键级 diff(含缺键方向)+ __present__ 存在性标记参与比对', () => {
    const a = { '/root/M': { __present__: true, extra: 1 } };
    const b = { '/root/M': { __present__: true, gone: 2 } };
    const r = compareStates(a, b, 0.0001);
    expect(r.diffs).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'extra', a: 1, b: undefined }),
      expect.objectContaining({ key: 'gone', a: undefined, b: 2 }),
    ]));
  });

  it('CMP-e: 嵌套 dict/数组递归(数组长度差/嵌套数值容差)', () => {
    const a = { '/root/N': { arr: [1, 2, 3], nested: { deep: { v: 0.5 } } } };
    const b = { '/root/N': { arr: [1, 2], nested: { deep: { v: 0.5000049 } } } };
    const r = compareStates(a, b, 0.00001);
    expect(r.diffs.some((d) => d.key === 'arr')).toBe(true);  // 长度差
    expect(r.diffs.some((d) => d.key === 'deep')).toBe(false);  // 容差内
  });

  it('CMP-f: 类型不匹配(number vs string)严格不等,不静默', () => {
    const a = { '/root/T': { v: 1 } };
    const b = { '/root/T': { v: '1' } };
    expect(compareStates(a, b, 1).in_sync).toBe(false);  // 容差救不了类型差
  });

  it('CMP-g(B-1 清偿): 同值 Infinity 不因容差分支误判 diff(Math.abs(NaN)<=tol 恒 false 陷阱)', () => {
    // GD INF 序列化 1e99999 → TS 解析回 Infinity;容差分支 Math.abs(Inf-Inf)=NaN<=tol 恒 false
    // 若实现先走数值分支,同值 Infinity 会被误判 diff——valuesEqual 的数值分支须对此鲁棒
    const a = { '/root/I': { v: Infinity } };
    const b = { '/root/I': { v: Infinity } };
    const r = compareStates(a, b, 0.0001);
    expect(r.in_sync, '同值 Infinity 应判等(不经容差算术)').toBe(true);
    expect(compareStates({ '/root/I': { v: Infinity } }, { '/root/I': { v: 1e308 } }, 0.0001).in_sync).toBe(false);
  });
});
