import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// CMP-1 (2026-08-08): editor 项目匹配检查——连接建立后校验 editor 对应的项目根。
// 安全护栏:防跨项目误操作(A 项目开 editor + MCP 配 B 项目 → 拿 A 场景树当 B 操作)。
//
// 测试分两部分:
// 1. GodotServer 集成层字面量契约(对齐 godot-server-degrade.test.ts 模式,集成层 mock 成本高)
// 2. normalizeForCompare 纯函数单元测试(跨平台路径归一化)

describe('CMP-1: editor 项目匹配检查（源码字面量契约）', () => {
  const src = readFileSync('src/GodotServer.ts', 'utf8');

  // 定位 establishEditorConnection 函数体切片
  function establishSlice(): string {
    const start = src.indexOf('private async establishEditorConnection');
    expect(start, '未找到 establishEditorConnection 方法').toBeGreaterThan(-1);
    const nextPrivate = src.indexOf('\n  private ', start + 10);
    return nextPrivate > 0 ? src.slice(start, nextPrivate) : src.slice(start, start + 4000);
  }

  it('CMP-1a: establishEditorConnection 在 connect() 成功后调用 verifyEditorProject()', () => {
    const body = establishSlice();
    const connectIdx = body.indexOf('await this.editorConn.connect()');
    expect(connectIdx, '未找到 editorConn.connect() 调用').toBeGreaterThan(-1);
    const verifyIdx = body.indexOf('verifyEditorProject()');
    expect(verifyIdx, '未找到 verifyEditorProject() 调用').toBeGreaterThan(-1);
    // 校验必须在 connect 之后
    expect(verifyIdx, 'verifyEditorProject() 必须在 connect() 之后调用').toBeGreaterThan(connectIdx);
    // 校验必须在 executor 接线之前(B-T3 hm 构造前)
    const executorIdx = body.indexOf('new EditorToolExecutor');
    expect(executorIdx, '未找到 EditorToolExecutor 构造').toBeGreaterThan(-1);
    expect(verifyIdx, 'verifyEditorProject() 必须在 EditorToolExecutor 构造之前').toBeLessThan(executorIdx);
  });

  it('CMP-1b: 校验失败时 disconnect + 清 editorConn + 返回 connected:false', () => {
    const body = establishSlice();
    const verifyIdx = body.indexOf('verifyEditorProject()');
    const slice = body.slice(verifyIdx, verifyIdx + 600);
    // 失败分支必须 disconnect(防泄露连接)
    expect(/disconnect\(\)/.test(slice), '校验失败分支缺少 disconnect()').toBe(true);
    // 清 editorConn = null
    expect(/this\.editorConn\s*=\s*null/.test(slice), '校验失败分支缺少 editorConn = null').toBe(true);
    // 返回 connected: false
    expect(/connected:\s*false/.test(slice), '校验失败分支缺少 connected: false').toBe(true);
    // detail 含 "mismatch"
    expect(/mismatch/i.test(slice), '校验失败分支 detail 缺少 "mismatch"').toBe(true);
  });

  it('CMP-1c: verifyEditorProject 方法存在且处理 editorProjectPath=null 跳过', () => {
    const verifyStart = src.indexOf('private async verifyEditorProject');
    expect(verifyStart, '未找到 verifyEditorProject 方法定义').toBeGreaterThan(-1);
    // 截到下一个 private 方法
    const nextPrivate = src.indexOf('\n  private ', verifyStart + 10);
    const slice = nextPrivate > 0 ? src.slice(verifyStart, nextPrivate) : src.slice(verifyStart, verifyStart + 2000);
    // editorProjectPath === null → ok: true(跳过校验)
    expect(
      /editorProjectPath\s*===\s*null/.test(slice),
      'verifyEditorProject 未处理 editorProjectPath===null 跳过分支',
    ).toBe(true);
    // 发 editor_get_project_path RPC
    expect(
      /editor_get_project_path/.test(slice),
      'verifyEditorProject 未发 editor_get_project_path RPC',
    ).toBe(true);
  });

  it('CMP-1d: rebuildEditorConnection 间接复用 establishEditorConnection(校验覆盖 rebuild 路径)', () => {
    // rebuild 调 establishEditorConnection,校验自动覆盖,无需重复
    const rebuildStart = src.indexOf('private async rebuildEditorConnection');
    expect(rebuildStart, '未找到 rebuildEditorConnection 方法').toBeGreaterThan(-1);
    const slice = src.slice(rebuildStart, rebuildStart + 800);
    expect(
      /this\.establishEditorConnection\(/.test(slice),
      'rebuildEditorConnection 未复用 establishEditorConnection(校验不覆盖 rebuild)',
    ).toBe(true);
  });
});

describe('CMP-1: normalizeForCompare 跨平台路径归一化', () => {
  // normalizeForCompare 是模块级私有函数,不导出。
  // 通过源码字面量验证关键归一化逻辑存在(反斜杠替换 + 去尾分隔符 + win32 lowerCase)。
  const src = readFileSync('src/GodotServer.ts', 'utf8');

  it('CMP-1e: normalizeForCompare 函数定义存在', () => {
    expect(
      /function\s+normalizeForCompare\s*\(/.test(src),
      '未找到 normalizeForCompare 函数定义',
    ).toBe(true);
  });

  it('CMP-1f: 归一化处理反斜杠→正斜杠 + 去尾部分隔符', () => {
    const fnStart = src.indexOf('function normalizeForCompare');
    const slice = src.slice(fnStart, fnStart + 400);
    // 反斜杠→正斜杠:源码含 replace(/\\/g, '/') 字面(正则字面量)
    expect(slice.includes('/\\\\/g'), 'normalizeForCompare 缺少反斜杠→正斜杠替换 (replace(/\\/g, ...))').toBe(true);
    // 去尾部分隔符:源码含 replace(/\/+$/, '') 字面(正则字面量匹配尾部斜杠)
    expect(slice.includes("/\\/+$/"), 'normalizeForCompare 缺少去尾部分隔符 (replace(/\\/+$/, ...))').toBe(true);
  });

  it('CMP-1g: 归一化处理 Windows 大小写不敏感(win32 → lowerCase)', () => {
    const fnStart = src.indexOf('function normalizeForCompare');
    const slice = src.slice(fnStart, fnStart + 500);
    // win32 平台判断
    expect(/win32/.test(slice), 'normalizeForCompare 缺少 win32 平台判断').toBe(true);
    // lowerCase
    expect(/toLowerCase/.test(slice), 'normalizeForCompare 缺少 toLowerCase(Windows 大小写归一化)').toBe(true);
  });

  it('CMP-1g2 (NIT-3): verifyEditorProject 字面比对不等时做 safeRealPath 二次归一化', () => {
    // 防 junction/symlink 启动 editor 致两端返回不同表示
    const verifyStart = src.indexOf('private async verifyEditorProject');
    const nextPrivate = src.indexOf('\n  private ', verifyStart + 10);
    const slice = nextPrivate > 0 ? src.slice(verifyStart, nextPrivate) : src.slice(verifyStart, verifyStart + 2000);
    expect(/safeRealPath/.test(slice), 'verifyEditorProject 缺少 safeRealPath 二次归一化(NIT-3 junction 防御)').toBe(true);
  });

  it('CMP-1g3 (NIT-1): addOnReconnectHandler 包含 verifyEditorProject 重校验', () => {
    // 自动重连后需重新校验项目匹配(editor 可能换项目)
    const recIdx = src.indexOf('addOnReconnectHandler(');
    expect(recIdx, '未找到 addOnReconnectHandler 接线').toBeGreaterThan(-1);
    const slice = src.slice(recIdx, recIdx + 600);
    expect(/verifyEditorProject/.test(slice), 'addOnReconnectHandler 缺少 verifyEditorProject 重校验(NIT-1 自动重连盲区)').toBe(true);
    expect(/handleEditorStall/.test(slice), 'addOnReconnectHandler 重校验失败缺少 handleEditorStall 降级').toBe(true);
  });
});

// ─── GD 侧 RPC 契约 ───────────────────────────────────────────────────────────
describe('CMP-1: GD 侧 editor_get_project_path RPC 契约', () => {
  it('CMP-1h: command_handler.gd handle() 注册 editor_get_project_path', () => {
    const gd = readFileSync('addons/godot_mcp_server/command_handler.gd', 'utf8');
    expect(
      /"editor_get_project_path"/.test(gd),
      'command_handler.gd 未注册 editor_get_project_path method',
    ).toBe(true);
    // 返回 project_path 字段
    expect(
      /project_path/.test(gd.match(/"editor_get_project_path"[\s\S]*?return[\s\S]*?\}/)?.[0] ?? ''),
      'editor_get_project_path 未返回 project_path 字段',
    ).toBe(true);
    // 用 ProjectSettings.globalize_path("res://")(不依赖 EditorInterface/打开场景)
    const rpcSlice = gd.match(/"editor_get_project_path"[\s\S]*?return\s*\{[^}]*\}/)?.[0] ?? '';
    expect(
      /globalize_path\(["']res:\/\/["']\)/.test(rpcSlice),
      'editor_get_project_path 未用 ProjectSettings.globalize_path("res://")',
    ).toBe(true);
  });
});
