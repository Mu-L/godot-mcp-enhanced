/**
 * SEC-P2-2 (2026-08-09 审查): GD 侧 secret 写 symlink 预检源码级契约。
 *
 * 缺陷背景(vault 2026-08-06 安全RCE面专项审查 SEC-P2-2):
 *   editor 侧 addons/godot_mcp_server/websocket_server.gd 与 bridge 侧 src/scripts/mcp_bridge.gd
 *   写 secret 时,Windows 用 PowerShell [IO.File]::WriteAllText,Linux/macOS 用 FileAccess.open,
 *   三者均 follow symlink —— 攻击者预置 .godot/mcp_editor.key(或 mcp_bridge.key)为 symlink
 *   指向任意文件,写操作会覆盖被指向文件。读方(TS editor-auth.ts:77 + game-bridge.ts)已有
 *   lstatSync 兜底(命中 symlink 降级),此处写方对称加固。
 *
 * 测试模式说明(对齐 batch-add-nodes-orphan-guard.test.ts):
 *   GD 侧 OS.execute 调 PowerShell/readlink,Linux CI 无法跑(平台限制)。改用源码级契约
 *   (stripComments 后断言关键词存在),防重构回退。行为正确性靠 check:gdscript
 *   完整编译 + 两处对称 DUPLICATE 注释互引保证。
 *
 * 两处必须同步(互相标注 DUPLICATE),本测试同时覆盖两边防单边漂移。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const EDITOR_SRC = readFileSync(
  join(__dirname, '../addons/godot_mcp_server/websocket_server.gd'),
  'utf-8',
);
const BRIDGE_SRC = readFileSync(
  join(__dirname, '../src/scripts/mcp_bridge.gd'),
  'utf-8',
);

/**
 * 抽取指定函数体(从 "func <name>" 到下一个顶层 func 或文件末)。
 */
function extractFunc(src: string, funcName: string): string {
  const needle = `func ${funcName}`;
  const startIdx = src.indexOf(needle);
  if (startIdx < 0) throw new Error(`找不到函数 ${funcName}`);
  const rest = src.slice(startIdx + 1);
  const nextFunc = rest.match(/\nfunc /);
  const endIdx = nextFunc ? startIdx + 1 + nextFunc.index : src.length;
  return src.slice(startIdx, endIdx);
}

/**
 * 剥离 GDScript 行注释(# 开头,等长空格替换),防 grep 假绿。
 * 对齐 testing-lesson-grep-fake-green-triple-defense 教训。
 *
 * ⚠️ 与 batch-add-nodes-orphan-guard.test.ts 的差异:本测试只 strip 注释,**不 strip 字符串**。
 * 原因:SEC-P2-2 的 symlink 预检关键词(Test-Path/Get-Item/LinkType/exit 3/readlink)本就
 * 在 PowerShell 命令字符串字面量内(如 PackedStringArray(["...", "if (Test-Path ... exit 3)..."])),
 * 若 strip 字符串会把这些真关键词误删,致测试恒失败。只 strip 注释即可防"关键词仅在注释里
 * 造成假绿"——实际代码关键词必须在字符串里才会被执行。
 */
function stripComments(src: string): string {
  const chars = src.split('');
  let i = 0;
  const blankTo = (end: number) => {
    for (let j = i; j < end; j++) if (chars[j] !== '\n') chars[j] = ' ';
  };
  while (i < chars.length) {
    const c = chars[i];
    if (c === '#') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? chars.length : end;
      blankTo(stop);
      i = stop;
      continue;
    }
    i++;
  }
  return chars.join('');
}

describe('SEC-P2-2: GD 侧 secret 写 symlink 预检(源码级契约)', () => {
  describe('editor 侧 websocket_server.gd', () => {
    // editor 侧 secret 写逻辑内联在 _generate_and_write_secret(非独立函数),
    // 抽取整个方法体断言。
    const funcBody = extractFunc(EDITOR_SRC, '_generate_and_write_secret');
    const clean = stripComments(funcBody);

    // 等长校验(strip 实现变化时失败,防下标映射错位)
    if (clean.length !== funcBody.length) {
      throw new Error(`stripComments 改变了长度(${funcBody.length}→${clean.length})`);
    }

    it('Windows 分支含 symlink 预检(Test-Path + Get-Item LinkType + exit 3)', () => {
      // PowerShell 复合表达式:if (Test-Path) { if LinkType { exit 3 } }; WriteAllText
      expect(clean).toMatch(/Test-Path/);
      expect(clean).toMatch(/Get-Item/);
      expect(clean).toMatch(/LinkType/);
      expect(clean).toMatch(/exit\s*3/);
    });

    it('Linux/macOS 分支含 readlink symlink 预检', () => {
      expect(clean).toMatch(/readlink/);
    });

    it('symlink 命中后清空 _secret 禁 WS 启动(editor 侧语义)', () => {
      // editor 侧 symlink 命中后 _secret = "" 禁 WebSocket server 启动
      expect(clean).toMatch(/_secret\s*=\s*""/);
    });
  });

  describe('bridge 侧 mcp_bridge.gd', () => {
    const funcBody = extractFunc(BRIDGE_SRC, '_write_secret_to_file');
    const clean = stripComments(funcBody);

    if (clean.length !== funcBody.length) {
      throw new Error(`stripComments 改变了长度(${funcBody.length}→${clean.length})`);
    }

    it('Windows 分支含 symlink 预检(Test-Path + Get-Item LinkType + exit 3)', () => {
      expect(clean).toMatch(/Test-Path/);
      expect(clean).toMatch(/Get-Item/);
      expect(clean).toMatch(/LinkType/);
      expect(clean).toMatch(/exit\s*3/);
    });

    it('Linux/macOS 分支含 readlink symlink 预检', () => {
      expect(clean).toMatch(/readlink/);
    });

    it('symlink 命中后 return false(bridge 侧语义,让调用方处理)', () => {
      // bridge 侧 _write_secret_to_file 返 bool,symlink 命中返 false
      expect(clean).toMatch(/return\s+false/);
    });
  });

  it('两处互相标注 DUPLICATE 同步关系(防单边漂移)', () => {
    // editor 侧应提及 mcp_bridge.gd,bridge 侧应提及 websocket_server.gd
    expect(EDITOR_SRC).toMatch(/mcp_bridge\.gd/);
    expect(BRIDGE_SRC).toMatch(/websocket_server\.gd/);
  });
});
