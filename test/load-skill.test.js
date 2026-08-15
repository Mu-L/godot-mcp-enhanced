import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { getToolDefinitions, handleTool, TOOL_META } from '../src/tools/load-skill.js';
import { isolatePathEnv } from './helpers/path-isolation.js';

describe('load_skill tool', () => {
  let libDir;

  beforeAll(async () => {
    libDir = await mkdtemp(join(tmpdir(), 'skill-lib-'));
    await mkdir(join(libDir, 'skills', 'jump'), { recursive: true });
    await writeFile(
      join(libDir, 'skills', 'jump', 'SKILL.md'),
      '---\nname: jump\ndescription: Coyote time jump\n---\n# Jump\nAdd coyote time.'
    );
  });

  afterAll(async () => {
    await rm(libDir, { recursive: true, force: true });
  });

  it('getToolDefinitions 含 load_skill 且 query 必填', () => {
    const defs = getToolDefinitions();
    expect(defs.map(d => d.name)).toContain('load_skill');
    expect(defs[0].inputSchema.required).toContain('query');
  });

  it('TOOL_META.readonly === true', () => {
    expect(TOOL_META.load_skill).toBeDefined();
    expect(TOOL_META.load_skill.readonly).toBe(true);
  });

  it('handleTool 检索返回 matches(含 source+score)+ total_matches', async () => {
    const result = await handleTool('load_skill', { query: 'coyote', libraries: [libDir] }, {});
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.total_matches).toBeGreaterThan(0);
    expect(parsed.matches[0].score).toBeGreaterThan(0);
    expect(parsed.matches[0].source).toBeDefined();
    expect(parsed.matches[0].path).toBeDefined();
  });

  it('L6 缺失库进 missing_libraries,不 isError', async () => {
    const result = await handleTool(
      'load_skill',
      { query: 'x', libraries: [join(libDir, 'nope')] },
      {}
    );
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.missing_libraries.length).toBe(1);
  });

  it('空 query 返回 isError', async () => {
    const result = await handleTool('load_skill', { libraries: [libDir] }, {});
    expect(result.isError).toBe(true);
  });

  it('未知工具名返回 null', async () => {
    const result = await handleTool('not_load_skill', {}, {});
    expect(result).toBeNull();
  });
});

// B-3 (2026-08-14): explicit libraries 参数无范围限制 — AI 可传任意绝对路径(如用户
// Documents 目录),walkMd 递归读全部 .md 正文片段返回,游离于 ALLOWED_PROJECT_PATHS
// deny-by-default 之外。修复:explicit 来源限白名单,越界进 missing;env
// GODOT_SKILL_LIBRARIES(服务器管理员配置)保持豁免合法。
describe('B-3: load_skill libraries 白名单范围限制', () => {
  let libDir, allowedDir, restore;

  beforeAll(async () => {
    libDir = await mkdtemp(join(tmpdir(), 'skill-lib-b3-'));
    await mkdir(join(libDir, 'skills', 'jump'), { recursive: true });
    await writeFile(
      join(libDir, 'skills', 'jump', 'SKILL.md'),
      '---\nname: jump\ndescription: Coyote time jump\n---\n# Jump\nAdd coyote time.'
    );
    allowedDir = await mkdtemp(join(tmpdir(), 'skill-allowed-'));
  });

  afterAll(async () => {
    await rm(libDir, { recursive: true, force: true });
    await rm(allowedDir, { recursive: true, force: true });
  });

  afterEach(() => {
    if (restore) restore();
  });

  it('B3-1 explicit 传白名单外目录 → 进 missing_libraries 且响应无该目录正文', async () => {
    // deny-by-default 姿态:清 UNRESTRICTED,白名单只含 allowedDir(libDir 在外)
    restore = isolatePathEnv({ allowed: [allowedDir] });
    const result = await handleTool('load_skill', { query: 'coyote', libraries: [libDir] }, {});
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.total_matches).toBe(0);
    expect(parsed.missing_libraries.length).toBe(1);
    expect(parsed.missing_libraries[0].path).toBe(libDir);
    expect(parsed.missing_libraries[0].reason).toMatch(/outside allowed|ALLOWED_PROJECT_PATHS/);
    // 正文不得泄漏(整个响应无库内容)
    expect(JSON.stringify(parsed)).not.toContain('coyote time');
  });

  it('B3-2 env 配置的目录(白名单外) → 正常返回(env 是管理员合法入口,豁免)', async () => {
    restore = isolatePathEnv({ allowed: [allowedDir] });
    vi.stubEnv('GODOT_SKILL_LIBRARIES', libDir);
    const result = await handleTool('load_skill', { query: 'coyote' }, {});
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.total_matches).toBeGreaterThan(0);
    expect(parsed.missing_libraries).toEqual([]);
  });

  it('B3-3 explicit 传白名单内目录 → 正常返回(不误判)', async () => {
    restore = isolatePathEnv({ allowed: [libDir] });
    const result = await handleTool('load_skill', { query: 'coyote', libraries: [libDir] }, {});
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.total_matches).toBeGreaterThan(0);
    expect(parsed.missing_libraries).toEqual([]);
  });
});
