/** init 命令 — 创建 Godot 项目骨架 */
import { join, dirname } from 'path';
import { mkdirSync, existsSync, writeFileSync } from 'fs';

function parseInitArgs(args: string[]): { name: string; template: string } {
  const name = args[0] || 'my-game';
  let template = 'empty';
  for (let i = 1; i < args.length; i++) {
    if (args[i]!.startsWith('--template=')) template = args[i]!.split('=')[1]!;
  }
  return { name, template };
}

/** 项目名称合法性校验：只允许字母、数字、连字符、下划线 */
const VALID_NAME = /^[a-zA-Z0-9_-]+$/;

export async function runInit(args: string[]): Promise<void> {
  const { name, template } = parseInitArgs(args);
  if (!VALID_NAME.test(name)) {
    console.error(`Invalid project name: "${name}". Use only letters, numbers, hyphens, and underscores.`);
    process.exit(1);
  }
  const projectDir = join(process.cwd(), name);

  if (existsSync(projectDir)) {
    console.error(`Directory already exists: ${projectDir}`);
    process.exit(1);
  }

  console.log(`Creating project "${name}" (template: ${template})...`);

  // 批 3:游戏模板 → 四件套落地(可玩 demo + GDD + qa 套件 + 调参表)
  const { GAME_TEMPLATES, readGameTemplateFiles } = await import('./game-templates.js');
  // B-1(审查):未知模板显式报错列出可用项——小白拼错模板名不能静默降级成空骨架
  if (template !== 'empty' && !GAME_TEMPLATES[template]) {
    console.error(`Unknown template "${template}".`);
    console.error(`Available game templates: ${Object.keys(GAME_TEMPLATES).join(', ')} (or "empty" for a bare skeleton)`);
    process.exit(1);
  }

  // 创建项目目录
  mkdirSync(projectDir, { recursive: true });

  if (GAME_TEMPLATES[template]) {
    writeFileSync(join(projectDir, 'project.godot'), [
      '; Engine configuration file.',
      "; It's best edited using the editor UI and not directly.",
      '',
      '[application]',
      '',
      `config/name="${name}"`,
      'config/features=PackedStringArray("4.2", "GL Compatibility")',
      'run/main_scene="res://main.tscn"',
      '',
      '[display]',
      '',
      'window/size/viewport_width=1280',
      'window/size/viewport_height=720',
      '',
    ].join('\n'), 'utf-8');
    for (const f of readGameTemplateFiles(template)) {
      const dest = join(projectDir, f.path);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, f.content, 'utf-8');
    }
    console.log(`\n✓ Game project created at ${projectDir}`);
    console.log(`  模板: ${GAME_TEMPLATES[template]!.title} — ${GAME_TEMPLATES[template]!.summary}`);
    console.log('\n试玩与验证(qa 确定性套件,seed 锁随机):');
    console.log(`  cd ${name} && npx godot-mcp-enhanced qa run qa/${template}.qa.md --project .`);
    console.log('调参:编辑 tuning-src/' + template + '.csv → csv_to_resources 重导 .tres → 重启生效(见 design/gdd)');
    return;
  }

  // I-07: 写入 Godot 4.x 兼容的 project.godot，包含 config/features 声明
  writeFileSync(join(projectDir, 'project.godot'), [
    '; Engine configuration file.',
    "; It's best edited using the editor UI and not directly.",
    '',
    '[application]',
    '',
    `config/name="${name}"`,
    'config/features=PackedStringArray("4.2", "GL Compatibility")',
    '',
    '[display]',
    '',
    'window/size/viewport_width=1280',
    'window/size/viewport_height=720',
    '',
  ].join('\n'), 'utf-8');

  // 写入 scenes 目录
  mkdirSync(join(projectDir, 'scenes'), { recursive: true });

  // 提示运行 setup_project_rules
  console.log(`\n✓ Project created at ${projectDir}`);
  console.log('\nNext steps:');
  console.log(`  1. cd ${name}`);
  console.log('  2. Open in AI editor (Claude Code / Cursor)');
  console.log('  3. Run setup_project_rules to generate CLAUDE.md and hooks');
}
