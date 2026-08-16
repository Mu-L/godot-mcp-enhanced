// test/analysis.test.ts — 理解层（signal_map / impact_check）+ tscn connection 扩展回归
//
// 负向重点（memory missing-negative-test-cases）：注释/字符串里的信号调用不得误报。
// fixture：test/fixtures/analysis-project（main.tscn 含 flags/binds 连接 + 实例化 sub.tscn）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { parseTscn } from '../src/tscn/tscn-parser.js';
import { scanGdScriptSignals } from '../src/tools/analysis/gdscan.js';
import { handleTool } from '../src/tools/analysis/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, 'fixtures', 'analysis-project');

function ctxStub(): Parameters<typeof handleTool>[2] {
  // analysis 不消费 ctx（纯静态），传最小对象即可
  return {} as Parameters<typeof handleTool>[2];
}

async function callAction(args: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown>; error?: string; error_code?: string }> {
  const res = await handleTool('analysis', { project_path: FIXTURE, ...args }, ctxStub());
  const text = res?.content[0]?.type === 'text' ? res.content[0].text : '';
  const json = JSON.parse(text) as Record<string, unknown>;
  if (json.success === true) {
    return { ok: true, data: json.data as Record<string, unknown> };
  }
  return { ok: false, data: {}, error: String(json.error), error_code: String(json.error_code) };
}

describe('tscn-parser connection 扩展回归（flags/binds/unbinds）', () => {
  it('main.tscn 的 binds（含空格数组）与 flags 被完整捕获', () => {
    const content = readFileSync(resolve(FIXTURE, 'scenes/main.tscn'), 'utf-8');
    const parsed = parseTscn(content);
    expect(parsed.connections).toHaveLength(2);
    const [c1, c2] = parsed.connections;
    expect(c1).toMatchObject({ signal: 'pressed', from: 'Button', to: '.', method: '_on_button_pressed' });
    expect(c1!.flags).toBeUndefined(); // 无该键
    expect(c2).toMatchObject({ signal: 'hit', flags: '4', binds: '[2, "a b"]' });
  });

  it('原有四键解析不回归（sub.tscn）', () => {
    const parsed = parseTscn(readFileSync(resolve(FIXTURE, 'scenes/sub.tscn'), 'utf-8'));
    expect(parsed.connections).toEqual([
      expect.objectContaining({ signal: 'body_entered', from: '.', to: '.', method: '_on_body' }),
    ]);
  });
});

describe('scanGdScriptSignals 正负向', () => {
  it('正向：emit_signal/.emit/.connect/.disconnect 均识别', () => {
    const refs = scanGdScriptSignals(readFileSync(resolve(FIXTURE, 'scripts/main.gd'), 'utf-8'));
    const kinds = refs.map(r => `${r.kind}:${r.signal}`);
    expect(kinds).toContain('connect:game_over');
    expect(kinds).toContain('connect:pressed');
    expect(kinds).toContain('emit:game_over');
    expect(kinds).toContain('connect:hit');
  });

  it('负向：注释与字符串内的 emit_signal 不得误报', () => {
    const refs = scanGdScriptSignals(readFileSync(resolve(FIXTURE, 'scripts/main.gd'), 'utf-8'));
    const names = refs.map(r => r.signal);
    expect(names).not.toContain('fake_in_comment');
    expect(names).not.toContain('in_string');
  });

  it('负向：connect_to_host 等非 connect 后缀方法不误报', () => {
    const refs = scanGdScriptSignals('tcp.connect_to_host("localhost")\n');
    expect(refs).toHaveLength(0);
  });

  it('sub.gd：disconnect 与 .emit 识别', () => {
    const refs = scanGdScriptSignals(readFileSync(resolve(FIXTURE, 'scripts/sub.gd'), 'utf-8'));
    const kinds = refs.map(r => `${r.kind}:${r.signal}`);
    expect(kinds).toContain('disconnect:clear_shapes');
    expect(kinds).toContain('emit:hit');
  });
});

