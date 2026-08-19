// test/uid-ops.test.ts — P1-1 UID 工具契约测试(生成器内容 + 参数校验)
// handler 的 Godot 执行路径依赖真 Godot 进程,本文件测 TS 侧全部校验分支与生成脚本结构;
// 生成脚本的 GD 侧行为由 e2e/实测覆盖(对齐 signal-ops.test.js 模式)。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { isolatePathEnv } from './helpers/path-isolation.js';

vi.mock('../src/gdscript-executor.js', () => ({
  executeGdscript: vi.fn(async () => ({
    success: true, compile_success: true, run_success: true,
    stdout: '___MCP_RESULT___{"success": true, "outputs": []}',
    stderr: '', exitCode: 0, timedOut: false,
  })),
  // I-2(2026-08-19 审查):uid-ops 实际 import 的是 executeGdscriptTrusted——
  // mock 工厂缺此导出曾致正向路径零接线(校验层用例全不走执行器)
  executeGdscriptTrusted: vi.fn(async (opts: { code: string }) => ({
    success: true, compile_success: true, run_success: true,
    outputs: [{ key: 'scan', value: JSON.stringify({ total_resources: 0, with_uid: 0, missing_count: 0, missing: [], orphan_count: 0, orphans: [] }) }],
    stdout: '___MCP_RESULT___{"success": true, "outputs": []}',
    stderr: '', exitCode: 0, timedOut: false,
    _seenCode: opts.code,
  })),
  scanGdscriptSandbox: vi.fn(() => []),
}));

import { executeGdscriptTrusted } from '../src/gdscript-executor.js';
import {
  getToolDefinitions, TOOL_META,
  genUidScanScript, genUidGetScript, genUidSetScript, genUidCheckRefsScript,
  DEFAULT_UID_EXTENSIONS, handleTool,
} from '../src/tools/uid-ops.js';

function makeCtx() {
  return {
    findGodot: vi.fn(async () => '/usr/bin/godot'),
  } as unknown as Parameters<typeof handleTool>[2];
}

// ─── getToolDefinitions / TOOL_META 契约 ────────────────────────────────────

describe('uid-ops 契约', () => {
  it('returns 1 tool named "uid"', () => {
    const defs = getToolDefinitions();
    expect(defs.length).toBe(1);
    expect(defs[0]!.name).toBe('uid');
  });

  it('action enum contains all 4 actions', () => {
    const actionEnum = getToolDefinitions()[0]!.inputSchema.properties.action.enum;
    expect(actionEnum).toEqual(['uid_scan', 'uid_get', 'uid_set', 'uid_check_refs']);
  });

  it('TOOL_META risk: scan/get/check_refs read, set write', () => {
    const risks = TOOL_META.uid!.actionRisks!;
    expect(risks.uid_scan).toBe('read');
    expect(risks.uid_get).toBe('read');
    expect(risks.uid_set).toBe('write');
    expect(risks.uid_check_refs).toBe('read');
  });

  it('default extensions cover Godot 4.4 common resource types', () => {
    for (const ext of ['tscn', 'tres', 'gd', 'gdshader', 'png', 'svg', 'glb']) {
      expect(DEFAULT_UID_EXTENSIONS).toContain(ext);
    }
    expect(DEFAULT_UID_EXTENSIONS).not.toContain('uid'); // .uid 本身不是被管理对象
  });
});

// ─── 生成器内容断言 ──────────────────────────────────────────────────────────

describe('genUidScanScript', () => {
  it('contains walk/read helpers and scan summary keys', () => {
    const s = genUidScanScript(['tscn', 'gd'], ['.godot'], 50);
    expect(s).toContain('func _mcp_walk');
    expect(s).toContain('func _mcp_read_uid');
    expect(s).toContain('"missing_count"');
    expect(s).toContain('"orphan_count"');
    expect(s).toContain('"res://"');
    expect(s).toContain('slice(0, 50)');
  });

  it('embeds extensions as GD Dictionary set', () => {
    const s = genUidScanScript(['tscn'], [], 10);
    expect(s).toContain('{"tscn": true}');
  });
});

