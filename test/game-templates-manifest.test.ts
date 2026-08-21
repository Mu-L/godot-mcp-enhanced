// game-templates manifest 漂移守护(2026-08-21 架构审查 D-3)
//
// src/cli/game-templates.ts 的 GAME_TEMPLATES.files 清单是手工维护的,与磁盘存在双源
// 漂移风险(新增文件忘登清单 → init 时运行时 throw,而非打包/CI 阶段发现)。本测试
// 双向对账:清单列的每个文件必须在磁盘上存在;磁盘上的业务文件必须已登记——
// 把发现点从「用户 init 报错」前移到「npm test」。
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { GAME_TEMPLATES, getGameTemplateDir } from '../src/cli/game-templates.js';

const templatesRoot = getGameTemplateDir();

/** 递归收集模板目录内全部文件(相对模板根,统一 / 分隔)。 */
function walkFiles(dir: string, base: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      walkFiles(abs, base, out);
    } else {
      out.push(relative(base, abs).replace(/\\/g, '/'));
    }
  }
  return out;
}

describe('game-templates manifest 漂移守护', () => {
  const slugs = Object.keys(GAME_TEMPLATES);

  it('注册表非空', () => {
    expect(slugs.length).toBeGreaterThanOrEqual(3);  // 2048/snake/breakout
  });

  for (const slug of slugs) {
    it(`${slug}: files 清单与磁盘双向一致`, () => {
      const tplDir = join(templatesRoot, slug);
      const diskSet = new Set(walkFiles(tplDir, tplDir));

      // 方向 1:清单列的文件必须存在(防 init 硬失败)
      for (const f of GAME_TEMPLATES[slug]!.files) {
        expect(diskSet.has(f), `${slug}: 清单列了磁盘上不存在的文件 ${f}`).toBe(true);
      }

      // 方向 2:磁盘文件必须登记(防新增文件忘登 → init 漏拷)
      const manifestSet = new Set(GAME_TEMPLATES[slug]!.files);
      const untracked = [...diskSet].filter(f => !manifestSet.has(f));
      expect(untracked, `${slug}: 磁盘存在未登记进 files 清单的文件(会被 init 漏拷):${untracked.join(', ')}`).toEqual([]);
    });
  }

  it('磁盘模板目录与注册表一一对应(防新增目录忘注册)', () => {
    const diskDirs = readdirSync(templatesRoot).filter(n => statSync(join(templatesRoot, n)).isDirectory());
    expect(diskDirs.sort()).toEqual([...slugs].sort());
  });
});
