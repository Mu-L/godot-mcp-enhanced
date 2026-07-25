import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getToolDefinitions, handleTool, TOOL_META } from '../src/tools/self-update.js';
import { _resetPathAllowWarned } from '../src/core/path-utils.js';
import { isReadOnly } from '../src/core/tool-registry.js';
import { registerAllModules } from '../src/core/module-loader.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkgVersion: string = require('../package.json').version;

// 注册所有工具模块（isReadOnly 锚点需要工具已注册到 registry）
registerAllModules();

const anyCtx = {} as any;
let tmpProject: string;
const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env.GODOT_MCP_UNRESTRICTED = 'true';
  _resetPathAllowWarned();
  tmpProject = mkdtempSync(join(tmpdir(), 'su-'));
  writeFileSync(join(tmpProject, 'project.godot'), '');  // validateProjectRoot 需要
});
afterEach(() => {
  delete process.env.GODOT_MCP_UNRESTRICTED;
  _resetPathAllowWarned();
  rmSync(tmpProject, { recursive: true, force: true });
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('getToolDefinitions', () => {
  it('工具名 self_update + action enum', () => {
    const def = getToolDefinitions()[0];
    expect(def.name).toBe('self_update');
    expect((def.inputSchema as any).properties.action.enum).toEqual(['check', 'update']);
    expect((def.inputSchema as any).required).toEqual(['action']);
  });
});

describe('TOOL_META', () => {
  it('check=read / update=write', () => {
    expect(TOOL_META.self_update.actionRisks.check).toBe('read');
    expect(TOOL_META.self_update.actionRisks.update).toBe('write');
  });
});

function parse(r: any) { return JSON.parse(r.content[0].text); }

describe('handleTool check', () => {
  it('返回 npm + addons 结构，project_path 指定只查该个', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '0.24.0' }) }));
    mkdirSync(join(tmpProject, 'addons', 'godot_mcp_server'), { recursive: true });
    writeFileSync(join(tmpProject, 'addons', 'godot_mcp_server', 'plugin.cfg'),
      '[plugin]\nversion="0.22.0"\nscript="plugin.gd"');
    const r = await handleTool('self_update', { action: 'check', project_path: tmpProject }, anyCtx);
    const parsed = parse(r);
    expect(parsed.success).toBe(true);
    expect(parsed.data.npm.latest).toBe('0.24.0');
    expect(parsed.data.addons[0]).toMatchObject({
      project_path: tmpProject, installed_version: '0.22.0', installed: true, matches: false,
    });
  });

  it('未安装 addon → installed:false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '0.24.0' }) }));
    const r = await handleTool('self_update', { action: 'check', project_path: tmpProject }, anyCtx);
    const parsed = parse(r);
    expect(parsed.data.addons[0].installed).toBe(false);
    expect(parsed.data.addons[0].installed_version).toBeNull();
  });
});

describe('handleTool update', () => {
  it('降级拒绝（installed > 包版本）', async () => {
    mkdirSync(join(tmpProject, 'addons', 'godot_mcp_server'), { recursive: true });
    writeFileSync(join(tmpProject, 'addons', 'godot_mcp_server', 'plugin.cfg'),
      '[plugin]\nversion="9.9.9"\nscript="plugin.gd"');
    const r = await handleTool('self_update', { action: 'update', project_path: tmpProject }, anyCtx);
    const parsed = parse(r);
    expect(parsed.success).toBe(false);
    expect(parsed.error_code).toBe('DOWNGRADE_REFUSED');
  });

  it('null 分支（未安装）直 cp', async () => {
    const r = await handleTool('self_update', { action: 'update', project_path: tmpProject }, anyCtx);
    const parsed = parse(r);
    expect(parsed.success).toBe(true);
    expect(parsed.data.updated_from).toBeNull();
    expect(parsed.data.verifyOk).toBe(true);
  });

  it('缺 project_path 报 INVALID_PARAMS', async () => {
    const r = await handleTool('self_update', { action: 'update' }, anyCtx);
    const parsed = parse(r);
    expect(parsed.success).toBe(false);
    expect(parsed.error_code).toBe('INVALID_PARAMS');
  });

  it('未知 action 报 UNKNOWN_ACTION', async () => {
    const r = await handleTool('self_update', { action: 'bogus' }, anyCtx);
    const parsed = parse(r);
    expect(parsed.error_code).toBe('UNKNOWN_ACTION');
  });

  it('正常升级分支（installed < pkgVersion）→ updated_from/to 正确', async () => {
    // 造 plugin.cfg version="0.22.0"（< pkgVersion 0.23.0），compareVersion 不拒绝
    mkdirSync(join(tmpProject, 'addons', 'godot_mcp_server'), { recursive: true });
    writeFileSync(join(tmpProject, 'addons', 'godot_mcp_server', 'plugin.cfg'),
      `[plugin]\n\nname="MCP Server"\nversion="0.22.0"\nscript="plugin.gd"`);
    const r = await handleTool('self_update', { action: 'update', project_path: tmpProject }, anyCtx);
    const parsed = parse(r);
    expect(parsed.success).toBe(true);
    expect(parsed.data.updated_from).toBe('0.22.0');
    expect(parsed.data.updated_to).toBe(pkgVersion);
    expect(parsed.data.verifyOk).toBe(true);
  });
});

describe('self_update 注册 + readOnly 锚点', () => {
  it('isReadOnly(self_update)===false（未误标 readonly:true，避免 update 绕过 readOnly 保护）', () => {
    expect(isReadOnly('self_update')).toBe(false);
  });
});
