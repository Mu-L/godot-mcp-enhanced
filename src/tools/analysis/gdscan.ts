// src/tools/analysis/gdscan.ts — .gd 静态信号调用扫描（emit/connect/disconnect）
//
// 复用 gdscript-lint.ts 导出的 isInCommentOrString 过滤注释/字符串内命中
// （负向：注释与字符串里的同名调用不得误报——见 test/analysis.test.ts）。
// 尽力而为的文本级识别，非语义分析：动态信号名（变量拼接）不可见，blindspots 由
// 调用方诚实标注。

import { isInCommentOrString } from '../gdscript-lint.js';

export type GdSignalKind = 'emit' | 'connect' | 'disconnect';

export interface GdSignalRef {
  kind: GdSignalKind;
  /** 提取的信号名（emit_signal("x")/x.emit() → x；obj.sig.connect() → sig） */
  signal: string;
  /** 1-based 行号 */
  line: number;
  /** 该行 trim 内容（人读定位） */
  snippet: string;
}

interface Pattern {
  kind: GdSignalKind;
  regex: RegExp;
  /** 从 match 提取信号名 */
  extract: (m: RegExpExecArray) => string;
}

const PATTERNS: Pattern[] = [
  // emit_signal("name") / emit_signal(&"name")
  { kind: 'emit', regex: /emit_signal\s*\(\s*[&]?["']([^"']+)["']/g, extract: m => m[1]! },
  // name.emit( —— Godot 4 Signal.emit（排除 this.emit 罕见形态按字面接受）
  { kind: 'emit', regex: /\b([A-Za-z_]\w*)\.emit\s*\(/g, extract: m => m[1]! },
  // obj.signal.connect( / signal.connect( —— Godot 4（捕获 .connect 前的标识符）
  { kind: 'connect', regex: /\b([A-Za-z_]\w*)\.connect\s*\(/g, extract: m => m[1]! },
  // connect("name", ...) —— Godot 3 字符串风格
  { kind: 'connect', regex: /\bconnect\s*\(\s*["']([^"']+)["']/g, extract: m => m[1]! },
  // obj.signal.disconnect( / disconnect("name", ...)
  { kind: 'disconnect', regex: /\b([A-Za-z_]\w*)\.disconnect\s*\(/g, extract: m => m[1]! },
  { kind: 'disconnect', regex: /\bdisconnect\s*\(\s*["']([^"']+)["']/g, extract: m => m[1]! },
];

/** 扫描一段 GDScript 源码的信号调用引用。注释/字符串内的命中被过滤。 */
export function scanGdScriptSignals(code: string): GdSignalRef[] {
  const lines = code.split(/\r?\n/);
  const out: GdSignalRef[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const p of PATTERNS) {
      p.regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = p.regex.exec(line)) !== null) {
        if (isInCommentOrString(line, m.index)) continue;
        const signal = p.extract(m);
        if (!signal) continue;
        out.push({ kind: p.kind, signal, line: i + 1, snippet: line.trim().slice(0, 160) });
      }
    }
  }
  return out;
}
