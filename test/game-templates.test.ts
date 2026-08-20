import { describe, it, expect } from 'vitest';
import { join } from 'path';

// ─── 批 3:可玩游戏模板库四件套契约测试 ───────────────────────────────────────
// 结构契约(meta files 实存)+ 内容契约(GDD 过自家 validateGDD 零 error / qa-spec 围栏
// JSON 可解析且含确定性 options / CSV 与 .tres 字段同名同值 / .tres 是 Resource)。

import {
  GAME_TEMPLATES,
  getGameTemplateDir,
  readGameTemplateFiles,
  listGameTemplates,
} from '../src/cli/game-templates.js';
import { validateGDD } from '../src/tools/game-design.js';

const SLUGS = ['2048', 'snake', 'breakout'];

describe('游戏模板注册表', () => {
  it('三个模板齐(2048/snake/breakout)', () => {
    expect(Object.keys(GAME_TEMPLATES).sort()).toEqual(['2048', 'breakout', 'snake']);
    expect(listGameTemplates().length).toBe(3);
  });

  it('readGameTemplateFiles 返回 meta 声明的全部文件(实存)', () => {
    for (const slug of SLUGS) {
      const files = readGameTemplateFiles(slug);
      expect(files.map(f => f.path)).toEqual([...GAME_TEMPLATES[slug]!.files]);
      for (const f of files) expect(f.content.length).toBeGreaterThan(10);
    }
  });

  it('未知模板报错并列出可用项', () => {
    expect(() => readGameTemplateFiles('tetris')).toThrow(/2048.*snake.*breakout|Available/);
  });

  it('四件套必备路径齐全(main.tscn/scripts/game.gd/GDD/qa/csv/tres)', () => {
    for (const slug of SLUGS) {
      const paths = GAME_TEMPLATES[slug]!.files;
      for (const required of ['main.tscn', 'scripts/game.gd', `design/gdd/${slug}.md`, `qa/${slug}.qa.md`, `tuning/${slug}.csv`, `tuning/${slug}.tres`]) {
        expect(paths).toContain(required);
      }
    }
  });
});

describe('GDD 过自家 validate_gdd 校验器(自产自销)', () => {
  it.each(SLUGS)('%s GDD 零 error', (slug) => {
    const gdd = readGameTemplateFiles(slug).find(f => f.path === `design/gdd/${slug}.md`)!.content;
    const result = validateGDD(gdd);
    const errors = result.issues.filter(i => i.severity === 'error');
    expect(errors).toEqual([]);
    expect(result.sections_missing).toEqual([]);
  });
});

describe('qa 套件(确定性契约)', () => {
  it.each(SLUGS)('%s qa-spec 围栏 JSON 合法且含 seed', (slug) => {
    const qa = readGameTemplateFiles(slug).find(f => f.path === `qa/${slug}.qa.md`)!.content;
    const match = qa.match(/```qa-spec\s*\n([\s\S]*?)```/);
    expect(match).toBeTruthy();
    const spec = JSON.parse(match![1]!);
    expect(typeof spec.name).toBe('string');
    expect(typeof spec.options.seed).toBe('number');
    expect(Array.isArray(spec.steps)).toBe(true);
    expect(spec.steps.length).toBeGreaterThanOrEqual(3);
    // 确定性三件套:freeze + send_input_sequence 时间线 + step_until/assert
    const types = spec.steps.map((s: { type: string }) => s.type);
    expect(types).toContain('freeze');
    expect(types).toContain('input');
    expect(types).toContain('unfreeze');
  });
});

describe('调参表(CSV ↔ .tres 对应)', () => {
  it.each(SLUGS)('%s CSV 字段值与 .tres 一致', (slug) => {
    const files = readGameTemplateFiles(slug);
    const csv = files.find(f => f.path === `tuning/${slug}.csv`)!.content.trim();
    const tres = files.find(f => f.path === `tuning/${slug}.tres`)!.content;

    expect(tres).toContain('[gd_resource type="Resource"');
    expect(tres).toContain('script = ExtResource');

    const [headerLine, dataLine] = csv.split(/\r?\n/);
    const headers = headerLine!.split(',');
    const values = dataLine!.split(',');
    expect(headers[0]).toBe('filename');
    expect(values[0]).toBe(slug);
    // 每个非 filename 字段在 .tres 中同名赋值(数值容忍 float 序列化尾零:csv 120 ↔ tres 120.0)
    for (let i = 1; i < headers.length; i++) {
      const field = headers[i]!;
      const value = values[i]!;
      const num = Number(value);
      const pattern = Number.isFinite(num) && value.trim() !== ''
        ? `^${field} = ${num}(\\.0+)?$`
        : `^${field} = ${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
      expect(tres).toMatch(new RegExp(pattern, 'm'));
    }
  });
});

describe('资产目录定位', () => {
  it('getGameTemplateDir 指向存在的目录(开发态 src/game-templates)', () => {
    const dir = getGameTemplateDir();
    expect(dir).toContain('game-templates');
    expect(join(dir, '2048', 'main.tscn')).toContain('game-templates');
  });
});

// ─── T2:init --template 四件套落地 ────────────────────────────────────────────

import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';

describe('init --template 落地四件套', () => {
  const origCwd = process.cwd();
  afterEach(() => process.chdir(origCwd));

  it('init t2048 --template=2048 → 四件套齐全 + main_scene 注册', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'gme-init-'));
    process.chdir(sandbox);
    const { runInit } = await import('../src/cli/init.js');
    await runInit(['t2048', '--template=2048']);
    const proj = join(sandbox, 't2048');
    for (const rel of ['project.godot', 'main.tscn', 'scripts/game.gd', 'scripts/game_config_2048.gd', 'design/gdd/2048.md', 'qa/2048.qa.md', 'tuning/2048.csv', 'tuning/2048.tres']) {
      expect(existsSync(join(proj, rel))).toBe(true);
    }
    const godot = readFileSync(join(proj, 'project.godot'), 'utf-8');
    expect(godot).toContain('run/main_scene="res://main.tscn"');
    expect(godot).toContain('config/name="t2048"');
    process.chdir(origCwd);  // Windows 不允许删除 cwd,先离开 sandbox 再清理
    rmSync(sandbox, { recursive: true, force: true });
  });
});

// ─── 审查 B-1:CLI 入口层未知模板报错(非底层 throw——plan 验收点是 init 行为) ──

describe('init 未知模板(B-1)', () => {
  const home = process.cwd();
  it('init --template=tetris → exit 1 列出可用项,不建目录', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'gme-init-bad-'));
    process.chdir(sandbox);
    const { runInit } = await import('../src/cli/init.js');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('EXIT_1'); }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(runInit(['tbad', '--template=tetris'])).rejects.toThrow('EXIT_1');
    expect(errSpy.mock.calls.flat().join(' ')).toMatch(/2048.*snake.*breakout|Available/);
    exitSpy.mockRestore();
    errSpy.mockRestore();
    expect(existsSync(join(sandbox, 'tbad'))).toBe(false);  // 不静默建空骨架
    process.chdir(home);
    rmSync(sandbox, { recursive: true, force: true });
  });
});
