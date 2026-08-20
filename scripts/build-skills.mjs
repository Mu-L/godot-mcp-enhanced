#!/usr/bin/env node
/**
 * build-skills.mjs
 * 从 rule-templates.ts 的 workflow 模板派生 Claude Code SKILL.md
 *
 * 双输出（P2-2,2026-08-19）:
 * 1. .claude/skills/  — 仓库自身开发用（Claude Code 项目级 skill）
 * 2. skills/          — 分发源（进 git + npm files,供 `skills install` 子命令与
 *                       load_skill 生态[GODOT_SKILL_LIBRARIES 指向此目录]复用）
 *
 * 用法：npm run build:skills（先 tsc 编译，再跑此 wrapper import 编译产物）
 * 改 workflow 内容后跑此命令重生成两处 SKILL.md,再 git add .claude/skills/ skills/ commit。
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildAllSkills } from '../build/skills/skill-builder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUTPUT_DIRS = [join(ROOT, '.claude', 'skills'), join(ROOT, 'skills')];

let count = 0;
for (const [name, content] of buildAllSkills()) {
  for (const skillsDir of OUTPUT_DIRS) {
    const skillDir = join(skillsDir, name);
    mkdirSync(skillDir, { recursive: true });
    const skillPath = join(skillDir, 'SKILL.md');
    // 不加 trailing newline——保证 vitest DRY 断言"磁盘 == buildAllSkills()"字符串严格相等
    writeFileSync(skillPath, content);
    console.log(`Generated ${skillPath}`);
  }
  count++;
}
console.log(`Done: ${count} skills generated (x2 output dirs).`);
