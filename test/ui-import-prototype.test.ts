// test/ui-import-prototype.test.ts
// Task 2 TDD:ui_import_prototype 接线(spec docs/superpowers/specs/2026-08-16-prototype-import-design.md §2.3)。
// mock executeGdscriptTrusted 两段返回(先 build 后 measure,spec 开放问题 3 首版两次 spawn 方案),
// 断言:一次调用返回 {tree, build_warnings, measure, verify_coverage, layout_verify};
// geometry/geometry_path 二选一语义;路径逃逸拒绝;ACTIONS/TOOL_META/UI_PERSIST_ACTIONS 登记契约。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockSuccessResult } from './helpers/mock-results.js';
import { isolatePathEnv } from './helpers/path-isolation.js';

// vi.mock 提升优先于 import,共享 mock 引用须经 vi.hoisted(参照 test/android.test.ts 模式)
const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }));
vi.mock('../src/gdscript-executor.js', () => ({
  executeGdscript: vi.fn(),
  executeGdscriptTrusted: execMock,
}));

import { executeGdscriptTrusted } from '../src/gdscript-executor.js';
import { handleTool, TOOL_META, getToolDefinitions } from '../src/tools/ui/index.js';
import { ACTIONS } from '../src/tools/ui/types.js';
import { SLIM_CONFIG } from '../src/core/module-loader.js';
import type { ToolResult } from '../src/types.js';

// ─── fixtures ──────────────────────────────────────────────────────────────

// 两节点嵌套:Title(10,20,200,24) 完整落在 TopBar(0,0,800,60) 内 → 父子。
const GEO = {
  viewport: { w: 800, h: 600 },
  nodes: [
    { name: 'TopBar', rect: { x: 0, y: 0, w: 800, h: 60 }, bg: '#10141f' },
    { name: 'Title', rect: { x: 10, y: 20, w: 200, h: 24 }, text: '标题' },
  ],
};

// build 执行成功输出(genUiBuildLayoutScript 产物:layout_built + persist + 可选 warnings)
function buildOutputs() {
  return [
    { key: 'layout_built', value: JSON.stringify({ parent: '/root', root_type: 'Panel', root_name: '_PrototypeRoot' }) },
    { key: 'persist', value: JSON.stringify({ saved: true }) },
  ];
}

// measure 执行成功输出(genUiMeasureScript 产物;rect 与翻译树精确一致 → diff 全绿)。
// path 形态:measure nodePath=/root(挂载父)时 get_path_to 相对场景根 = 树根名链,
// 与 flattenTargets(tree) 的 '_PrototypeRoot/...' 恰好对齐(expect_tree 注入段同款对齐前提)。
function measureOutputs(dOffset = 0) {
  return [{
    key: 'measure',
    value: JSON.stringify({
      stable_after_frames: 3,
      stalled: false,
      viewport: { w: 800, h: 600 },
      nodes: [
        { path: '_PrototypeRoot', type: 'Panel', rect: { x: 0, y: 0, w: 800, h: 600 } },
        { path: '_PrototypeRoot/TopBar', type: 'Panel', rect: { x: 0, y: 0, w: 800, h: 60 } },
        { path: '_PrototypeRoot/TopBar/Title', type: 'Label', rect: { x: 10 + dOffset, y: 20, w: 200, h: 24 } },
      ],
    }),
  }];
}

/** 两段 mock:第一次 build,第二次 measure。返回 executor 调用参数记录。 */
function mockTwoPhase(dOffset = 0) {
  execMock.mockReset();
  execMock.mockResolvedValueOnce(mockSuccessResult({ outputs: buildOutputs() }));
  execMock.mockResolvedValueOnce(mockSuccessResult({ outputs: measureOutputs(dOffset) }));
}

function textOf(result: ToolResult | null, index = 0): string {
  const el = result?.content?.[index];
  if (!el || el.type !== 'text') throw new Error(`content[${index}] is not text`);
  return el.text;
}

function createCtx() {
  return {
    opsScript: '/fake/ops.gd',
    findGodot: vi.fn(async () => '/fake/godot'),
    runningProcess: null, setRunningProcess: vi.fn(),
    outputBuffer: [], setOutputBuffer: vi.fn(),
    processStartTime: 0, setProcessStartTime: vi.fn(),
    projectDir: '/fake/project', setProjectDir: vi.fn(),
    parseGodotConfig: vi.fn(() => ({})),
  } as never;
}

