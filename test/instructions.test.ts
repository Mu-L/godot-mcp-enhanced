import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('instructions.md 内容契约', () => {
  const content = readFileSync(join(process.cwd(), 'src', 'instructions.md'), 'utf-8');

  it('含三层模式标记', () => {
    expect(content).toMatch(/headless/);
    expect(content).toMatch(/editor/);
    expect(content).toMatch(/bridge/);
  });

  it('含 5 条陷阱关键词', () => {
    expect(content).toMatch(/持久化/);              // T1 运行时
    expect(content).toMatch(/search_and_replace/);  // T2
    expect(content).toMatch(/BLANK_DETECTED/);      // T3
    expect(content).toMatch(/\/root\//);            // T4
    expect(content).toMatch(/PERSISTENT_SECRET/);   // T5
  });

  it('指向 manage_tools / godot_get_context', () => {
    expect(content).toMatch(/manage_tools/);
    expect(content).toMatch(/godot_get_context/);
  });

  it('长度 < 2000 字符（精简速查卡防膨胀）', () => {
    expect(content.length).toBeLessThan(2000);
  });
});
