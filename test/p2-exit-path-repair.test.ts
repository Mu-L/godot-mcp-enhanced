import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { EXIT_CODES, ALL_EXIT_VALUES, describeExitCode } from '../src/core/exit-codes.js';
import { resolveWithinRoot } from '../src/core/path-utils.js';
import { repairOrphanedBridgeAutoload } from '../src/gdscript-executor.js';

/**
 * P2-4 (2026-09-11): bridge .uid 清理 + orphan autoload 前置自愈(来源 Erodenn bridge-manager)。
 * P2-5 (2026-09-11): CLI 退出码单一注册表 + 静态扫描 CI 断言(来源 aigengame exit_codes.py)。
 * P2-6 (2026-09-11): drive-relative/UNC/绝对路径逃逸用例(来源 BuildersGate padserver 实测形态;
 *   climbing-glob 不适用——enhanced 无用户 glob 参数直通 path-utils,扫描均来自磁盘遍历)。
 */

describe('P2-5: 退出码注册表', () => {
  it('EX-a: 值唯一且符合 shell 惯例(0 ok / 1 op / 2 usage)', () => {
    expect([...new Set(ALL_EXIT_VALUES)].length, '值唯一').toBe(ALL_EXIT_VALUES.length);
    expect(EXIT_CODES.EXIT_OK).toBe(0);
    expect(EXIT_CODES.EXIT_OPERATION_FAILED).toBe(1);
    expect(EXIT_CODES.EXIT_USAGE).toBe(2);
    expect(describeExitCode(0)).toBe('OK');
    expect(describeExitCode(99)).toContain('UNKNOWN');
  });

  it('EX-b: 静态扫描——src/cli 的 process.exit 字面值全部 ∈ 注册表', () => {
    const violations: string[] = [];
    const scan = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { scan(full); continue; }
        if (!name.endsWith('.ts')) continue;
        const src = readFileSync(full, 'utf8');
        for (const m of src.matchAll(/process\.exit\((\d+)\)/g)) {
          const val = Number(m[1]);
          if (!ALL_EXIT_VALUES.includes(val as never)) {
            violations.push(`${full}: exit(${val}) 不在注册表`);
          }
        }
      }
    };
    scan(resolve(__dirname, '..', 'src', 'cli'));
    expect(violations, violations.join('\n')).toEqual([]);
  });
});

describe('P2-6: 路径逃逸形态矩阵(drive-relative 等)', () => {
  const root = resolve(tmpdir(), 'p2-path-escape-probe');
  beforeAllProbe();
  function beforeAllProbe(): void {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'seed.txt'), 'x');
  }

  it('PATH-a: drive-relative("C:x" 丢弃 base 解析到 cwd 外)被拒;项目内绝对路径放行', () => {
    expect(() => resolveWithinRoot(root, 'C:evil.gd')).toThrow();
    expect(() => resolveWithinRoot(root, 'C:')).toThrow();
    expect(() => resolveWithinRoot(root, 'c:/evil.gd'), '带根但项目外 → relative 兜底拒').toThrow();
    // 回归锚(P2 审查修正):项目内绝对路径是 read_scene 等的合法用法(e2e 在用),不得误拒
    expect(resolveWithinRoot(root, join(root, 'seed.txt')), '项目内绝对路径放行').toContain('seed.txt');
  });

  it('PATH-b: UNC / 绝对路径 / .. 段被拒', () => {
    expect(() => resolveWithinRoot(root, String.raw`\\server\share\evil.gd`)).toThrow();
    expect(() => resolveWithinRoot(root, resolve(root, '..', 'evil.gd'))).toThrow();
    expect(() => resolveWithinRoot(root, '../escape.gd')).toThrow();
    expect(() => resolveWithinRoot(root, 'foo/../../escape.gd')).toThrow();
  });

  it('PATH-c: 合法含点文件名不误拒(F-4 段级精确回归锚)', () => {
    expect(resolveWithinRoot(root, 'my..file.txt')).toBeTruthy();
    expect(resolveWithinRoot(root, '..hidden')).toBeTruthy();
    expect(() => resolveWithinRoot(root, 'sub/..bar.gd'), '子目录含点开头文件名不抛').not.toThrow();
  });
});

describe('P2-4: orphan bridge autoload(IO 壳冒烟;纯函数断言在 test/p2-orphan-pure.test.ts)', () => {
  // 行为断言走纯函数 removeOrphanBridgeLines(vitest worker 的 fs 视图怪象不影响判定;
  // IO 壳 repairOrphanedBridgeAutoload 在 node 直跑验证 true,见批次审查文档)。
  it('REP-b2: IO 壳冒烟——脚本存在(正常安装)时不修(零写入)', () => {
    const proj = resolve(tmpdir(), 'p2-orphan-smoke');
    rmSync(proj, { recursive: true, force: true });
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, 'project.godot'), '[autoload]\n\nMCPBridge="*res://mcp_bridge.gd"\n');
    writeFileSync(join(proj, 'mcp_bridge.gd'), 'extends Node');
    expect(repairOrphanedBridgeAutoload(proj), '脚本在 → 不修').toBe(false);
    expect(existsSync(join(proj, 'mcp_bridge.gd'))).toBe(true);
  });

  it('REP-c: uninstall .uid 清理契约(源码落位)', () => {
    const gb = readFileSync('src/tools/game-bridge.ts', 'utf8');
    const idx = gb.indexOf("unlinkSync(scriptPath)");
    const slice = gb.slice(idx, idx + 600);
    expect(slice.includes(".uid"), 'uninstall 删脚本后同步删 .uid 伴随文件').toBe(true);
  });
});
