import { describe, it, expect } from 'vitest';
import { mergeSections, parseSections, normalizeHeader } from '../../src/tools/shared/section-merge.js';

describe('section-merge（参数化）', () => {
  it('mergeSections 用传入 sectionIds 判定 MCP 段并替换，保留用户段', () => {
    const ids = new Set(['## MCP段']);
    const existing = '# Title\n\n## MCP段\nold\n\n## 用户段\n用户内容\n';
    const merged = mergeSections(existing, [['## MCP段', 'new-body']], ids);
    expect(merged).toContain('new-body');
    expect(merged).not.toContain('old');
    expect(merged).toContain('用户内容');
  });

  it('空 existing 直接拼接 newSections', () => {
    const ids = new Set(['## A']);
    const merged = mergeSections('', [['## A', 'a'], ['## B', 'b']], ids);
    expect(merged).toBe('## A\na\n\n## B\nb\n');
  });

  it('不同 sectionIds 产生不同 isMcp 判定', () => {
    const existing = '# T\n\n## X\nx\n';
    expect(parseSections(existing, new Set(['## X'])).sections[0]!.isMcp).toBe(true);
    expect(parseSections(existing, new Set<string>()).sections[0]!.isMcp).toBe(false);
  });

  it('normalizeHeader 折叠空白', () => {
    expect(normalizeHeader('##   a   b')).toBe('## a b');
  });
});
