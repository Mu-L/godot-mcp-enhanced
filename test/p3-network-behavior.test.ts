import { describe, it, expect } from 'vitest';
import { executeGdscript } from '../src/gdscript-executor.js';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GODOT_PATH = process.env.GODOT_PATH ?? '';
const CHECK_PROJECT = resolve(__dirname, 'fixtures', 'gdscript-check');
const hasGodot = GODOT_PATH !== '' && existsSync(GODOT_PATH);

/**
 * P3-1 (2026-09-11): NetworkConditioner 行为探针(真跑 Godot,对齐 p0-callv-precheck-behavior 模式)。
 * 直接实例化 mcp_bridge.gd 的 inner class _NetworkConditioner(不依赖 bridge TCP 会话),
 * 验证丢包/延迟入队/直通三分支与 set/get/clear 往返。ENet server peer headless 可建
 * (create_server(0) 系统分配端口,无显示依赖)。
 */

async function runNetProbe(lines: string[]): Promise<{ realError: boolean; values: Record<string, string> }> {
  const code = [
    'extends SceneTree',
    '',
    'func _init():',
    '\tvar B = load("res://src/scripts/mcp_bridge.gd")',
    '\tvar C = B._NetworkConditioner',
    ...lines.map(l => '\t' + l),
    '\tquit()',
  ].join('\n');
  const result = await executeGdscript({ godotPath: GODOT_PATH, projectPath: CHECK_PROJECT, timeout: 30, code });
  const raw = result.raw_output;
  const realError = /\b(Parse Error|SCRIPT ERROR|Invalid |ENGINE ERROR)\b/.test(raw);
  const values: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^RESULT\s+(\S+?)=(.*)$/);
    if (m) values[m[1]!] = m[2]!;
  }
  return { realError, values };
}

/** 探针公共前缀:建 ENet server peer + conditioner 实例(inner=该 peer)。 */
const SETUP = [
  'var peer := ENetMultiplayerPeer.new()',
  'var srv_err := peer.create_server(0, 1)',
  'if srv_err != OK:',
  '\tprint("RESULT setup_fail=" + str(srv_err))',
  '\tquit()',
  '\treturn',
  'var c = C.new()',
  'c.set_inner(peer)',
];

describe.skipIf(!hasGodot)('P3-1: NetworkConditioner 行为探针(真跑 Godot)', () => {
  it('NB-a: inner class 可实例化(防 class 声明/MultiplayerPeerExtension extends 事故)', async () => {
    const { realError, values } = await runNetProbe([
      'print("RESULT inst=" + str(C != null and C.new() != null))',
    ]);
    expect(realError, '不应有脚本错误(inner class 声明事故)').toBe(false);
    expect(values.inst).toBe('true');
  });

  it('NB-b: loss=100 全丢——返回 OK 且 pending 不入队', async () => {
    const { realError, values } = await runNetProbe([
      ...SETUP,
      'c.set_conditions(0.0, 100.0, 0.0)',
      'var rc = c._put_packet_script(PackedByteArray([1,2,3]))',
      'print("RESULT rc=" + str(rc))',
      'print("RESULT pending=" + str(c.pending_count()))',
    ]);
    expect(realError).toBe(false);
    // randf() < 1.0 恒真 → 全部静默丢包(返回 OK,不进队列)
    expect(values.rc).toBe('0');
    expect(values.pending).toBe('0');
  });

  it('NB-c: latency 延迟入队——pending=1,flush 时刻未到不发包', async () => {
    const { realError, values } = await runNetProbe([
      ...SETUP,
      'c.set_conditions(10000.0, 0.0, 0.0)',
      'var rc = c._put_packet_script(PackedByteArray([1,2,3]))',
      'print("RESULT rc=" + str(rc))',
      'print("RESULT pending=" + str(c.pending_count()))',
    ]);
    expect(realError).toBe(false);
    expect(values.rc).toBe('0');
    expect(values.pending).toBe('1');
  });

  it('NB-d: 全 0 直通——pending 不入队', async () => {
    const { realError, values } = await runNetProbe([
      ...SETUP,
      'c.set_conditions(0.0, 0.0, 0.0)',
      'var _rc = c._put_packet_script(PackedByteArray([1,2,3]))',
      'print("RESULT pending=" + str(c.pending_count()))',
    ]);
    expect(realError).toBe(false);
    expect(values.pending).toBe('0');
  });

  it('NB-e: set/get_conditions 往返 + get_inner 正确', async () => {
    const { realError, values } = await runNetProbe([
      ...SETUP,
      'c.set_conditions(120.0, 30.0, 40.0)',
      'var cond = c.get_conditions()',
      'print("RESULT lat=" + str(cond["latency_ms"]))',
      'print("RESULT loss=" + str(cond["loss_pct"]))',
      'print("RESULT jitter=" + str(cond["jitter_ms"]))',
      'print("RESULT inner_ok=" + str(c.get_inner() == peer))',
    ]);
    expect(realError).toBe(false);
    expect(values.lat).toBe('120.0');
    expect(values.loss).toBe('30.0');
    expect(values.jitter).toBe('40.0');
    expect(values.inner_ok).toBe('true');
  });
});
