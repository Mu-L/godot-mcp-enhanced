import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// CMP-1 (2026-08-08): editor 项目匹配检查——连接建立后校验 editor 对应的项目根。
// 安全护栏:防跨项目误操作(A 项目开 editor + MCP 配 B 项目 → 拿 A 场景树当 B 操作)。
//
// 2026-08-14 P1: editor 连接逻辑从 GodotServer 抽到 EditorConnectionManager,字面量契约
// 断言目标同步迁移。测试分两部分:
// 1. EditorConnectionManager 字面量契约(集成层 mock 成本高,对齐 degrade 模式)
// 2. normalizeForCompare 纯函数单元测试(跨平台路径归一化)

describe('CMP-1: editor 项目匹配检查（源码字面量契约）', () => {
  const src = readFileSync('src/core/EditorConnectionManager.ts', 'utf8');

  // 定位 establish 函数体切片
  function establishSlice(): string {
    const start = src.indexOf('private async establish');
    expect(start, '未找到 establish 方法').toBeGreaterThan(-1);
    const nextPrivate = src.indexOf('\n  private ', start + 10);
    return nextPrivate > 0 ? src.slice(start, nextPrivate) : src.slice(start, start + 4000);
  }

  it('CMP-1a: establish 在 connect() 成功后调用 verifyProject()', () => {
    const body = establishSlice();
    // A-2 (2026-08-14): establish 改用局部 conn 引用(条件清理防误清并发新 conn)
    const connectIdx = body.indexOf('await conn.connect()');
    expect(connectIdx, '未找到 conn.connect() 调用').toBeGreaterThan(-1);
    const verifyIdx = body.indexOf('verifyProject()');
    expect(verifyIdx, '未找到 verifyProject() 调用').toBeGreaterThan(-1);
    // 校验必须在 connect 之后
    expect(verifyIdx, 'verifyProject() 必须在 connect() 之后调用').toBeGreaterThan(connectIdx);
    // 校验必须在 executor 接线之前(B-T3 hm 构造前)
    const executorIdx = body.indexOf('new EditorToolExecutor');
    expect(executorIdx, '未找到 EditorToolExecutor 构造').toBeGreaterThan(-1);
    expect(verifyIdx, 'verifyProject() 必须在 EditorToolExecutor 构造之前').toBeLessThan(executorIdx);
  });

  it('CMP-1b: 校验失败时 disconnect + 清 conn + 返回 connected:false', () => {
    const body = establishSlice();
    const verifyIdx = body.indexOf('verifyProject()');
    const slice = body.slice(verifyIdx, verifyIdx + 600);
    // 失败分支必须 disconnect(防泄露连接)
    expect(/disconnect\(\)/.test(slice), '校验失败分支缺少 disconnect()').toBe(true);
    // 清 conn = null
    expect(/this\.conn\s*=\s*null/.test(slice), '校验失败分支缺少 conn = null').toBe(true);
    // 返回 connected: false
    expect(/connected:\s*false/.test(slice), '校验失败分支缺少 connected: false').toBe(true);
    // detail 含 "mismatch"
    expect(/mismatch/i.test(slice), '校验失败分支 detail 缺少 "mismatch"').toBe(true);
  });

  it('CMP-1c: verifyProject 方法存在且处理 projectPath=null 跳过', () => {
    const verifyStart = src.indexOf('private async verifyProject');
    expect(verifyStart, '未找到 verifyProject 方法定义').toBeGreaterThan(-1);
    // 截到下一个 private 方法
    const nextPrivate = src.indexOf('\n  private ', verifyStart + 10);
    const slice = nextPrivate > 0 ? src.slice(verifyStart, nextPrivate) : src.slice(verifyStart, verifyStart + 2000);
    // projectPath === null → ok: true(跳过校验)
    expect(
      /projectPath\s*===\s*null/.test(slice),
      'verifyProject 未处理 projectPath===null 跳过分支',
    ).toBe(true);
    // 发 editor_get_project_path RPC
    expect(
      /editor_get_project_path/.test(slice),
      'verifyProject 未发 editor_get_project_path RPC',
    ).toBe(true);
  });

  it('CMP-1d: rebuild 复用 establish(校验覆盖 rebuild 路径)', () => {
    // rebuild 调 establish,校验自动覆盖,无需重复。
    // A-2 (2026-08-14): rebuild 加 in-flight 去重锁(非 async,返回共享 Promise)后委托
    // _doRebuild,establish 调用移入 _doRebuild —— 切到 establish 定义为止应包含复用调用。
    const rebuildStart = src.indexOf('rebuild(): Promise<');
    expect(rebuildStart, '未找到 rebuild 方法').toBeGreaterThan(-1);
    const establishStart = src.indexOf('\n  private async establish', rebuildStart);
    const slice = src.slice(rebuildStart, establishStart > 0 ? establishStart : rebuildStart + 2000);
    expect(
      /this\.establish\(/.test(slice),
      'rebuild 未复用 establish(校验不覆盖 rebuild)',
    ).toBe(true);
  });
});

describe('CMP-1: normalizeForCompare 跨平台路径归一化', () => {
  // normalizeForCompare 随 editor 连接逻辑移到 EditorConnectionManager(模块级私有)。
  const src = readFileSync('src/core/EditorConnectionManager.ts', 'utf8');

  it('CMP-1e: normalizeForCompare 函数定义存在', () => {
    expect(
      /function\s+normalizeForCompare\s*\(/.test(src),
      '未找到 normalizeForCompare 函数定义',
    ).toBe(true);
  });

  it('CMP-1f: 归一化处理反斜杠→正斜杠 + 去尾部分隔符', () => {
    const fnStart = src.indexOf('function normalizeForCompare');
    const slice = src.slice(fnStart, fnStart + 400);
    expect(slice.includes('/\\\\/g'), 'normalizeForCompare 缺少反斜杠→正斜杠替换 (replace(/\\/g, ...))').toBe(true);
    expect(slice.includes("/\\/+$/"), 'normalizeForCompare 缺少去尾部分隔符 (replace(/\\/+$/, ...))').toBe(true);
  });

  it('CMP-1g: 归一化处理 Windows 大小写不敏感(win32 → lowerCase)', () => {
    const fnStart = src.indexOf('function normalizeForCompare');
    const slice = src.slice(fnStart, fnStart + 500);
    expect(/win32/.test(slice), 'normalizeForCompare 缺少 win32 平台判断').toBe(true);
    expect(/toLowerCase/.test(slice), 'normalizeForCompare 缺少 toLowerCase(Windows 大小写归一化)').toBe(true);
  });

  it('CMP-1g2 (NIT-3): verifyProject 字面比对不等时做 safeRealPath 二次归一化', () => {
    // 防 junction/symlink 启动 editor 致两端返回不同表示
    const verifyStart = src.indexOf('private async verifyProject');
    const nextPrivate = src.indexOf('\n  private ', verifyStart + 10);
    const slice = nextPrivate > 0 ? src.slice(verifyStart, nextPrivate) : src.slice(verifyStart, verifyStart + 2000);
    expect(/safeRealPath/.test(slice), 'verifyProject 缺少 safeRealPath 二次归一化(NIT-3 junction 防御)').toBe(true);
  });

  it('CMP-1g3 (NIT-1): addOnReconnectHandler 包含 verifyProject 重校验', () => {
    // 自动重连后需重新校验项目匹配(editor 可能换项目)
    const recIdx = src.indexOf('addOnReconnectHandler(');
    expect(recIdx, '未找到 addOnReconnectHandler 接线').toBeGreaterThan(-1);
    const slice = src.slice(recIdx, recIdx + 600);
    expect(/verifyProject/.test(slice), 'addOnReconnectHandler 缺少 verifyProject 重校验(NIT-1 自动重连盲区)').toBe(true);
    expect(/handleStall/.test(slice), 'addOnReconnectHandler 重校验失败缺少 handleStall 降级').toBe(true);
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
