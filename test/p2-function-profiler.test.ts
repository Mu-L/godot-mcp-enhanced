import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { encodeVariant, decodeVariant } from '../src/core/godot-variant.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GODOT_PATH = process.env.GODOT_PATH ?? '';
const hasGodot = GODOT_PATH !== '' && existsSync(GODOT_PATH);

/**
 * P2-1 (2026-09-11): 函数级 profiling — Variant 编解码单测 + 工具接线契约 + 真引擎 e2e。
 * 移植来源:Erodenn(整文件,经真引擎验证);debugger 流 = [uint32 长度][Variant],
 * 仅解码引擎 profiler 用的有界子集(防御:截断/trailing/嵌套上限/伪长度)。
 */

describe('P2-1: godot-variant 编解码(纯函数单测)', () => {
  it('VAR-a: 往返——nil/bool/int/float/string/array 编码后再解码还原', () => {
    const cases: Array<[null | boolean | number | string | unknown[], string]> = [
      [null, 'nil'],
      [true, 'bool'], [false, 'bool'],
      [42, 'int'], [-7, '负 int'],
      [3.5, 'float'],
      ['hello 你好', 'utf8 string'],
      [['profiler:servers', 12, [true, [256, false]]], '嵌套命令数组'],
    ];
    for (const [value] of cases) {
      const v = value as Parameters<typeof encodeVariant>[0];
      expect(decodeVariant(encodeVariant(v)), JSON.stringify(v)).toEqual(v);
    }
  });

  it('VAR-b: 解码防御——截断/trailing bytes/未支持类型均抛错', () => {
    const full = encodeVariant(['abc', 1]);
    expect(() => decodeVariant(full.subarray(0, full.length - 2)), '截断抛').toThrow();
    expect(() => decodeVariant(Buffer.concat([full, Buffer.from([0])])), 'trailing 抛').toThrow();
    // header 直接给 OBJECT(24)——有界子集外,fail loudly
    const bad = Buffer.alloc(8);
    bad.writeUInt32LE(24, 0);
    expect(() => decodeVariant(bad), 'OBJECT 类型抛').toThrow();
  });

  it('VAR-c: packed 数组伪长度防御(长度超过剩余字节拒收)', () => {
    // PackedInt32Array header(30)+伪长度 0xFFFFFF——攻击者形状的长度字段不能驱动分配
    const bad = Buffer.alloc(12);
    bad.writeUInt32LE(30, 0);
    bad.writeUInt32LE(0xffffff, 4);
    expect(() => decodeVariant(bad)).toThrow();
  });
});

describe('P2-1: profiler 工具接线契约', () => {
  it('PROF-a: capture_functions 注册(enum/schema/实现/风险表)', () => {
    const ts = readFileSync('src/tools/profiler-ops.ts', 'utf8');
    expect(ts.includes("'capture_functions'"), 'enum').toBe(true);
    expect(ts.includes('PROFILER_NOT_SPAWNED'), '无实例结构化错误').toBe(true);
    expect(ts.includes('captureWindow'), '一步式窗口采样').toBe(true);
    expect(ts.includes('capture_functions: \'read\''), '风险表 read').toBe(true);
  });

  it('PROF-b: run_project profiling 参数接线(--remote-debug + ctx 挂载 + close 清理)', () => {
    const rt = readFileSync('src/tools/runtime.ts', 'utf8');
    expect(rt.includes('profiling: { type: \'boolean\''), 'schema 参数').toBe(true);
    expect(rt.includes('--remote-debug'), 'spawn 传 debugger 通道').toBe(true);
    expect(rt.includes('--remote-debug'), '--remote-debug 参数').toBe(true);
    expect(rt.includes('tcp://127.0.0.1:'), '动态端口注入').toBe(true);
    expect(rt.includes('ctx.functionProfiler.close();'), 'close 清理(两处:进程退出/下次 run)', ).toBe(true);
    const types = readFileSync('src/types.ts', 'utf8');
    expect(types.includes('functionProfiler?'), 'ToolContext 字段').toBe(true);
  });

  it('PROF-c: 移植文件存在且来源标注(Erodenn 整文件)', () => {
    const fp = readFileSync('src/core/function-profiler.ts', 'utf8');
    expect(fp.includes('Erodenn-godot-mcp-runtime'), '来源标注').toBe(true);
    expect(fp.includes('export class DebuggerProfiler'), '主类').toBe(true);
    expect(fp.includes('servers:profile_frame'), '引擎协议消息').toBe(true);
  });
});

describe.skipIf(!hasGodot)('P2-1: 函数级 profiling 真引擎 e2e(短窗口)', () => {
  it('PROF-e2e: run_project(profiling) + capture_functions 返回函数级热点', async () => {
    const projectPath = resolve(__dirname, 'fixtures', 'e2e-project');
    const { DebuggerProfiler } = await import('../src/core/function-profiler.js');
    const profiler = await DebuggerProfiler.create();
    try {
      const proc = spawn(GODOT_PATH, [
        '--path', projectPath, '--debug',
        '--remote-debug', `tcp://127.0.0.1:${profiler.port}`,
      ], { stdio: 'ignore' });
      try {
        const result = await profiler.captureWindow(2, 10, 'selfMs', 128);
        expect(result.frames, '至少折入若干帧').toBeGreaterThan(0);
        expect(result.seconds, '窗口秒数 > 0').toBeGreaterThan(0);
        // 帧计时五项存在(编辑器 Frame Time 同源)
        for (const key of ['frameMs', 'processMs', 'physicsMs', 'physicsFrameMs', 'scriptMs'] as const) {
          expect(result.frame[key], `frame.${key}`).toBeDefined();
        }
      } finally {
        proc.kill();
      }
    } finally {
      profiler.close();
    }
  }, 45000);
});
