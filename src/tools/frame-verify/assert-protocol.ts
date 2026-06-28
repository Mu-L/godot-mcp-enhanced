// ASSERT 文本协议解析 —— 把 Godogen test-harness.md 的 GD.Print("ASSERT PASS/FAIL") 协议
// 转成可程序化判定的结构。来源：D:\GitHub\godogen\godot\skills\godogen\test-harness.md:16

export interface AssertSummary {
  passCount: number;
  failCount: number;
  fails: string[];
  passed: boolean;   // failCount===0 && passCount>0
}

const PASS_RE = /^ASSERT PASS:\s*(.*)$/;
const FAIL_RE = /^ASSERT FAIL:\s*(.*)$/;

export function parseAsserts(stdout: string): AssertSummary {
  const lines = stdout.split(/\r?\n/);
  let passCount = 0;
  const fails: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const pm = trimmed.match(PASS_RE);
    if (pm) { passCount++; continue; }
    const fm = trimmed.match(FAIL_RE);
    if (fm) { fails.push((fm[1] ?? '').trim()); continue; }
  }
  return {
    passCount,
    failCount: fails.length,
    fails,
    passed: fails.length === 0 && passCount > 0,
  };
}
