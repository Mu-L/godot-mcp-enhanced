import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/core/godot-finder.js', () => ({
  findGodot: vi.fn().mockResolvedValue('/usr/bin/godot'),
}));

vi.mock('../../src/cli/clients/claude-code.js', () => ({
  ClaudeCodeAdapter: vi.fn().mockImplementation(function () {
    this.name = 'Claude Code'; this.scope = 'project'; this.detect = vi.fn().mockResolvedValue(true); this.isConfigured = vi.fn().mockResolvedValue(true);
  }),
}));

vi.mock('../../src/cli/clients/cursor.js', () => ({
  CursorAdapter: vi.fn().mockImplementation(function () {
    this.name = 'Cursor'; this.scope = 'project'; this.detect = vi.fn().mockResolvedValue(false); this.isConfigured = vi.fn().mockResolvedValue(false);
  }),
}));

vi.mock('../../src/cli/clients/opencode.js', () => ({
  OpenCodeAdapter: vi.fn().mockImplementation(function () {
    this.name = 'OpenCode'; this.scope = 'project'; this.detect = vi.fn().mockResolvedValue(false); this.isConfigured = vi.fn().mockResolvedValue(false);
  }),
}));

vi.mock('../../src/cli/clients/gemini-cli.js', () => ({
  GeminiCliAdapter: vi.fn().mockImplementation(function () {
    this.name = 'Gemini CLI'; this.scope = 'project'; this.detect = vi.fn().mockResolvedValue(false); this.isConfigured = vi.fn().mockResolvedValue(false);
  }),
}));

vi.mock('../../src/cli/clients/qwen-code.js', () => ({
  QwenCodeAdapter: vi.fn().mockImplementation(function () {
    this.name = 'Qwen Code'; this.scope = 'project'; this.detect = vi.fn().mockResolvedValue(false); this.isConfigured = vi.fn().mockResolvedValue(false);
  }),
}));

vi.mock('../../src/cli/clients/codex.js', () => ({
  CodexAdapter: vi.fn().mockImplementation(function () {
    this.name = 'Codex'; this.scope = 'global'; this.detect = vi.fn().mockResolvedValue(false); this.isConfigured = vi.fn().mockResolvedValue(false);
  }),
}));

vi.mock('../../src/cli/clients/claude-desktop.js', () => ({
  ClaudeDesktopAdapter: vi.fn().mockImplementation(function () {
    this.name = 'Claude Desktop'; this.scope = 'global'; this.detect = vi.fn().mockResolvedValue(false); this.isConfigured = vi.fn().mockResolvedValue(false);
  }),
}));

vi.mock('../../src/cli/clients/windsurf.js', () => ({
  WindsurfAdapter: vi.fn().mockImplementation(function () {
    this.name = 'Windsurf'; this.scope = 'global'; this.detect = vi.fn().mockResolvedValue(false); this.isConfigured = vi.fn().mockResolvedValue(false);
  }),
}));

vi.mock('../../src/cli/clients/cline.js', () => ({
  ClineAdapter: vi.fn().mockImplementation(function () {
    this.name = 'Cline'; this.scope = 'global'; this.detect = vi.fn().mockResolvedValue(false); this.isConfigured = vi.fn().mockResolvedValue(false);
  }),
}));

vi.mock('../../src/cli/clients/zed.js', () => ({
  ZedAdapter: vi.fn().mockImplementation(function () {
    this.name = 'Zed'; this.scope = 'global'; this.detect = vi.fn().mockResolvedValue(false); this.isConfigured = vi.fn().mockResolvedValue(false);
  }),
}));

vi.mock('../../src/cli/clients/antigravity.js', () => ({
  AntigravityAdapter: vi.fn().mockImplementation(function () {
    this.name = 'Antigravity'; this.scope = 'global'; this.detect = vi.fn().mockResolvedValue(false); this.isConfigured = vi.fn().mockResolvedValue(false);
  }),
}));

vi.mock('../../src/cli/clients/trae.js', () => ({
  TraeAdapter: vi.fn().mockImplementation(function () {
    this.name = 'Trae'; this.scope = 'global'; this.detect = vi.fn().mockResolvedValue(false); this.isConfigured = vi.fn().mockResolvedValue(false);
  }),
}));

vi.mock('../../src/cli/clients/cherry-studio.js', () => ({
  CherryStudioAdapter: vi.fn().mockImplementation(function () {
    this.name = 'Cherry Studio'; this.scope = 'global'; this.detect = vi.fn().mockResolvedValue(false); this.isConfigured = vi.fn().mockResolvedValue(false);
  }),
}));

describe('doctor', () => {
  it('runDoctor completes and reports Node version', async () => {
    const { runDoctor } = await import('../../src/cli/doctor.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runDoctor([]);
    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('Node.js');
    expect(output).toContain('Godot');
    consoleSpy.mockRestore();
  });

  it('logs client scope (project|global) on each status line', async () => {
    const { runDoctor } = await import('../../src/cli/doctor.js');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runDoctor([]);
    expect(logSpy.mock.calls.some(c => /\(project\)/.test(String(c[0] ?? '')))).toBe(true);
    expect(logSpy.mock.calls.some(c => /\(global\)/.test(String(c[0] ?? '')))).toBe(true);
    logSpy.mockRestore();
  });
});
