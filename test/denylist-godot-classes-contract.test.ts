// B-2 (2026-08-14): call_method deny-list 拼写契约测试。
// 根因:deny-list 写 call_threadsafe(无下划线),Godot 4 真实方法名是 call_thread_safe
// (data/godot-classes.json 实证:call_thread_safe 定义于 Node,call_threadsafe 零定义),
// deny 永不命中 → engine.call_method(node,"call_thread_safe",["set_script",...]) 绕
// deny-list → 编辑器进程 RCE。2026-08-11 审查建议文本用错拼写,A5 修复照抄固化。
// 本测试从 data/godot-classes.json 生成契约,防未来再次固化错误拼写。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));

/** GDScript 侧 const 数组成员提取:从 `const NAME := [` 行起逐行扫描,直到独占一行的
 *  `]` 结束。逐行 + 显式结束行(而非非贪婪正则到 `]`)是必须的:deny-list 行内注释含
 *  `callv("set",["script",val])` / `args=["set_script", ...]` 之类的 `]`,非贪婪匹配
 *  会在注释中间截断丢成员(实测 bridge 侧曾因此丢 call_deferred/call_threadsafe/
 *  queue_delete 三个成员,契约假绿)。每行剥 # 行内注释后提取 "..." 字符串。 */
function parseGdStringArray(gdSrc: string, constName: string): string[] {
  // `^` 锚定行首(逐行 test + m 标志):防注释行恰好含 `const X := [` 文本时被误认
  // 为数组起点(如 `# const DEFAULT_CALL_DENYLIST := [...历史说明...]`)误吞成员。
  const startRe = new RegExp(`^const ${constName} := \\[`, 'm');
  const names: string[] = [];
  let inArray = false;
  for (const rawLine of gdSrc.split('\n')) {
    if (!inArray) {
      if (startRe.test(rawLine)) {
        inArray = true;
        // const 声明行自身可能带成员(const X := ["a","b"]),剥 [ 之后处理
        const bracketIdx = rawLine.indexOf('[', rawLine.indexOf(constName));
        collectStrings(rawLine.slice(bracketIdx + 1).split('#')[0] ?? '', names);
      }
      continue;
    }
    if (rawLine.trim() === ']') break; // 数组结束行
    collectStrings(rawLine.split('#')[0] ?? '', names);
  }
  if (!inArray) throw new Error(`${constName} array not found in source`);
  return names;
}

function collectStrings(codeOnly: string, names: string[]): void {
  for (const sm of codeOnly.matchAll(/"([^"]+)"/g)) {
    names.push(sm[1]!);
  }
}

// godot-classes.json(godot_version 4.7.stable.official)全 1036 类方法名并集
function loadAllMethodNames(): Set<string> {
  const raw = JSON.parse(readFileSync(join(PROJECT_ROOT, 'data', 'godot-classes.json'), 'utf-8')) as {
    godot_version: string;
    classes: Array<{ name: string; methods?: Array<{ name: string }> }>;
  };
  const all = new Set<string>();
  for (const c of raw.classes) {
    for (const m of c.methods ?? []) all.add(m.name);
  }
  if (all.size < 1000) throw new Error(`godot-classes.json suspiciously small: ${all.size} methods`);
  return all;
}

const ENGINE_DENYLIST = parseGdStringArray(
  readFileSync(join(PROJECT_ROOT, 'addons', 'godot_mcp_server', 'commands', 'engine_commands.gd'), 'utf-8'),
  'DEFAULT_CALL_DENYLIST',
);
const BRIDGE_BLOCKLIST = parseGdStringArray(
  readFileSync(join(PROJECT_ROOT, 'src', 'scripts', 'mcp_bridge.gd'), 'utf-8'),
  'EXTRA_METHODS_BLOCKLIST',
);

// free 是 GDScript 内建 Object.free()(销毁实例),extension_api dump 的 methods 数组
// 不含它(2026-08-14 实测全 json 零定义),属合法 deny 项 → 契约白名单例外。
const BUILTIN_EXCEPTIONS = new Set(['free']);

describe('B-2: deny-list 与 godot-classes.json 拼写契约', () => {
  const allMethods = loadAllMethodNames();

  describe.each([
    ['engine DEFAULT_CALL_DENYLIST', ENGINE_DENYLIST],
    ['bridge EXTRA_METHODS_BLOCKLIST', BRIDGE_BLOCKLIST],
  ] as const)('%s', (_label, denylist) => {
    it('每个 deny 方法名都真实存在于 godot-classes.json(或内建例外表)', () => {
      const typos = denylist.filter(m => !allMethods.has(m) && !BUILTIN_EXCEPTIONS.has(m));
      expect(typos, `deny-list 含 godot-classes.json 不存在的方法名(拼写固化错误): ${typos.join(', ')}`).toEqual([]);
    });

    it('含 call_thread_safe(Godot 4 真实拼写,下划线)', () => {
      expect(denylist).toContain('call_thread_safe');
    });

    it('含 propagate_call(子树递归调用入口)', () => {
      expect(denylist).toContain('propagate_call');
    });

    it('含 set_script(脚本注入 = RCE)', () => {
      expect(denylist).toContain('set_script');
    });

    it('不含错误拼写 call_threadsafe(无下划线)', () => {
      expect(denylist).not.toContain('call_threadsafe');
    });
  });

  it('godot-classes.json 契约基准:call_thread_safe 与 propagate_call 确实存在(防 json 漂移致契约失效)', () => {
    // 若 data/godot-classes.json 未来升级后这两个方法名变化,本测试失败提醒重核 deny-list
    expect(allMethods.has('call_thread_safe'), 'call_thread_safe 应存在于 godot-classes.json(Node 方法)').toBe(true);
    expect(allMethods.has('propagate_call'), 'propagate_call 应存在于 godot-classes.json(Node 方法)').toBe(true);
    expect(allMethods.has('call_threadsafe'), 'call_threadsafe(错误拼写)不应存在于 godot-classes.json').toBe(false);
  });
});
