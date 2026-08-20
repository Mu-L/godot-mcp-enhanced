import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ─── 批 5(N-1):game-wizard 纯手写双副本的机械一致性保障 ──────────────────────
// 既有 6 个 skill 走 skill-builder 单源双输出 + DRY 测试;game-wizard 磁盘手写,
// 此处补最小校验防「改一份漏另一份」(仓库有 rules 双副本 drift 前科)。

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

describe('game-wizard 双副本一致性', () => {
  it('skills/ 与 .claude/skills/ 两份 SKILL.md 逐字节一致', () => {
    const a = join(repoRoot, 'skills', 'game-wizard', 'SKILL.md');
    const b = join(repoRoot, '.claude', 'skills', 'game-wizard', 'SKILL.md');
    expect(existsSync(a)).toBe(true);
    expect(existsSync(b)).toBe(true);
    expect(readFileSync(a, 'utf-8')).toBe(readFileSync(b, 'utf-8'));
  });

  it('frontmatter 可被 skills.ts 的单行 description 解析(name + description 非空)', () => {
    const raw = readFileSync(join(repoRoot, 'skills', 'game-wizard', 'SKILL.md'), 'utf-8');
    const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
    expect(fm).toBeTruthy();
    expect(fm![1]).toMatch(/^name: game-wizard$/m);
    expect(fm![1]).toMatch(/^description: "[^"]+"$/m);
  });
});