// ─── 正常链路:inline geometry 一次调用翻译+build+measure+verify ──────────────

describe('ui_import_prototype 正常链路(inline geometry)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('返回 data 含 tree/build_warnings/measure/verify_coverage/layout_verify,executor 恰两次', async () => {
    mockTwoPhase();
    const result = await handleTool('ui', {
      action: 'ui_import_prototype', project_path: '/fake/p', scene_path: 'res://scene.tscn',
      geometry: GEO,
    }, createCtx());

    expect(result).not.toBeNull();
    expect(result!.isError).toBeFalsy();
    const parsed = JSON.parse(textOf(result));
    expect(parsed.success).toBe(true);
    // tree:合成根 + 两节点
    expect(parsed.data.tree.name).toBe('_PrototypeRoot');
    expect(parsed.data.tree.children[0].name).toBe('TopBar');
    expect(parsed.data.tree.children[0].children[0].name).toBe('Title');
    // build_warnings:数组 + 容差模糊带使用提示(控制器落档项)
    expect(Array.isArray(parsed.data.build_warnings)).toBe(true);
    expect(parsed.data.build_warnings.join('\n')).toContain('2px');
    // measure:透传 measure 输出字段
    expect(parsed.data.measure.stable_after_frames).toBe(3);
    expect(parsed.data.measure.stalled).toBe(false);
    expect(parsed.data.measure.viewport).toEqual({ w: 800, h: 600 });
    // verify_coverage(B-2):targets 含合成根(2 输入 + 1 根 = 3),附 _note 语义说明
    expect(parsed.data.verify_coverage.targets).toBe(3);
    expect(parsed.data.verify_coverage.total_nodes).toBe(2);
    expect(typeof parsed.data.verify_coverage._note).toBe('string');
    // layout_verify:targets/diff 全绿/overlaps/out_of_bounds/viewport
    expect(parsed.data.layout_verify.targets).toHaveLength(3);
    expect(parsed.data.layout_verify.diff).toHaveLength(3);
    expect(parsed.data.layout_verify.diff.every((d: { ok: boolean }) => d.ok)).toBe(true);
    expect(parsed.data.layout_verify.overlaps).toEqual([]);
    expect(parsed.data.layout_verify.out_of_bounds).toEqual([]);
    expect(parsed.data.layout_verify.viewport).toEqual({ w: 800, h: 600 });

    // 两次 spawn:第一次 build(含 persist 原子写),第二次 measure(含 process_frame.connect)
    expect(execMock).toHaveBeenCalledTimes(2);
    const firstCode = execMock.mock.calls[0]![0] as { code: string };
    const secondCode = execMock.mock.calls[1]![0] as { code: string };
    expect(firstCode.code).toContain('ResourceSaver.save');
    expect(firstCode.code).toContain('_PrototypeRoot');
    expect(secondCode.code).toContain('process_frame.connect');
  });

  it('固定持久化:build 脚本含 persist 块,返回不含 "退出即丢" ⚠ 提示(不入 UI_PERSIST_ACTIONS)', async () => {
    mockTwoPhase();
    const result = await handleTool('ui', {
      action: 'ui_import_prototype', project_path: '/fake/p', scene_path: 'res://scene.tscn',
      geometry: GEO,
    }, createCtx());
    const firstCode = execMock.mock.calls[0]![0] as { code: string };
    expect(firstCode.code).toContain('persist');
    const allText = result!.content.map(el => (el.type === 'text' ? el.text : '')).join('');
    expect(allText).not.toContain('⚠');
  });

  it('tolerance 生效:偏移 3px 时默认容差 2 不绿,tolerance=5 绿', async () => {
    mockTwoPhase(3); // Title x 偏移 3px
    const r2 = await handleTool('ui', {
      action: 'ui_import_prototype', project_path: '/fake/p', scene_path: 'res://scene.tscn',
      geometry: GEO,
    }, createCtx());
    const diff2 = JSON.parse(textOf(r2)).data.layout_verify.diff as Array<{ ok: boolean }>;
    expect(diff2.find(d => !d.ok)).toBeTruthy();

    mockTwoPhase(3);
    const r5 = await handleTool('ui', {
      action: 'ui_import_prototype', project_path: '/fake/p', scene_path: 'res://scene.tscn',
      geometry: GEO, tolerance: 5,
    }, createCtx());
    const diff5 = JSON.parse(textOf(r5)).data.layout_verify.diff as Array<{ ok: boolean }>;
    expect(diff5.every(d => d.ok)).toBe(true);
  });

  it('geometry+geometry_path 同时给:geometry 优先 + warning 提示', async () => {
    mockTwoPhase();
    const result = await handleTool('ui', {
      action: 'ui_import_prototype', project_path: '/fake/p', scene_path: 'res://scene.tscn',
      geometry: GEO, geometry_path: 'res://whatever.json',
    }, createCtx());
    expect(result!.isError).toBeFalsy();
    const parsed = JSON.parse(textOf(result));
    expect(parsed.data.build_warnings.join('\n')).toContain('geometry');
    // 只两次 executor(build+measure),geometry_path 未触发额外执行
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it('measure 阶段失败:错误信息附 "build 已持久化,可重跑 ui_measure_layout" 提示', async () => {
    execMock.mockReset();
    execMock.mockResolvedValueOnce(mockSuccessResult({ outputs: buildOutputs() }));
    execMock.mockResolvedValueOnce(mockSuccessResult({ outputs: [{ key: 'error', value: 'Parent not found: /root' }] }));
    const result = await handleTool('ui', {
      action: 'ui_import_prototype', project_path: '/fake/p', scene_path: 'res://scene.tscn',
      geometry: GEO,
    }, createCtx());
    expect(result!.isError).toBe(true);
    const errObj = JSON.parse(textOf(result));
    expect(errObj.error).toContain('Parent not found');
    expect(errObj.error).toContain('build 已持久化,可重跑 ui_measure_layout');
    // 错误码映射保持(uiErrorMapper: 'not found' → NODE_NOT_FOUND),JSON 结构不被提示破坏
    expect(errObj.error_code).toBe('NODE_NOT_FOUND');
  });
});

