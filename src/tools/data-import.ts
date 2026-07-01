// CSV 前置校验:仅解析 header 行(RFC4180 引号),不解析所有行值(权威解析在 GDScript get_csv_line)。
export interface ParseCsvResult { ok: boolean; headers?: string[]; error?: string; }

export function parseCsv(text: string): ParseCsvResult {
  if (!text || !text.trim()) return { ok: false, error: 'empty csv' };
  const firstLine = text.split(/\r?\n/)[0]!;
  // 简单 RFC4180:引号内逗号不拆(header 行)
  const headers: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < firstLine.length; i++) {
    const ch = firstLine[i]!;
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { headers.push(cur); cur = ''; continue; }
    cur += ch;
  }
  headers.push(cur);
  if (headers.length === 0) return { ok: false, error: 'no header columns' };
  return { ok: true, headers };
}
