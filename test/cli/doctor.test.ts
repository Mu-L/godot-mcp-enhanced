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

  it('handles BOM in mcp-godot.json without throwing', async () => {
    const { runDoctor } = await import('../../src/cli/doctor.js');
    const { mkdirSync, writeFileSync, rmSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');

    const tempDir = join(tmpdir(), 'doctor-test-' + Math.random().toString(36).slice(2));
    const godotDir = join(tempDir, '.godot');
    mkdirSync(godotDir, { recursive: true });

    const configPath = join(godotDir, 'mcp-godot.json');
    const BOM = '﻿';
    const configContent = BOM + JSON.stringify({ godot_path: '/custom/godot' });
    writeFileSync(configPath, configContent, 'utf-8');

    try {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      // Change to temp dir to test project-level config
      const originalCwd = process.cwd();
      process.chdir(tempDir);
      await runDoctor([]);
      process.chdir(originalCwd);

      const output = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');

      // Should not throw, and should read the Godot override correctly
      expect(output).toContain('Project Godot override: /custom/godot');
      consoleSpy.mockRestore();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
