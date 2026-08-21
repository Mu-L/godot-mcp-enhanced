/**
 * 批 3 (2026-08-21) CLI 参数一致性测试(审查F-1/F-2/测试G-3):
 * - args.ts 共享双形式 helper 纯函数矩阵(空格/等号/相邻消费/钳制/NaN exit 2)
 * - parseInitArgs 集成(F-1 主张:`init mygame --template 2048` 空格形式不再静默落空骨架)
 * - 五命令接线契约(不再各自内嵌私有解析,统一 import args.js)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { opt, hasFlag, num } from '../src/cli/args.js';
import { parseInitArgs } from '../src/cli/init.js';

describe('args.ts 双形式 helper', () => {
  it('opt: 空格形式(相邻消费)与等号形式都取到值', () => {
    expect(opt(['--fps', '5'], 'fps')).toBe('5');
    expect(opt(['--fps=5'], 'fps')).toBe('5');
    expect(opt(['--out', 'a.gif', '--fps=5'], 'out')).toBe('a.gif');
  });

  it('opt: 等号值含 = 不被切断(值原样保留)', () => {
    expect(opt(['--target=a=b'], 'target')).toBe('a=b');
  });

  it('opt: 无值 flag 不吞后续 flag 的参数;缺失返回 undefined', () => {
    expect(opt(['--out', '--fps'], 'out')).toBe('--fps'); // 相邻消费是字面语义(与 gif 原实现一致)
    expect(opt(['--json', 'spec.md'], 'project')).toBeUndefined();
  });

  it('hasFlag: 两种形态都识别;无 flag 返回 false', () => {
    expect(hasFlag(['--force'], 'force')).toBe(true);
    expect(hasFlag(['--force=true'], 'force')).toBe(true);
    expect(hasFlag(['--target=/p'], 'target')).toBe(true);
    expect(hasFlag(['install'], 'force')).toBe(false);
  });

  it('num: 缺省回落 fallback;range 钳制上下界', () => {
    expect(num([], 'fps', 4)).toBe(4);
    expect(num(['--fps', '0'], 'fps', 4, [1, 10])).toBe(1);
    expect(num(['--fps', '11'], 'fps', 4, [1, 10])).toBe(10);
    expect(num(['--fps=7'], 'fps', 4, [1, 10])).toBe(7);
    expect(num(['--seed=123'], 'seed', 42)).toBe(123);
  });

  it('num: 非数字 exit 2 且报真因(不 NaN 传播)', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('EXIT_2');
    }) as never);
    expect(() => num(['--fps', 'abc'], 'fps', 4)).toThrow('EXIT_2');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('--fps'));
    expect(exitSpy).toHaveBeenCalledWith(2);
    errSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe('parseInitArgs(F-1:--template 空格形式不再静默落空骨架)', () => {
  it('空格形式取到模板名(修复前只认等号,静默回落 empty)', () => {
    expect(parseInitArgs(['mygame', '--template', '2048']).template).toBe('2048');
  });

  it('等号形式仍工作(回归)', () => {
    expect(parseInitArgs(['mygame', '--template=snake']).template).toBe('snake');
  });

  it('缺省回落 empty;name 缺省 my-game(回归)', () => {
    expect(parseInitArgs(['mygame']).template).toBe('empty');
    expect(parseInitArgs([]).name).toBe('my-game');
  });
});

describe('五命令接线契约(不再内嵌私有解析)', () => {
  const read = (f: string) => readFileSync(f, 'utf8');

  it('gif/web/qa/skills/init 均 import args.js 且不再有内嵌双形式实现', () => {
    const files = [
      'src/cli/gif.ts', 'src/cli/web.ts', 'src/cli/qa.ts',
      'src/cli/skills.ts', 'src/cli/init.ts',
    ];
    for (const f of files) {
      expect(read(f).includes("from './args.js'"), `${f} 未接 args.ts`).toBe(true);
    }
    // gif/web 原内嵌 opt 定义应已删除(定义形态:`function opt(args: string[]`)
    expect(read('src/cli/gif.ts').includes('function opt('), 'gif.ts 仍有内嵌 opt').toBe(false);
    expect(read('src/cli/web.ts').includes('function opt('), 'web.ts 仍有内嵌 opt').toBe(false);
  });

  it('skills --target 接线:indexOf 裸匹配已删,走 hasFlag+opt', () => {
    const s = read('src/cli/skills.ts');
    expect(s.includes("args.indexOf('--target')"), '仍有 indexOf 裸匹配').toBe(false);
    expect(s.includes('hasFlag(args, \'target\')')).toBe(true);
  });

  it('qa parseFlag 接线:值提取走共享 opt', () => {
    expect(read('src/cli/qa.ts').includes('value: opt(rest, bare)')).toBe(true);
  });
});