// ─── geometry_path 文件读入 + res:// 剥离 ───────────────────────────────────

describe('ui_import_prototype geometry_path', () => {
  let tmpProj: string;
  let restore: () => void;

  beforeEach(() => {
    tmpProj = mkdtempSync(join(tmpdir(), 'ui-import-proto-'));
    writeFileSync(join(tmpProj, 'project.godot'), '[application]\nname="Test"\n');
    writeFileSync(join(tmpProj, 'geo.json'), JSON.stringify(GEO));
    // env 隔离:test/setup.js 全局 UNRESTRICTED=true,路径安全用例须清旁路 + 收白名单
    restore = isolatePathEnv({ allowed: [tmpProj] });
    vi.clearAllMocks();
  });
  afterEach(() => {
    restore();
    rmSync(tmpProj, { recursive: true, force: true });
  });

  it('相对路径读入成功', async () => {
    mockTwoPhase();
    const result = await handleTool('ui', {
      action: 'ui_import_prototype', project_path: tmpProj, scene_path: 'res://scene.tscn',
      geometry_path: 'geo.json',
    }, createCtx());
    expect(result!.isError).toBeFalsy();
    const parsed = JSON.parse(textOf(result));
    expect(parsed.data.tree.name).toBe('_PrototypeRoot');
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it('res:// 前缀被剥离,指向项目内合法文件成功', async () => {
    mockTwoPhase();
    const result = await handleTool('ui', {
      action: 'ui_import_prototype', project_path: tmpProj, scene_path: 'res://scene.tscn',
      geometry_path: 'res://geo.json',
    }, createCtx());
    expect(result!.isError).toBeFalsy();
    expect(JSON.parse(textOf(result)).data.verify_coverage.targets).toBe(3);
  });

  it('../ 逃逸 → INVALID_PARAMS,不触达 executor', async () => {
    const result = await handleTool('ui', {
      action: 'ui_import_prototype', project_path: tmpProj, scene_path: 'res://scene.tscn',
      geometry_path: '../outside/evil.json',
    }, createCtx());
    expect(result!.isError).toBe(true);
    expect(textOf(result)).toContain('INVALID_PARAMS');
    expect(textOf(result)).toMatch(/traversal|越权|非法/i);
    expect(execMock).not.toHaveBeenCalled();
  });

  it('白名单外绝对路径 → INVALID_PARAMS', async () => {
    const result = await handleTool('ui', {
      action: 'ui_import_prototype', project_path: tmpProj, scene_path: 'res://scene.tscn',
      geometry_path: join(tmpdir(), 'outside-evil.json'),
    }, createCtx());
    expect(result!.isError).toBe(true);
    expect(textOf(result)).toContain('INVALID_PARAMS');
    expect(execMock).not.toHaveBeenCalled();
  });

  it('res:// 变体逃逸(res://../) → INVALID_PARAMS', async () => {
    const result = await handleTool('ui', {
      action: 'ui_import_prototype', project_path: tmpProj, scene_path: 'res://scene.tscn',
      geometry_path: 'res://../evil.json',
    }, createCtx());
    expect(result!.isError).toBe(true);
    expect(textOf(result)).toContain('INVALID_PARAMS');
    expect(execMock).not.toHaveBeenCalled();
  });
});

// ─── 输入校验负向 ───────────────────────────────────────────────────────────

describe('ui_import_prototype 输入校验', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('geometry 与 geometry_path 都不给 → INVALID_PARAMS', async () => {
    const result = await handleTool('ui', {
      action: 'ui_import_prototype', project_path: '/fake/p', scene_path: 'res://scene.tscn',
    }, createCtx());
    expect(result!.isError).toBe(true);
    expect(textOf(result)).toContain('INVALID_PARAMS');
    expect(execMock).not.toHaveBeenCalled();
  });

  it('parseGeometry 失败(schema 违规)透传 INVALID_PARAMS + 详情', async () => {
    const result = await handleTool('ui', {
      action: 'ui_import_prototype', project_path: '/fake/p', scene_path: 'res://scene.tscn',
      geometry: { viewport: { w: 800, h: 600 }, nodes: [{ name: 'X' }] }, // 缺 rect
    }, createCtx());
    expect(result!.isError).toBe(true);
    expect(textOf(result)).toContain('INVALID_PARAMS');
    expect(textOf(result)).toContain('geometry schema');
    expect(execMock).not.toHaveBeenCalled();
  });

  it('翻译失败(交叉重叠)透传 INVALID_PARAMS,不触达 executor', async () => {
    const result = await handleTool('ui', {
      action: 'ui_import_prototype', project_path: '/fake/p', scene_path: 'res://scene.tscn',
      geometry: {
        viewport: { w: 800, h: 600 },
        nodes: [
          { name: 'A', rect: { x: 0, y: 0, w: 100, h: 50 } },
          { name: 'B', rect: { x: 50, y: 0, w: 100, h: 50 } }, // 与 A 交叉互不包含
        ],
      },
    }, createCtx());
    expect(result!.isError).toBe(true);
    expect(textOf(result)).toContain('INVALID_PARAMS');
    expect(execMock).not.toHaveBeenCalled();
  });
});

// ─── 登记契约:ACTIONS / TOOL_META / schema / SLIM_CONFIG ────────────────────

describe('ui_import_prototype 登记契约', () => {
  it('ACTIONS 数组含 ui_import_prototype', () => {
    expect(ACTIONS).toContain('ui_import_prototype');
  });

  it('schema action enum 含 ui_import_prototype,且声明 geometry/geometry_path/tolerance', () => {
    const defs = getToolDefinitions();
    const schema = defs[0]!.inputSchema as { properties: Record<string, unknown> };
    expect((schema.properties.action as { enum: string[] }).enum).toContain('ui_import_prototype');
    expect(schema.properties.geometry).toBeTruthy();
    expect(schema.properties.geometry_path).toBeTruthy();
    expect(schema.properties.tolerance).toBeTruthy();
  });

  it('TOOL_META actionRisks: ui_import_prototype 为 write(satisfies 护卫)', () => {
    expect(TOOL_META.ui!.actionRisks!.ui_import_prototype).toBe('write');
  });

  it('SLIM_CONFIG: geometry/geometry_path 进 removeProps,descHint 提及新 action', () => {
    const cfg = SLIM_CONFIG['ui']!;
    expect(cfg.removeProps).toContain('geometry');
    expect(cfg.removeProps).toContain('geometry_path');
    expect(cfg.descHint).toContain('ui_import_prototype');
  });
});
