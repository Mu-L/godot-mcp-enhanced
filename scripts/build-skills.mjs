#!/usr/bin/env node
/**
 * build-skills.mjs
 * 从 rule-templates.ts 的 workflow 模板派生 Claude Code SKILL.md 到 .claude/skills/
 *
 * 用法：npm run build:skills（先 tsc 编译，再跑此 wrapper import 编译产物）
 * 改 workflow 内容后跑此命令重生成 SKILL.md，再 git add .claude/skills/ commit。
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildAllSkills } from '../build/tools/skill-builder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SKILLS_DIR = join(ROOT, '.claude', 'skills');

let count = 0;
for (const [name, content] of buildAllSkills()) {
  const skillDir = join(SKILLS_DIR, name);
  mkdirSync(skillDir, { recursive: true });
  const skillPath = join(skillDir, 'SKILL.md');
  // 不加 trailing newline——保证 vitest DRY 断言"磁盘 == buildAllSkills()"字符串严格相等
  writeFileSync(skillPath, content);
  console.log(`Generated ${skillPath}`);
  count++;
}
console.log(`Done: ${count} skills generated.`);
