import { describe, it, expect } from 'vitest';
import { handleTool } from '../../src/tools/scene/index.js';
import type { ToolResult } from '../../src/types.js';

// content[0].text TS union（TextContent|ImageContent|...）未窄化 → helper 窄化（同 asset-ops.test.ts 模式）
function textOf(r: ToolResult | null): string {
  if (!r || !r.content || !r.content[0]) return '';
  const c = r.content[0] as { text?: string };
  return c.text ?? '';
}

// open_scene 是 editor-only：TS case 不读 ctx，直接返 EDITOR_ONLY
const NO_CTX = {} as never;

describe('scene handleTool — open_scene', () => {
  it('open_scene 在 headless ctx 返 EDITOR_ONLY（editor-only action）', async () => {
    const r = await handleTool(
      'scene',
      { action: 'open_scene', scene_path: 'res://scenes/main.tscn' },
      NO_CTX,
    );
    expect(r?.isError).toBe(true);
    expect(textOf(r)).toContain('EDITOR_ONLY');
  });
});
