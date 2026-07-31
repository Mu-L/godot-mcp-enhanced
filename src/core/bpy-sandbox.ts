// src/core/bpy-sandbox.ts
// execute_bpy 的 best-effort 危险 API 静态扫描,对齐 execute_gdscript scanGdscriptSandbox 纵深防御。
// 同 GDScript 沙箱:防误用层非防对抗(字符串拼接/反射可绕过),真正隔离须容器/VM。
import { getLogger } from './logger.js';

// Python 危险 API 模式(对齐 DANGEROUS_PATTERNS 精神)。在剥字符串/注释后的 skeleton 上匹配。
const DANGEROUS_BPY_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bos\.system\b/, label: 'os.system (system command)' },
  { pattern: /\bos\.popen\b/, label: 'os.popen (system command)' },
  { pattern: /\bos\.exec/, label: 'os.exec* (system command)' },
  { pattern: /\bsubprocess\b/, label: 'subprocess (system command)' },
  { pattern: /\bos\.remove\b|\bos\.unlink\b|\bshutil\.rmtree\b/, label: 'file/dir deletion' },
  // negative lookbehind 排除方法调用(`bpy.ops.image.open(...)`/`x.open(...)`)与标识符拼接(`xopen(`)，
  // 仅匹配裸 builtin `open(`（host fs 访问面）。JS lookbehind ES2018+ Node 支持。
  { pattern: /(?<![\w.])open\s*\(/, label: 'file open (host fs access)' },
  { pattern: /\beval\s*\(/, label: 'eval (arbitrary code)' },
  { pattern: /\bexec\s*\(/, label: 'exec (arbitrary code)' },
  { pattern: /\b__import__\s*\(/, label: '__import__ (dynamic import bypass)' },
  { pattern: /\bctypes\b/, label: 'ctypes (native code execution)' },
];

// 简化 stripLiterals:剥 # 注释 + 单/双/三引号字符串内容(仅用于扫描,不改原文)。
// GDScript stripLiterals 较重;bpy 场景用轻量正则剥离即可(防字符串内 API 名误报)。
function stripPythonLiterals(code: string): string {
  return code
    .replace(/#[^\n]*/g, '')            // 注释
    .replace(/'''[\s\S]*?'''/g, '""')   // 三引号字符串
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''") // 单引号字符串
    .replace(/"(?:\\.|[^"\\])*"/g, '""');// 双引号字符串
}

export function scanBpySandbox(code: string): string[] {
  // 对齐 scanGdscriptSandbox 双开关语义(简化):DISABLE_SAFETY + UNRESTRICTED 总开关旁路。
  if (process.env.GODOT_MCP_DISABLE_SAFETY === 'true' || process.env.GODOT_MCP_UNRESTRICTED === 'true') {
    if (process.env.GODOT_MCP_DISABLE_SAFETY === 'true') {
      getLogger().warn('security', '⚠️ execute_bpy sandbox bypassed (GODOT_MCP_DISABLE_SAFETY=true). Full Python RCE surface.');
    }
    return [];
  }
  const warnings: string[] = [];
  const skeleton = stripPythonLiterals(code);
  for (const { pattern, label } of DANGEROUS_BPY_PATTERNS) {
    if (pattern.test(skeleton)) {
      warnings.push(`[BPY-SANDBOX] Potential dangerous operation: ${label}`);
    }
  }
  return warnings;
}