describe('analysis.signal_map', () => {
  it('全项目：3 条编辑器连接 + 代码引用，来源分开', async () => {
    const r = await callAction({ action: 'signal_map' });
    expect(r.ok).toBe(true);
    const stats = r.data.stats as Record<string, number>;
    expect(stats.sceneCount).toBe(2);
    expect(stats.connectionCount).toBe(3);
    expect(stats.matched_connections).toBe(3);

    const conns = r.data.connections as Array<Record<string, string>>;
    expect(conns.find(c => c.signal === 'pressed')).toMatchObject({ scene: 'res://scenes/main.tscn', method: '_on_button_pressed' });
    expect(conns.find(c => c.signal === 'body_entered')).toMatchObject({ scene: 'res://scenes/sub.tscn' });

    const refs = r.data.code_refs as Array<Record<string, unknown>>;
    expect(refs.some(x => x.script === 'res://scripts/main.gd' && x.kind === 'emit' && x.signal === 'game_over')).toBe(true);
    // 负向：fixture 的注释/字符串样本不出现
    expect(refs.some(x => x.signal === 'fake_in_comment' || x.signal === 'in_string')).toBe(false);

    expect(Array.isArray(r.data.blindspots)).toBe(true);
  });

  it('signal 过滤精确匹配 + scene 子串过滤', async () => {
    const bySignal = await callAction({ action: 'signal_map', signal: 'pressed' });
    const conns = bySignal.data.connections as unknown[];
    expect(conns).toHaveLength(1);

    const byScene = await callAction({ action: 'signal_map', scene: 'sub' });
    const subConns = byScene.data.connections as Array<{ signal: string }>;
    expect(subConns.every(c => c.signal === 'body_entered')).toBe(true);
  });
});

describe('analysis.impact_check', () => {
  it('signal 目标：连接方/发射方/监听方 + hint', async () => {
    const r = await callAction({ action: 'impact_check', signal: 'game_over' });
    expect(r.ok).toBe(true);
    const summary = r.data.summary as Record<string, number>;
    expect(summary.editor_connections).toBe(0);
    expect(summary.emitters).toBeGreaterThanOrEqual(1);
    expect(summary.listeners).toBeGreaterThanOrEqual(1);
    expect(String(r.data.hint)).toContain('game_over');
  });

  it('signal 目标：编辑器声明的连接被命中', async () => {
    const r = await callAction({ action: 'impact_check', signal: 'body_entered' });
    const summary = r.data.summary as Record<string, number>;
    expect(summary.editor_connections).toBe(1);
    expect(summary.affected_scenes).toBe(1);
  });

  it('script_path 目标：引用场景 + 节点绑定 + 文本引用', async () => {
    const r = await callAction({ action: 'impact_check', script_path: 'res://scripts/main.gd' });
    expect(r.ok).toBe(true);
    const scenes = r.data.referencing_scenes as Array<{ scene: string; node_bindings: string[] }>;
    expect(scenes).toContainEqual({ scene: 'res://scenes/main.tscn', node_bindings: ['Root'] });
    const textRefs = r.data.text_refs as Array<{ script: string }>;
    expect(textRefs.some(t => t.script === 'res://scripts/other.gd')).toBe(true);
  });

  it('script_path 绝对路径归一化等价', async () => {
    const r = await callAction({ action: 'impact_check', script_path: resolve(FIXTURE, 'scripts/main.gd') });
    expect(r.ok).toBe(true);
    expect(r.data.target).toMatchObject({ kind: 'script', path: 'res://scripts/main.gd' });
  });

  it('scene_path 目标：连接/脚本绑定/被实例化方', async () => {
    const r = await callAction({ action: 'impact_check', scene_path: 'res://scenes/sub.tscn' });
    expect(r.ok).toBe(true);
    const summary = r.data.summary as Record<string, number>;
    expect(summary.connections).toBe(1);
    expect(summary.instanced_by).toBe(1);
    expect(r.data.instanced_by).toEqual(['res://scenes/main.tscn']);
    const bindings = r.data.script_bindings as Array<{ nodePath: string; scriptPath: string }>;
    expect(bindings).toContainEqual({ nodePath: 'SubRoot', scriptPath: 'res://scripts/sub.gd' });
  });

  it('无目标 / 多目标 → INVALID_PARAMS', async () => {
    expect((await callAction({ action: 'impact_check' })).error_code).toBe('INVALID_PARAMS');
    expect((await callAction({ action: 'impact_check', signal: 'a', script_path: 'b' })).error_code).toBe('INVALID_PARAMS');
  });

  it('场景不存在 → SCENE_NOT_FOUND', async () => {
    expect((await callAction({ action: 'impact_check', scene_path: 'res://scenes/nope.tscn' })).error_code).toBe('SCENE_NOT_FOUND');
  });
});
