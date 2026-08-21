import { describe, it, expect } from 'vitest';
import { parseSubcommand, isCliInvocation, isUnknownCommand } from '../../src/cli/router.js';

describe('router', () => {
  describe('parseSubcommand', () => {
    it('parses setup subcommand', () => {
      const result = parseSubcommand(['setup', '--project=/foo']);
      expect(result).toEqual({ subcommand: 'setup', rest: ['--project=/foo'] });
    });

    it('returns null for empty args', () => {
      expect(parseSubcommand([])).toBeNull();
    });

    it('returns null for flags', () => {
      expect(parseSubcommand(['--profile=full'])).toBeNull();
    });

    it('returns null for --help', () => {
      expect(parseSubcommand(['--help'])).toBeNull();
    });

    it('parses all valid subcommands', () => {
      for (const cmd of ['setup', 'configure', 'doctor', 'init', 'dashboard'] as const) {
        expect(parseSubcommand([cmd])).toEqual({ subcommand: cmd, rest: [] });
      }
    });
  });

  describe('isCliInvocation', () => {
    it('returns true for setup', () => {
      expect(isCliInvocation(['setup'])).toBe(true);
    });

    it('returns true for --help', () => {
      expect(isCliInvocation(['--help'])).toBe(true);
    });

    it('returns true for --version', () => {
      expect(isCliInvocation(['--version'])).toBe(true);
    });

    it('returns true for -v', () => {
      expect(isCliInvocation(['-v'])).toBe(true);
    });

    it('returns false for empty args', () => {
      expect(isCliInvocation([])).toBe(false);
    });

    it('returns false for --profile flag', () => {
      expect(isCliInvocation(['--profile=full'])).toBe(false);
    });

    it('returns false for --minimal flag', () => {
      expect(isCliInvocation(['--minimal'])).toBe(false);
    });

    it('returns false for unknown flag', () => {
      expect(isCliInvocation(['--unknown'])).toBe(false);
    });
  });

  describe('isUnknownCommand(2026-08-21 架构审查 MAJOR-1:堵静默挂起)', () => {
    it('returns true for misspelled command', () => {
      expect(isUnknownCommand(['intsll'])).toBe(true);
      expect(isUnknownCommand(['Setup'])).toBe(true);  // 大小写敏感,非子命令
    });

    it('returns true for bare path-like arg', () => {
      expect(isUnknownCommand(['D:/some/project'])).toBe(true);
    });

    it('returns false for all known subcommands', () => {
      for (const cmd of ['setup', 'configure', 'skills', 'doctor', 'init', 'dashboard', 'qa', 'install', 'gif', 'web'] as const) {
        expect(isUnknownCommand([cmd])).toBe(false);
      }
    });

    it('returns false for flags(归 MCP 模式)与空参数', () => {
      expect(isUnknownCommand([])).toBe(false);
      expect(isUnknownCommand(['--profile=full'])).toBe(false);
      expect(isUnknownCommand(['--unknown-flag'])).toBe(false);
    });
  });
});