describe('genUidGetScript', () => {
  it('embeds requested paths', () => {
    const s = genUidGetScript(['res://icon.svg', 'res://scenes/main.tscn']);
    expect(s).toContain('"res://icon.svg"');
    expect(s).toContain('"res://scenes/main.tscn"');
    expect(s).toContain('"not_found"');
  });

  it('escapes quotes in paths (防 GD 字符串注入)', () => {
    const s = genUidGetScript(['res://a\\"b.gd']);
    expect(s).not.toMatch(/res:\/\/a"b\.gd/); // 原样引号不应出现
  });
});

describe('genUidSetScript', () => {
  it('mode path+uid: validates via text_to_id and writes specified uid', () => {
    const s = genUidSetScript({ path: 'res://a.tscn', uid: 'uid://abc123', extensions: ['tscn'], skipDirs: [] });
    expect(s).toContain('ResourceUID.text_to_id');
    expect(s).toContain('"uid://abc123"');
    expect(s).toContain('INVALID_ID');
    expect(s).not.toContain('create_id_for_path');
  });

  it('mode path only: generates via create_id_for_path', () => {
    const s = genUidSetScript({ path: 'res://a.tscn', extensions: ['tscn'], skipDirs: [] });
    expect(s).toContain('ResourceUID.create_id_for_path');
    expect(s).toContain('"generated": true');
  });

  it('mode fix_missing: walks project and skips existing .uid', () => {
    const s = genUidSetScript({ fixMissing: true, extensions: ['tscn'], skipDirs: ['.godot'] });
    expect(s).toContain('_mcp_walk("res://"');
    expect(s).toContain('if _mcp_read_uid(res_path) != "":');
    expect(s).toContain('"fixed_count"');
  });
});

describe('genUidCheckRefsScript', () => {
  it('compiles uid:// regex and reports dangling refs', () => {
    const s = genUidCheckRefsScript(['.godot'], 20);
    expect(s).toContain('re.compile("uid://[0-9a-z]+")');
    expect(s).toContain('"dangling_count"');
    expect(s).toContain('"known_uids"');
  });
});

// ─── handler 参数校验(负向:校验在执行前抛,不依赖 Godot) ───────────────────

describe('uid handler 参数校验', () => {
  let tmpProj: string;
  let restore: () => void;

  beforeEach(() => {
    tmpProj = mkdtempSync(join(tmpdir(), 'uid-ops-test-'));
    writeFileSync(join(tmpProj, 'project.godot'), '[application]\n');
    restore = isolatePathEnv({ allowed: [tmpProj] });
  });
  afterEach(() => {
    restore();
    rmSync(tmpProj, { recursive: true, force: true });
  });

  const parseResult = async (r: { content: { type: string; text?: string }[] }) => {
    const text = Array.isArray(r.content) ? r.content[0]?.text ?? '' : '';
    return JSON.parse(text);
  };

  it('rejects invalid uid text format', async () => {
    const r = await handleTool('uid', {
      action: 'uid_set', project_path: tmpProj,
      path: 'res://a.tscn', uid: 'not-a-uid',
    }, makeCtx());
    const parsed = await parseResult(r!);
    expect(parsed.success).toBe(false);
    expect(parsed.error_code).toBe('INVALID_UID');
  });

  it('rejects fix_missing combined with path', async () => {
    const r = await handleTool('uid', {
      action: 'uid_set', project_path: tmpProj,
      path: 'res://a.tscn', fix_missing: true,
    }, makeCtx());
    const parsed = await parseResult(r!);
    expect(parsed.success).toBe(false);
    expect(parsed.error_code).toBe('INVALID_PARAMS');
  });

  it('rejects uid_get without paths array', async () => {
    const r = await handleTool('uid', {
      action: 'uid_get', project_path: tmpProj, paths: 'res://a.gd',
    }, makeCtx());
    const parsed = await parseResult(r!);
    expect(parsed.success).toBe(false);
    expect(parsed.error_code).toBe('INVALID_PARAMS');
  });

  it('rejects path traversal in uid_get paths', async () => {
    const r = await handleTool('uid', {
      action: 'uid_get', project_path: tmpProj, paths: ['res://../outside.gd'],
    }, makeCtx());
    const parsed = await parseResult(r!);
    expect(parsed.success).toBe(false);
    expect(parsed.error_code).toBe('INVALID_PARAMS');
  });

  it('rejects bad extension entries', async () => {
    const r = await handleTool('uid', {
      action: 'uid_scan', project_path: tmpProj, extensions: ['tscn', '../evil'],
    }, makeCtx());
    const parsed = await parseResult(r!);
    expect(parsed.success).toBe(false);
    expect(parsed.error_code).toBe('SCRIPT_EXEC_FAILED'); // throw 被外层 catch 归类
    expect(parsed.error).toContain('alphanumeric');
  });

  it('rejects limit out of range', async () => {
    const r = await handleTool('uid', {
      action: 'uid_scan', project_path: tmpProj, limit: 999,
    }, makeCtx());
    const parsed = await parseResult(r!);
    expect(parsed.success).toBe(false);
  });

  it('rejects unknown action', async () => {
    const r = await handleTool('uid', {
      action: 'uid_delete', project_path: tmpProj,
    }, makeCtx());
    const parsed = await parseResult(r!);
    expect(parsed.success).toBe(false);
    expect(parsed.error_code).toBe('UNKNOWN_ACTION');
  });

  it('returns null for other tool names', async () => {
    expect(await handleTool('signal', {}, makeCtx())).toBeNull();
  });

  // I-2:正向接线——校验层用例不走执行器,此用例锁定 handler↔executeGdscriptTrusted↔
  // parseGdscriptResult 真接线(删 handler 的执行调用必红)
  it('uid_scan 正向走到 executeGdscriptTrusted 且结果经 parseGdscriptResult', async () => {
    const trusted = vi.mocked(executeGdscriptTrusted);
    trusted.mockClear();
    const r = await handleTool('uid', { action: 'uid_scan', project_path: tmpProj }, makeCtx());
    expect(trusted).toHaveBeenCalledTimes(1);
    const call = trusted.mock.calls[0]![0] as unknown as { code: string; projectPath: string; loadAutoloads: boolean };
    expect(call.code).toContain('_mcp_walk');            // 生成脚本真传入
    expect(call.code).toContain('"missing_count"');
    expect(call.projectPath).toBe(tmpProj);
    expect(call.loadAutoloads).toBe(false);               // 文件层操作不加载 autoload
    const parsed = await parseResult(r!);
    expect(parsed.success).toBe(true);                    // outputs[{key:'scan'}] → data.scan
    expect(parsed.data.scan.total_resources).toBe(0);     // JSON.parse 解回结构
  });
});
