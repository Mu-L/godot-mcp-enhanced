// test/testing.test.ts
// P2-12 phase 1: McpTestSuite runner tool (editor-only).
//
// testing.ts handleTool only fires in headless mode (editor mode dispatches
// to EditorToolExecutor before reaching this module). So the TS-side test
// only covers: tool shape (definitions/meta), action validation, and the
// EDITOR_ONLY rejection path. The actual suite execution lives in GD and is
// exercised via the editor-method-map routing test + e2e (deferred to phase 2).
import { describe, it, expect, vi } from 'vitest';
import { getToolDefinitions, handleTool, TOOL_META, TOOL_NAMES } from '../src/tools/testing.js';

describe('testing tool shape', () => {
  it('TOOL_NAMES contains exactly "testing"', () => {
    expect(TOOL_NAMES).toEqual(['testing']);
  });

  it('getToolDefinitions returns 1 definition named "testing"', () => {
    const defs = getToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('testing');
  });

  it('action enum contains run + manage', () => {
    const actionEnum = getToolDefinitions()[0].inputSchema.properties.action.enum;
    expect(actionEnum).toContain('run');
    expect(actionEnum).toContain('manage');
  });

  it('description warns about editor-only + async coroutine + 290s budget', () => {
    const desc = getToolDefinitions()[0].description;
    expect(desc).toMatch(/editor-only/i);
    expect(desc).toContain('290s');
  });

  it('required contains action', () => {
    const required = getToolDefinitions()[0].inputSchema.required;
    expect(required).toContain('action');
  });
});

describe('testing TOOL_META', () => {
  it('has exactly 1 entry for "testing"', () => {
    expect(Object.keys(TOOL_META)).toEqual(['testing']);
  });

  it('is readonly + long_running', () => {
    expect(TOOL_META.testing.readonly).toBe(true);
    expect(TOOL_META.testing.long_running).toBe(true);
  });

  it('actionRisks covers run + manage as read', () => {
    expect(TOOL_META.testing.actionRisks?.run).toBe('read');
    expect(TOOL_META.testing.actionRisks?.manage).toBe('read');
  });
});

describe('testing handleTool routing', () => {
  const mockCtx = { findGodot: vi.fn() };

  it('returns null for unknown tool name', async () => {
    const result = await handleTool('not_testing', { action: 'run' }, mockCtx);
    expect(result).toBeNull();
  });

  it('rejects missing action with INVALID_PARAMS', async () => {
    const result = await handleTool('testing', {}, mockCtx);
    expect(result).not.toBeNull();
    const text = JSON.stringify(result);
    expect(text).toMatch(/INVALID_PARAMS|action is required/);
  });

  it('rejects unknown action with INVALID_ACTION', async () => {
    const result = await handleTool('testing', { action: 'bogus' }, mockCtx);
    expect(result).not.toBeNull();
    const text = JSON.stringify(result);
    expect(text).toMatch(/INVALID_ACTION|Unknown action/);
  });

  // P2-12 core contract: both actions are editor-only. In editor mode
  // GodotServer dispatches to EditorToolExecutor before this module, so this
  // headless path must hard-return EDITOR_ONLY (prevents a silent no-op if
  // the dispatch routing ever breaks).
  it('run action returns EDITOR_ONLY (headless guard)', async () => {
    const result = await handleTool('testing', { action: 'run' }, mockCtx);
    expect(result).not.toBeNull();
    const text = JSON.stringify(result);
    expect(text).toMatch(/EDITOR_ONLY/);
    expect(text).toMatch(/run/);
  });

  it('manage action returns EDITOR_ONLY (headless guard)', async () => {
    const result = await handleTool('testing', { action: 'manage' }, mockCtx);
    expect(result).not.toBeNull();
    const text = JSON.stringify(result);
    expect(text).toMatch(/EDITOR_ONLY/);
    expect(text).toMatch(/manage/);
  });
});
