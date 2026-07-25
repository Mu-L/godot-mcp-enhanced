import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readEditorSecret, waitForEditorSecret } from '../src/core/editor-auth.js';

// Windows: restrictFileWindows 调 icacls 收紧+读回验证 ACL。测试 tmpdir 下 icacls 真实
// spawn 失败(ENOENT/权限)→ readEditorSecret 误返 null(非生产 bug,生产在用户项目目录正常)。
// mock execFileSync 让 ACL 验证通过,从而测 readEditorSecret/waitForEditorSecret 的读取逻辑。
// _TEST_USER 匹配 userInfo().username(Windows process.env.USERNAME = 系统用户名)。
// _execCalls 捕获所有 execFileSync args 数组,供 F3 断言 grant 调用 args[3]===username:M。
const { _TEST_USER, _execCalls } = vi.hoisted(() => ({
  _TEST_USER: process.env.USERNAME || process.env.USER || 'testuser',
  _execCalls: [],
}));
vi.mock('child_process', () => ({
  execFileSync: vi.fn((_cmd, args) => {
    if (Array.isArray(args)) _execCalls.push(args);
    return Array.isArray(args) && args.length === 1 ? `${args[0]} ${_TEST_USER}:(R)` : '';
  }),
}));

let tempDir = null;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'editor-auth-test-'));
});

afterEach(() => {
  if (tempDir) {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
    tempDir = null;
  }
});

function createSecretFile(projectPath, content) {
  const godotDir = join(projectPath, '.godot');
  mkdirSync(godotDir, { recursive: true });
  writeFileSync(join(godotDir, 'mcp_editor.key'), content, 'utf-8');
}

// ─── readEditorSecret ────────────────────────────────────────────────────────

describe('readEditorSecret', () => {
  it('returns null when file is missing', () => {
    const result = readEditorSecret(tempDir);
    expect(result).toBeNull();
  });

  it('returns content when file exists', () => {
    createSecretFile(tempDir, 'my-secret-key-123');
    const result = readEditorSecret(tempDir);
    expect(result).toBe('my-secret-key-123');
  });

  it('trims whitespace from content', () => {
    createSecretFile(tempDir, '  secret-with-spaces  \n');
    const result = readEditorSecret(tempDir);
    expect(result).toBe('secret-with-spaces');
  });

  it('returns trimmed content even with multiple lines', () => {
    createSecretFile(tempDir, '\n  key-abc  \n\n');
    const result = readEditorSecret(tempDir);
    expect(result).toBe('key-abc');
  });

  it('returns null when project path does not exist', () => {
    const result = readEditorSecret(join(tmpdir(), 'nonexistent-path-xyz-999'));
    expect(result).toBeNull();
  });

  it('returns null when .godot directory exists but key file is missing', () => {
    mkdirSync(join(tempDir, '.godot'), { recursive: true });
    const result = readEditorSecret(tempDir);
    expect(result).toBeNull();
  });
});

// ─── waitForEditorSecret ─────────────────────────────────────────────────────

describe('waitForEditorSecret', () => {
  it('returns immediately if file already exists', async () => {
    createSecretFile(tempDir, 'instant-secret');
    const result = await waitForEditorSecret(tempDir, 1000);
    expect(result).toBe('instant-secret');
  });

  it('returns null on timeout when file never appears', async () => {
    const result = await waitForEditorSecret(tempDir, 200);
    expect(result).toBeNull();
  });

  it('picks up file that appears during wait', async () => {
    // Create the file after a short delay (within the timeout window)
    const projectPath = tempDir;
    setTimeout(() => {
      createSecretFile(projectPath, 'delayed-secret');
    }, 100);

    const result = await waitForEditorSecret(projectPath, 2000);
    expect(result).toBe('delayed-secret');
  });
});

// ─── icacls grant :M 动态断言（F3，防回退 :R/:F）──────────────────────────────
// restrictFileWindows(editor-auth.ts:32)调 execFileSync('icacls', [filePath,
// '/inheritance:r', '/grant:r', `${username}:M`])——4 元素 args,args[3]=`${username}:M`。
// 触发路径:readEditorSecret → 文件存在 → checkFilePermissions → restrictFileWindows。
// 此 it 静态断言 args[3]===username:M,防后续误改 :R(只读,plugin 无法覆盖写新 secret,
// MCP 端用旧 secret auth 失败死循环)/:F(full,纵深防御降级)。详见 editor-auth.ts:26-32 注释。

// icacls 仅 Windows（restrictFileWindows 内 process.platform==='win32' guard，editor-auth.ts:55）。
// Linux CI 上 readEditorSecret 不触发 icacls → _execCalls 无 grant 调用 → 此 describe 在非 win32 skip。
describe.skipIf(process.platform !== 'win32')('icacls grant :M（防回退 :R/:F，Windows 专有）', () => {
  beforeEach(() => { _execCalls.length = 0; });

  it('ACL 收紧用 /grant:r ${username}:M（args[3] === username:M）', () => {
    createSecretFile(tempDir, 'acl-test-secret');
    readEditorSecret(tempDir);
    const grantCall = _execCalls.find(a => a.includes('/grant:r'));
    expect(grantCall).toBeDefined();                  // 必须有 grant 调用
    expect(grantCall[3]).toBe(`${_TEST_USER}:M`);     // args[3] = username:M（非 :R/:F）
  });
});

// ─── editor-auth symlink rejection (S-1 + Imp-9 Q-2) ──────────────────────────

// 探测能否创建文件 symlink(Windows 需管理员/开发者模式;Linux/macOS 普通用户可)。
// 模块加载时探测,供 describe.skipIf 静态判断——不支持的平台整个 describe 跳过,不误报。
let _symlinkProbeDir;
let SYMLINK_SUPPORTED = false;
try {
  _symlinkProbeDir = mkdtempSync(join(tmpdir(), 'sym-probe-'));
  const _t = join(_symlinkProbeDir, 't');
  const _l = join(_symlinkProbeDir, 'l');
  writeFileSync(_t, 'x');
  symlinkSync(_t, _l);  // 文件 symlink(mcp_editor.key 是文件,不能用 junction)
  SYMLINK_SUPPORTED = true;
} catch {
  // 平台不支持文件 symlink(如 Windows 未开启开发者模式)——describe 整体跳过
} finally {
  try { if (_symlinkProbeDir) rmSync(_symlinkProbeDir, { recursive: true, force: true }); } catch { /* best effort */ }
}

describe.skipIf(!SYMLINK_SUPPORTED)('editor-auth symlink rejection (S-1 + Imp-9 Q-2)', () => {
  const createSymlinkedSecret = (projectPath, content) => {
    // mcp_editor.key 作为 symlink 指向权限正常的目标文件(模拟攻击者把 key 指向任意可读文件,
    // 绕过 checkFilePermissions:statSync follow symlink 看到目标权限可能 OK)。
    const target = join(projectPath, 'secret-target');
    writeFileSync(target, content);
    mkdirSync(join(projectPath, '.godot'), { recursive: true });
    symlinkSync(target, join(projectPath, '.godot', 'mcp_editor.key'));
  };

  it('readEditorSecret rejects symlinked secret file (Imp-9)', () => {
    createSymlinkedSecret(tempDir, 'symlinked-secret');
    expect(readEditorSecret(tempDir)).toBeNull();
  });

  it('waitForEditorSecret rejects symlinked secret file (S-1)', async () => {
    createSymlinkedSecret(tempDir, 'symlinked-secret-wait');
    const result = await waitForEditorSecret(tempDir, 1000);
    expect(result).toBeNull();
  });
});
