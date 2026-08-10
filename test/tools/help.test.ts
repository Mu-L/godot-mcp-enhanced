import { describe, it, expect } from 'vitest';

// 项目待办 :154 — help 工具端到端测试(审查 Important-2 补)
// 守护 help.ts:74-86 的 docs/tools/{name}.md 读取逻辑 + :93-99 拼写纠错降级

describe('help 工具 — handleTool 端到端', () => {
  it('tool_name=android 返回 docs/tools/android.md 内容(非拼写纠错)', async () => {
    const { handleTool } = await import('../../src/tools/help.js');
    const result = await handleTool('help', { tool_name: 'android' }, {} as never);
    expect(result).not.toBeNull();
    const text = result!.content![0] as { text: string };
    // 应读到文档内容,含标题 + AUTO-GENERATED 页脚
    expect(text.text).toContain('# android');
    expect(text.text).toContain('AUTO-GENERATED');
    // 不应返拼写纠错 JSON
    expect(text.text).not.toContain('"error"');
    expect(text.text).not.toContain('Did you mean');
  });

  it('tool_name 不存在时返拼写纠错 JSON', async () => {
    const { handleTool } = await import('../../src/tools/help.js');
    const result = await handleTool('help', { tool_name: 'nonexistent_tool' }, {} as never);
    expect(result).not.toBeNull();
    const text = result!.content![0] as { text: string };
    const parsed = JSON.parse(text.text);
    expect(parsed.error).toContain('No documentation found');
    expect(parsed.available).toBeInstanceOf(Array);
    expect(parsed.available.length).toBeGreaterThan(0);
  });

  it('tool_name 拼写相近时返回 Did you mean 建议', async () => {
    const { handleTool } = await import('../../src/tools/help.js');
    // sceene 与 scene 编辑距离 1(插入 e),应建议 scene
    const result = await handleTool('help', { tool_name: 'sceene' }, {} as never);
    const text = result!.content![0] as { text: string };
    const parsed = JSON.parse(text.text);
    expect(parsed.suggestion).toContain("Did you mean 'scene'?");
  });

  it('tool_name 缺失时返 error + available 列表', async () => {
    const { handleTool } = await import('../../src/tools/help.js');
    const result = await handleTool('help', {} as Record<string, unknown>, {} as never);
    const text = result!.content![0] as { text: string };
    const parsed = JSON.parse(text.text);
    expect(parsed.error).toBe('tool_name is required');
    expect(parsed.available).toBeInstanceOf(Array);
  });

  it('路径遍历防护:tool_name 含 ../ 经 basename 后安全(不读 docs/tools 外文件)', async () => {
    const { handleTool } = await import('../../src/tools/help.js');
    // ../capability-matrix 若不经 basename 会读到 docs/capability-matrix.json
    // basename('../capability-matrix') = 'capability-matrix',docs/tools/capability-matrix.md 不存在
    const result = await handleTool('help', { tool_name: '../capability-matrix' }, {} as never);
    const text = result!.content![0] as { text: string };
    // 应降级为拼写纠错(不读到 docs/tools 外的文件)
    expect(text.text).toContain('"error"');
  });

  it('非 help 工具名返 null(help.ts:64 only handles "help")', async () => {
    const { handleTool } = await import('../../src/tools/help.js');
    const result = await handleTool('other_tool', { tool_name: 'android' }, {} as never);
    expect(result).toBeNull();
  });
});
