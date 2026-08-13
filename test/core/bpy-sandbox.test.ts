import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scanBpySandbox } from '../../src/core/bpy-sandbox.js';

describe('scanBpySandbox', () => {
  beforeEach(() => {
    vi.stubEnv('GODOT_MCP_SANDBOX', '');
    vi.stubEnv('GODOT_MCP_UNRESTRICTED', '');
    vi.stubEnv('GODOT_MCP_DISABLE_SAFETY', '');
  });

  it('flags os.system / subprocess / eval / exec / __import__', () => {
    expect(scanBpySandbox('import os; os.system("rm -rf /")')).toContainEqual(expect.stringMatching(/os\.system|subprocess|system command/i));
    expect(scanBpySandbox('import subprocess; subprocess.run(["ls"])')).toHaveLength(1);
    expect(scanBpySandbox('eval("1+1")')).toHaveLength(1);
    expect(scanBpySandbox('exec("code")')).toHaveLength(1);
    expect(scanBpySandbox('__import__("os")')).toHaveLength(1);
  });

  it('allows safe bpy modeling code', () => {
    expect(scanBpySandbox('bpy.ops.mesh.primitive_cube_add()\nbpy.context.object.location = (1,2,3)')).toEqual([]);
  });

  it('S-1: DISABLE_SAFETY alone does NOT bypass (double opt-in, 对齐 gdscript P0-1)', () => {
    // 原单 || 旁路有 bug:CI/Docker 遗留单个 DISABLE_SAFETY=true 会静默关掉整个 bpy RCE 沙箱。
    // 修复后需同时 UNRESTRICTED=true 才旁路(对齐 gdscript-executor.ts:1054-1055)。
    vi.stubEnv('GODOT_MCP_DISABLE_SAFETY', 'true');
    // 单设 DISABLE_SAFETY → 沙箱保持激活,os.system 仍被 flag
    expect(scanBpySandbox('os.system("x")').length).toBeGreaterThan(0);
  });

  it('S-1: UNRESTRICTED + DISABLE_SAFETY 双开才旁路', () => {
    vi.stubEnv('GODOT_MCP_UNRESTRICTED', 'true');
    vi.stubEnv('GODOT_MCP_DISABLE_SAFETY', 'true');
    expect(scanBpySandbox('os.system("x")')).toEqual([]);
  });

  it('S-2: flags os.spawn* / os.posix_spawn* (原清单漏)', () => {
    expect(scanBpySandbox('os.spawnl(os.P_WAIT, "/bin/sh", "sh", "-c", "rm -rf ~")').length).toBeGreaterThan(0);
    expect(scanBpySandbox('os.posix_spawn("/bin/sh", ["sh"], {})').length).toBeGreaterThan(0);
    expect(scanBpySandbox('os.spawnvp("ls", ["ls"])').length).toBeGreaterThan(0);
  });

  it('does not flag dangerous name inside string literal', () => {
    // 对齐 stripLiterals 精神：字符串里的 API 名不应误报
    expect(scanBpySandbox('# use os.system here\nbpy.ops.mesh.primitive_cube_add()')).toEqual([]);
  });

  it('does not flag dangerous name inside real string literal (double-quoted)', () => {
    // Minor-3: 既有 it 只测注释,补真字符串字面量（验证 stripPythonLiterals 双引号剥离生效）
    expect(scanBpySandbox('msg = "use os.system to shell out"\nbpy.ops.mesh.primitive_cube_add()')).toEqual([]);
  });

  it('does not flag legitimate bpy .open() / .load() method calls', () => {
    // Important-2: 旧 /\bopen\s*\(/ 误报 bpy.ops.image.open() 合法 API。
    // 新 negative lookbehind 排除 `word.open(`/`xopen(`，仅匹配裸 builtin open(。
    expect(scanBpySandbox('bpy.ops.image.open(filepath="x.png")')).toEqual([]);
    expect(scanBpySandbox('bpy.data.libraries.load("x.blend")')).toEqual([]);
    // 裸 builtin open( 仍 block
    expect(scanBpySandbox('open("/etc/passwd")').length).toBeGreaterThan(0);
  });

  it('P2-1: flags string concatenation bypass (getattr + parts)', () => {
    // 对齐 gdscript detectStringConcatBypass：相邻字符串字面量拼接重构命中危险 token
    const w = scanBpySandbox('getattr(__builtins__, "ex" + "ec")');
    expect(w.some((s) => /concatenation bypass.*exec/i.test(s))).toBe(true);
  });

  it('NIT-2: flags % format string bypass (dangerous token prefix)', () => {
    // 对齐 gdscript-executor C-01-fix:217。Python "os%s" % ".system" 等价拼接 → "os.system"
    // prefixPart=os，正则匹配 ["']os%[sdr]["']
    const w = scanBpySandbox('name = "os%s" % ".system"');
    expect(w.some((s) => /% format string constructs.*os\.system/i.test(s))).toBe(true);
  });

  it('NIT-2: does NOT flag innocent % formatting (no dangerous token)', () => {
    // 无危险 token 前缀/后缀的 % 格式化不应误报
    expect(scanBpySandbox('print("Score: %d" % score)')).toEqual([]);
    expect(scanBpySandbox('msg = "Hello %s" % name')).toEqual([]);
  });
});
