# PR-1a:QA 断言四件套 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 QA 套件新增 4 种断言(screenshot_diff / signal / errors / monitor)+ 4 个控制步骤(watch_start|stop / monitor_start|stop),修复 runtime-assert screenshot_diff 占位为真实现,并重构 qa 工具描述(schema 字段 description 迁移)。

**Architecture:** 判定逻辑分层——screenshot_diff 真实现放 `runtime-assert.ts` 并导出(qa runner 直调,同源防 drift,与既有 4 断言一致);signal/errors/monitor 是套件内跨步骤状态依赖的断言,在 `qa/runner.ts` 本地实现;跨步骤状态收拢进 `RunState` 对象随 execStep 传递。`resolveGameDataPath` 从 `qa/runner.ts` 上移到新 `src/tools/game-fs.ts`(runtime-assert 需要,避免循环依赖)。

**Tech Stack:** TypeScript(ES2022/strict/ESM,import 带 `.js` 后缀)+ zod v4 + Vitest + pngjs(已有依赖,零新增)。

**Spec:** `docs/plans/2026-08-17-qa-deepening-spec.md` §1(PR-1a)+ §0.5 约束 + §4/§5 验收。

## Global Constraints

- 工作目录 `D:\GitHub\godot-mcp-series\godot-mcp-enhanced`;不提交大文件;commit 走 Conventional Commits(`feat(qa):` / `test(qa):` 前缀,subject 中文)。
- 默认分支 master 不开 commit——所有任务在 `feat/qa-assert-batch` 分支执行(首个任务创建)。
- TypeScript:`strict` + `noUncheckedIndexedAccess`,禁 `any`,未使用变量报错;ESM import 必须带 `.js`。
- mock 必须带 bridge 真实 shape:`watch.poll → {watching, events:[{frame,time,args}]}`、`watch.stop → {watching:false, events, event_count}`、`monitor.poll → {monitoring, samples:[{frame,time,values:{...}}]}`、`monitor.stop → {monitoring:false, samples, stopped_reason}`、`get_errors → {errors:[{seq,kind,message,…}], next_seq}`、`take_screenshot → {success, path(user://), size:{x,y}}`(无 base64)。
- **取数路径铁律(spec B-2)**:watch/monitor 断言 poll 优先;返回非 active 且 qa 记录过 active → 补 `watch.stop`/`monitor.stop` 取全量(GD 侧 max_events 满/node_lost 后自动置 inactive,poll 返回空)。
- threshold 语义=**差异容忍**(值越小越严,默认 0.12);描述禁用"相似度"措辞(spec B-1,三入口语义区分)。
- 每任务完成后跑 `npm run lint` 相关文件 + 该任务测试;全部任务完成后跑全量 `npm run build` + `npm test` + `npm run build-matrix` + `npm run check:budget`。
- `reference`(screenshot_diff)与 `project_path` 必须过 `isPathInAllowedRoots` 白名单。

---

### Task 1:上移 resolveGameDataPath 到 src/tools/game-fs.ts

**Files:**
- Create: `src/tools/game-fs.ts`
- Modify: `src/tools/qa/runner.ts`(删原函数,改 import + re-export)

**Interfaces:**
- Consumes: `src/tools/qa/runner.ts:33-65` 现有 `resolveGameDataPath`(原样搬移)。
- Produces: `export function resolveGameDataPath(projectPath: string, userUri: string): string | null`(签名不变,后续 Task 6/7 的 runtime-assert 与 runner 共用)。

- [ ] **Step 1:创建分支**

```bash
cd "D:/GitHub/godot-mcp-series/godot-mcp-enhanced"
git checkout -b feat/qa-assert-batch
```

- [ ] **Step 2:创建 src/tools/game-fs.ts(函数原样搬移)**

```ts
// src/tools/game-fs.ts — 游戏侧 user:// URI ↔ 本机绝对路径解析
//
// 2026-08-17 从 qa/runner.ts 上移:runtime-assert 的 screenshot_diff 真实现需要同一
// 函数,而依赖方向是 qa/runner → runtime-assert(复用 4 断言),反向引用会成环,
// 故下沉到本文件(runtime-assert 与 qa/runner 都在其下游)。

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * 把游戏侧 user:// URI 解析为本地绝对路径(Godot app_userdata 布局,三平台)。
 * 读 project.godot 的 config/name(use_custom_user_dir 时用 custom_user_dir_name)。
 * 解析不出/文件不存在返回 null(调用方诚实降级,只记录游戏侧路径)。
 */
export function resolveGameDataPath(projectPath: string, userUri: string): string | null {
  if (!userUri.startsWith('user://')) return null;
  const rel = userUri.slice('user://'.length);
  let projectName: string;
  let customDir: string;
  try {
    const cfg = readFileSync(join(projectPath, 'project.godot'), 'utf-8');
    const nameM = cfg.match(/^config\/name\s*=\s*"([^"]*)"/m);
    projectName = nameM?.[1] ?? '';
    const customM = cfg.match(/^config\/custom_user_dir_name\s*=\s*"([^"]*)"/m);
    customDir = customM?.[1] ?? '';
    if (/^config\/use_custom_user_dir\s*=\s*true/m.test(cfg)) {
      // use_custom_user_dir: 目录 = <appdata>/<custom_user_dir_name>(Godot 用项目名兜底)
      customDir = customDir || projectName;
      projectName = '';
    }
  } catch {
    return null;
  }
  const home = homedir();
  let base: string;
  if (process.platform === 'win32') {
    base = join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Godot');
  } else if (process.platform === 'darwin') {
    base = join(home, 'Library', 'Application Support', 'Godot');
  } else {
    base = join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'godot');
  }
  const dir = customDir ? join(base, customDir) : projectName ? join(base, 'app_userdata', projectName) : null;
  if (!dir) return null;
  const abs = join(dir, rel);
  return existsSync(abs) ? abs : null;
}
```

- [ ] **Step 3:修改 src/tools/qa/runner.ts**

删除 `runner.ts:28-65` 的 `resolveGameDataPath` 函数定义(保留文件头注释与 `resolveGameDataPath` 的 JSDoc 移入 game-fs.ts),并在 import 区加:

```ts
import { resolveGameDataPath } from '../game-fs.js';
// re-export:保 test/qa-runner.test.ts 既有 import 路径兼容
export { resolveGameDataPath };
```

同时从 runner.ts 的 `import { mkdirSync, readFileSync, ... } from 'fs'` 中移除不再使用的符号(检查:`readFileSync`/`existsSync` 仍被 errors baseline 等使用则保留,以 lint 无 unused 为准;`homedir` 若仅 resolveGameDataPath 用则从 os import 中删除)。

- [ ] **Step 4:验证——现有测试回归(搬移不改行为)**

```bash
npx vitest run test/qa-runner.test.ts
```
Expected: 全部 PASS(现有用例数不变,无 failed)。

- [ ] **Step 5:类型检查**

```bash
npx tsc --noEmit
```
Expected: 0 错误。

- [ ] **Step 6:Commit**

```bash
git add src/tools/game-fs.ts src/tools/qa/runner.ts
git commit -m "refactor(qa): resolveGameDataPath 上移 game-fs.ts(runtime-assert 复用解环)"
```

---

### Task 2:spec.ts 新增 4 控制步骤 + assertStep 扩展

**Files:**
- Modify: `src/tools/qa/spec.ts`
- Test: `test/qa-spec.test.ts`

**Interfaces:**
- Produces: `QaStepSchema` 新增 4 literal(`watch_start`/`watch_stop`/`monitor_start`/`monitor_stop`);`assertStep.assert` enum 扩为 8 值;新字段 `reference`/`max_diff_ratio`/`min_count`/`max_count`/`args_match`/`kinds`/`property`/`monotonic`。`QA_STEP_TYPES` 导出加 4 值(Task 3+ 依赖此导出)。

- [ ] **Step 1:写失败测试(test/qa-spec.test.ts 追加)**

```ts
describe('QA spec: watch/monitor 控制步骤 + 新断言(Task PR-1a)', () => {
  const base = { name: 's', steps: [{ type: 'input', method: 'send_key', params: { key: 'ui_accept' } }] };

  it('watch_start/watch_stop/monitor_start/monitor_stop 四控制步骤合法', () => {
    const r = parseQaSuite({
      ...base,
      steps: [
        { type: 'watch_start', node_path: '/root/Main', signal_name: 'pressed' },
        { type: 'watch_stop' },
        { type: 'monitor_start', node_path: '/root/Main/Player', properties: ['health'], interval_frames: 5 },
        { type: 'monitor_stop' },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.suite?.steps.map(s => s.type)).toEqual(['watch_start', 'watch_stop', 'monitor_start', 'monitor_stop']);
  });

  it('watch_start 缺 signal_name → 校验失败且错误可读', () => {
    const r = parseQaSuite({ ...base, steps: [{ type: 'watch_start', node_path: '/root/Main' }] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('signal_name');
  });

  it('monitor_start 空 properties 数组 → 校验失败', () => {
    const r = parseQaSuite({ ...base, steps: [{ type: 'monitor_start', node_path: '/root/M', properties: [] }] });
    expect(r.ok).toBe(false);
  });

  it('assert 扩展 4 值合法 + 新字段解析', () => {
    const r = parseQaSuite({
      ...base,
      steps: [
        { type: 'assert', assert: 'screenshot_diff', reference: 'D:/ref/x.png', threshold: 0.12, max_diff_ratio: 0.05 },
        { type: 'assert', assert: 'signal', min_count: 2, max_count: 5, args_match: [{ x: 1, y: 2 }] },
        { type: 'assert', assert: 'errors', kinds: ['error', 'script'], max_count: 0 },
        { type: 'assert', assert: 'monitor', property: 'fps', min: 30, monotonic: 'non_decreasing' },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.suite?.steps[3]).toMatchObject({ assert: 'monitor', property: 'fps', monotonic: 'non_decreasing' });
  });

  it('assert 未知值仍被拒', () => {
    const r = parseQaSuite({ ...base, steps: [{ type: 'assert' as never, assert: 'nope' as never }] });
    expect(r.ok).toBe(false);
  });

  it('monotonic 非法值被拒', () => {
    const r = parseQaSuite({ ...base, steps: [{ type: 'assert', assert: 'monitor', property: 'x', monotonic: 'faster' as never }] });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2:跑测试确认失败**

```bash
npx vitest run test/qa-spec.test.ts
```
Expected: 新 describe 全 FAIL(`watch_start` 不在 discriminated union,报 invalid literal / unknown)。

- [ ] **Step 3:实现——src/tools/qa/spec.ts**

在 `sleepStep` 定义之后、`QA_STEP_TYPES` 之前追加:

```ts
/** watch_start:开始监听节点信号(bridge watch.start;每套件同时仅 1 个活跃 watch,重复→执行期 ERROR) */
const watchStartStep = z.object({
  type: z.literal('watch_start'),
  node_path: z.string().min(1),
  signal_name: z.string().min(1),
  max_events: z.number().int().min(1).max(5000).optional(),
  label: labelField,
});

const watchStopStep = z.object({ type: z.literal('watch_stop'), label: labelField });

/** monitor_start:开始属性时间线采样(bridge monitor.start;每套件同时仅 1 个活跃 monitor) */
const monitorStartStep = z.object({
  type: z.literal('monitor_start'),
  node_path: z.string().min(1),
  properties: z.array(z.string().min(1)).min(1).max(10),
  interval_frames: z.number().int().min(1).max(300).optional(),
  label: labelField,
});

const monitorStopStep = z.object({ type: z.literal('monitor_stop'), label: labelField });
```

`assertStep` 改为(assert enum 扩 4 值 + 新字段,原字段全保留):

```ts
const assertStep = z.object({
  type: z.literal('assert'),
  assert: z.enum(['node_state', 'scene_structure', 'screen_text', 'perf', 'screenshot_diff', 'signal', 'errors', 'monitor']),
  // node_state
  path: z.string().optional(),
  expect: z.record(z.string(), z.unknown()).optional(),
  tolerance: z.number().optional(),
  // scene_structure
  nodes: z.array(z.object({
    path: z.string(),
    type: z.string().optional(),
    absent: z.boolean().optional(),
  })).optional(),
  // screen_text
  text: z.string().optional(),
  present: z.boolean().optional(),
  // perf
  baseline: z.record(z.string(), z.number()).optional(),
  // screenshot_diff(像素差异容忍语义,与 screenshot 工具 action=diff 同引擎)
  reference: z.string().optional(),
  max_diff_ratio: z.number().min(0).max(1).optional(),
  // signal(事件计数区间;args_match 按 GD _jsonify 后形态深比较:Vector2→{x,y}、Color→{r,g,b,a})
  min_count: z.number().int().min(0).optional(),
  max_count: z.number().int().min(0).optional(),
  args_match: z.unknown().optional(),
  // errors(测试期间游戏侧新增错误计数)
  kinds: z.array(z.enum(['error', 'script', 'shader', 'warning'])).optional(),
  // monitor(属性时间线区间/单调性)
  property: z.string().optional(),
  monotonic: z.enum(['increasing', 'non_decreasing', 'decreasing', 'non_increasing']).optional(),
  label: labelField,
});
```

`QA_STEP_TYPES` 与 `QaStepSchema` 同步:

```ts
export const QA_STEP_TYPES = [
  'input', 'wait', 'wait_frames', 'freeze', 'unfreeze', 'step_until',
  'snapshot', 'restore', 'set', 'call', 'assert', 'screenshot', 'sleep',
  'watch_start', 'watch_stop', 'monitor_start', 'monitor_stop',
] as const;

export const QaStepSchema = z.discriminatedUnion('type', [
  inputStep, waitStep, waitFramesStep, freezeStep, unfreezeStep, stepUntilStep,
  snapshotStep, restoreStep, setStep, callStep, assertStep, screenshotStep, sleepStep,
  watchStartStep, watchStopStep, monitorStartStep, monitorStopStep,
]);
```

- [ ] **Step 4:跑测试确认通过**

```bash
npx vitest run test/qa-spec.test.ts
```
Expected: 全 PASS(旧用例 + 新 describe)。

- [ ] **Step 5:Commit**

```bash
git add src/tools/qa/spec.ts test/qa-spec.test.ts
git commit -m "feat(qa): spec 新增 watch/monitor 控制步骤与 screenshot_diff/signal/errors/monitor 断言 schema"
```

---

### Task 3:runner 执行 4 控制步骤 + RunState + teardown 兜底

**Files:**
- Modify: `src/tools/qa/runner.ts`
- Test: `test/qa-runner.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `QaStep` 新类型。
- Produces(后续 Task 4/5 依赖):
  ```ts
  interface RunState {
    watchActive: boolean;                       // 本套件是否已开 watch
    monitorActive: boolean;
    /** watch.stop 后缓存全量 events(断言可在 stop 之后用) */
    watchEventsCache: WatchEvent[] | null;
    /** errors baseline(含 errors 断言的套件在 setup 后采集;null=采集失败/未采集) */
    errorsBaselineSeq: number | null;
  }
  type WatchEvent = { frame: number; time: number; args: unknown[] };
  ```
  `execStep` 签名追加第 6 参 `runState: RunState`。

- [ ] **Step 1:写失败测试(test/qa-runner.test.ts 追加;沿用该文件既有 vi.mock('../src/tools/game-bridge.js') 与 setupMock 模式,扩展 sendToBridge 方法路由)**

```ts
describe('qa runner: watch/monitor 控制步骤(Task PR-1a)', () => {
  it('watch_start→watch_stop 正常执行,stop 后 detail 带事件数', async () => {
    vi.mocked(sendToBridge).mockImplementation(async (method: string) => {
      if (method === 'watch.start') return { result: { watching: true } };
      if (method === 'watch.stop') return { result: { watching: false, events: [{ frame: 10, time: 1.5, args: [42] }], event_count: 1 } };
      return { result: {} };
    });
    const suite = { name: 'w1', steps: [
      { type: 'watch_start', node_path: '/root/Main', signal_name: 'pressed' },
      { type: 'watch_stop' },
    ] } as never as QaSuite;
    const report = await runQaSuite(suite, 'D:/proj', makeCtx(), 'inline');
    expect(report.summary.status).toBe('PASSED');
    expect(report.steps[1]!.detail).toContain('1 event');
  });

  it('本套件重复 watch_start → 第二个 ERROR', async () => {
    // watch.poll 探测返回非 watching(无套件外 watch)
    vi.mocked(sendToBridge).mockImplementation(async (method: string) => {
      if (method === 'watch.start') return { result: { watching: true } };
      if (method === 'watch.poll') return { result: { watching: false, events: [] } };
      return { result: {} };
    });
    const suite = { name: 'w2', steps: [
      { type: 'watch_start', node_path: '/root/A', signal_name: 'x' },
      { type: 'watch_start', node_path: '/root/B', signal_name: 'y' },
    ] } as never as QaSuite;
    const report = await runQaSuite(suite, 'D:/proj', makeCtx(), 'inline');
    expect(report.steps[1]!.status).toBe('ERROR');
    expect(report.steps[1]!.detail).toContain('已有活跃 watch');
  });

  it('watch_start 时探测到套件外既有 watch → detail 注明已替换', async () => {
    vi.mocked(sendToBridge).mockImplementation(async (method: string) => {
      if (method === 'watch.poll') return { result: { watching: true, events: [{ frame: 1, time: 0.1, args: [] }] } };
      if (method === 'watch.start') return { result: { watching: true } };
      return { result: {} };
    });
    const suite = { name: 'w3', steps: [
      { type: 'watch_start', node_path: '/root/A', signal_name: 'x' },
    ] } as never as QaSuite;
    const report = await runQaSuite(suite, 'D:/proj', makeCtx(), 'inline');
    expect(report.steps[0]!.status).toBe('PASSED');
    expect(report.steps[0]!.detail).toContain('已替换');
  });

  it('步骤中断后(aborted)teardown 对未 stop 的 watch 兜底补 stop', async () => {
    const stopCalls: string[] = [];
    vi.mocked(sendToBridge).mockImplementation(async (method: string) => {
      if (method === 'watch.start') return { result: { watching: true } };
      if (method === 'send_key') return { result: {} };
      if (method === 'watch.stop') { stopCalls.push(method); return { result: { watching: false, events: [], event_count: 0 } }; }
      if (method === 'monitor.stop') { stopCalls.push(method); return { result: { monitoring: false, samples: [], stopped_reason: '' } }; }
      return { result: {} };
    });
    const suite = { name: 'w4', steps: [
      { type: 'watch_start', node_path: '/root/A', signal_name: 'x' },
      { type: 'input', method: 'send_key', params: { key: 'ui_accept' } },
    ] } as never as QaSuite;
    // input 会 PASSED,teardown 兜底仍应触发(套件结束时 watch 仍 active)
    const report = await runQaSuite(suite, 'D:/proj', makeCtx(), 'inline');
    expect(report.summary.status).toBe('PASSED');
    expect(stopCalls).toContain('watch.stop');
  });

  it('monitor_start→monitor_stop 正常执行', async () => {
    vi.mocked(sendToBridge).mockImplementation(async (method: string) => {
      if (method === 'monitor.start') return { result: { monitoring: true } };
      if (method === 'monitor.stop') return { result: { monitoring: false, samples: [{ frame: 5, time: 0.5, values: { health: 80 } }], sample_count: 1, stopped_reason: '' } };
      return { result: {} };
    });
    const suite = { name: 'm1', steps: [
      { type: 'monitor_start', node_path: '/root/P', properties: ['health'], interval_frames: 5 },
      { type: 'monitor_stop' },
    ] } as never as QaSuite;
    const report = await runQaSuite(suite, 'D:/proj', makeCtx(), 'inline');
    expect(report.summary.status).toBe('PASSED');
  });
});
```

(测试文件顶部已有 `QaSuite` 类型 import 与 `makeCtx()` helper;若文件用别的 helper 名,以现有代码为准照抄其调用形态。)

- [ ] **Step 2:跑测试确认失败**

```bash
npx vitest run test/qa-runner.test.ts
```
Expected: 新 describe FAIL(控制步骤落入 execStep switch 无匹配分支/类型不匹配编译错)。

- [ ] **Step 3:实现——src/tools/qa/runner.ts**

3a. `RunState` 定义(放在 `RunQaResult` interface 附近):

```ts
/** 套件内跨步骤状态(watch/monitor 单订阅槽自管 + errors baseline;Task PR-1a) */
interface RunState {
  watchActive: boolean;
  monitorActive: boolean;
  watchEventsCache: WatchEvent[] | null;
  errorsBaselineSeq: number | null;
}
type WatchEvent = { frame: number; time: number; args: unknown[] };

function newRunState(): RunState {
  return { watchActive: false, monitorActive: false, watchEventsCache: null, errorsBaselineSeq: null };
}
```

3b. `runQaSuite` 内创建并传给 execStep:

```ts
const runState = newRunState();
// ...步骤循环里:
const outcome = await execStep(step, o, runId, i, projectPath, runState);
```

3c. teardown finally 块(recording.stop 之前)加兜底:

```ts
// watch/monitor 兜底收尾(防泄漏;失败只记警告)
if (runState.watchActive) {
  try {
    const resp = await sendToBridge('watch.stop', {}, o.step_timeout_ms);
    if (resp.error) {
      report.teardown_warnings = [...(report.teardown_warnings ?? []), `watch.stop 兜底失败: ${resp.error.message}`];
    } else {
      runState.watchActive = false;
    }
  } catch (err) {
    report.teardown_warnings = [...(report.teardown_warnings ?? []), `watch.stop 兜底异常: ${err instanceof Error ? err.message : String(err)}`];
  }
}
if (runState.monitorActive) {
  try {
    const resp = await sendToBridge('monitor.stop', {}, o.step_timeout_ms);
    if (resp.error) {
      report.teardown_warnings = [...(report.teardown_warnings ?? []), `monitor.stop 兜底失败: ${resp.error.message}`];
    } else {
      runState.monitorActive = false;
    }
  } catch (err) {
    report.teardown_warnings = [...(report.teardown_warnings ?? []), `monitor.stop 兜底异常: ${err instanceof Error ? err.message : String(err)}`];
  }
}
```

3d. `execStep` 签名改 `async function execStep(step: QaStep, o: ResolvedOptions, runId: string, index: number, projectPath: string, runState: RunState)`,switch 加 4 分支(`sleep` 分支之前):

```ts
case 'watch_start': {
  if (runState.watchActive) return err('本套件已有活跃 watch,先 watch_stop');
  // 探测是否替换套件外开启的既有 watch(GD 侧静默替换,qa 需在 detail 注明)
  let replacedNote = '';
  const probe = await sendToBridge('watch.poll', {}, o.step_timeout_ms);
  const pr = (probe.result ?? {}) as { watching?: boolean };
  if (!probe.error && pr.watching === true) replacedNote = ' (已替换套件外开启的既有 watch)';
  const params: Record<string, unknown> = { node_path: step.node_path, signal_name: step.signal_name, push: false };
  if (step.max_events !== undefined) params.max_events = step.max_events;
  const resp = await sendToBridge('watch.start', params, o.step_timeout_ms);
  if (resp.error) return err(`bridge: ${resp.error.message}`);
  runState.watchActive = true;
  runState.watchEventsCache = null;
  return { status: 'PASSED', detail: `watch.start ${step.node_path}:${step.signal_name}${replacedNote}` };
}
case 'watch_stop': {
  if (!runState.watchActive && !runState.watchEventsCache) return err('无活跃 watch(未 watch_start 或已 stop)');
  const resp = await sendToBridge('watch.stop', {}, o.step_timeout_ms);
  if (resp.error) return err(`bridge: ${resp.error.message}`);
  const r = (resp.result ?? {}) as { events?: unknown[] };
  runState.watchActive = false;
  runState.watchEventsCache = Array.isArray(r.events) ? (r.events as WatchEvent[]) : [];
  return { status: 'PASSED', detail: `watch.stop ${runState.watchEventsCache.length} event(s)` };
}
case 'monitor_start': {
  if (runState.monitorActive) return err('本套件已有活跃 monitor,先 monitor_stop');
  const params: Record<string, unknown> = { node_path: step.node_path, properties: step.properties };
  if (step.interval_frames !== undefined) params.interval_frames = step.interval_frames;
  const resp = await sendToBridge('monitor.start', params, o.step_timeout_ms);
  if (resp.error) return err(`bridge: ${resp.error.message}`);
  runState.monitorActive = true;
  return { status: 'PASSED', detail: `monitor.start ${step.node_path} [${step.properties.join(', ')}]` };
}
case 'monitor_stop': {
  if (!runState.monitorActive) return err('无活跃 monitor(未 monitor_start 或已 stop)');
  const resp = await sendToBridge('monitor.stop', {}, o.step_timeout_ms);
  if (resp.error) return err(`bridge: ${resp.error.message}`);
  runState.monitorActive = false;
  const r = (resp.result ?? {}) as { sample_count?: number };
  return { status: 'PASSED', detail: `monitor.stop ${r.sample_count ?? 0} sample(s)` };
}
```

- [ ] **Step 4:跑测试确认通过**

```bash
npx vitest run test/qa-runner.test.ts
```
Expected: 全 PASS(含旧用例——execStep 加参是内部签名,旧调用经 runQaSuite 不受影响)。

- [ ] **Step 5:Commit**

```bash
git add src/tools/qa/runner.ts test/qa-runner.test.ts
git commit -m "feat(qa): watch/monitor 控制步骤 + RunState 跨步骤状态 + teardown 兜底 stop"
```

---

### Task 4:signal 与 monitor 断言

**Files:**
- Modify: `src/tools/qa/runner.ts`
- Test: `test/qa-runner.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `RunState`/`WatchEvent`/`execStep(..., runState)`。
- Produces: 私有 helper `collectWatchEvents(runState, timeoutMs)` 与 `collectMonitorSamples(runState, timeoutMs)`(B-2 取数路径:poll 优先 → 非 active 补 stop 全量)。

- [ ] **Step 1:写失败测试(test/qa-runner.test.ts 追加)**

```ts
describe('qa runner: signal/monitor 断言(Task PR-1a)', () => {
  it('signal 断言:活跃 watch poll 取数,args_match 深比较计数', async () => {
    vi.mocked(sendToBridge).mockImplementation(async (method: string) => {
      if (method === 'watch.start') return { result: { watching: true } };
      if (method === 'watch.poll') return { result: { watching: true, node_path: '/root/B', signal_name: 'moved',
        events: [
          { frame: 10, time: 1.0, args: [{ x: 1, y: 2 }] },
          { frame: 20, time: 2.0, args: [{ x: 3, y: 4 }] },
          { frame: 30, time: 3.0, args: ['other'] },
        ], event_count: 3 } };
      return { result: {} };
    });
    const suite = { name: 's1', steps: [
      { type: 'watch_start', node_path: '/root/B', signal_name: 'moved' },
      { type: 'assert', assert: 'signal', min_count: 2, max_count: 2, args_match: [{ x: 1, y: 2 }] },
    ] } as never as QaSuite;
    const report = await runQaSuite(suite, 'D:/proj', makeCtx(), 'inline');
    expect(report.steps[1]!.status).toBe('PASSED');
  });

  it('signal 断言 B-2:max_events 满自动停(poll 空)→ 补 stop 取全量,不误判 0 事件', async () => {
    vi.mocked(sendToBridge).mockImplementation(async (method: string) => {
      if (method === 'watch.start') return { result: { watching: true } };
      if (method === 'watch.poll') return { result: { watching: false, events: [], message: 'No active watch' } };
      if (method === 'watch.stop') return { result: { watching: false,
        events: [{ frame: i, time: i, args: [i] }].concat([]), event_count: 1 } };
      return { result: {} };
    });
    const suite = { name: 's2', steps: [
      { type: 'watch_start', node_path: '/root/B', signal_name: 'hit' },
      { type: 'assert', assert: 'signal', min_count: 1 },
    ] } as never as QaSuite;
    const report = await runQaSuite(suite, 'D:/proj', makeCtx(), 'inline');
    expect(report.steps[1]!.status).toBe('PASSED'); // 补 stop 后拿到 1 事件,不假红
  });

  it('signal 断言:计数低于 min_count → FAILED 且 mismatch 带实际计数', async () => {
    vi.mocked(sendToBridge).mockImplementation(async (method: string) => {
      if (method === 'watch.start') return { result: { watching: true } };
      if (method === 'watch.poll') return { result: { watching: true, events: [], event_count: 0 } };
      return { result: {} };
    });
    const suite = { name: 's3', steps: [
      { type: 'watch_start', node_path: '/root/B', signal_name: 'x' },
      { type: 'assert', assert: 'signal', min_count: 3 },
    ] } as never as QaSuite;
    const report = await runQaSuite(suite, 'D:/proj', makeCtx(), 'inline');
    expect(report.steps[1]!.status).toBe('FAILED');
    expect(report.steps[1]!.mismatch?.count).toEqual({ expected: '[3, ∞]', actual: 0 });
  });

  it('signal 断言:从未 watch_start → ERROR', async () => {
    vi.mocked(sendToBridge).mockImplementation(async (method: string) => {
      if (method === 'watch.poll') return { result: { watching: false, events: [], message: 'No active watch' } };
      return { result: {} };
    });
    const suite = { name: 's4', steps: [
      { type: 'assert', assert: 'signal', min_count: 1 },
    ] } as never as QaSuite;
    const report = await runQaSuite(suite, 'D:/proj', makeCtx(), 'inline');
    expect(report.steps[0]!.status).toBe('ERROR');
  });

  it('monitor 断言:min/max 区间 + non_decreasing 单调判定 PASSED', async () => {
    vi.mocked(sendToBridge).mockImplementation(async (method: string) => {
      if (method === 'monitor.start') return { result: { monitoring: true } };
      if (method === 'monitor.poll') return { result: { monitoring: true, node_path: '/root/P', sample_count: 3,
        samples: [
          { frame: 1, time: 0.1, values: { health: 100 } },
          { frame: 2, time: 0.2, values: { health: 90 } },
          { frame: 3, time: 0.3, values: { health: 90 } },
        ] } };
      return { result: {} };
    });
    const suite = { name: 'm2', steps: [
      { type: 'monitor_start', node_path: '/root/P', properties: ['health'] },
      { type: 'assert', assert: 'monitor', property: 'health', min: 50, max: 100, monotonic: 'non_increasing' },
    ] } as never as QaSuite;
    const report = await runQaSuite(suite, 'D:/proj', makeCtx(), 'inline');
    expect(report.steps[1]!.status).toBe('PASSED');
  });

  it('monitor 断言 B-2:node_lost 自动停(poll 空)→ 补 stop 取全量,判 ERROR(数据不完整)', async () => {
    vi.mocked(sendToBridge).mockImplementation(async (method: string) => {
      if (method === 'monitor.start') return { result: { monitoring: true } };
      if (method === 'monitor.poll') return { result: { monitoring: false, samples: [], stopped_reason: 'node_lost', message: 'Monitor stopped: node_lost' } };
      if (method === 'monitor.stop') return { result: { monitoring: false, sample_count: 2, stopped_reason: 'node_lost',
        samples: [
          { frame: 1, time: 0.1, values: { health: 100 } },
          { frame: 2, time: 0.2, error: 'node_lost', stopped_reason: 'node_lost' },
        ] } };
      return { result: {} };
    });
    const suite = { name: 'm3', steps: [
      { type: 'monitor_start', node_path: '/root/P', properties: ['health'] },
      { type: 'assert', assert: 'monitor', property: 'health', min: 0 },
    ] } as never as QaSuite;
    const report = await runQaSuite(suite, 'D:/proj', makeCtx(), 'inline');
    expect(report.steps[1]!.status).toBe('ERROR');
    expect(report.steps[1]!.detail).toContain('node_lost');
  });

  it('monitor 断言:越界 → FAILED 且 mismatch 带首个违规样本', async () => {
    vi.mocked(sendToBridge).mockImplementation(async (method: string) => {
      if (method === 'monitor.start') return { result: { monitoring: true } };
      if (method === 'monitor.poll') return { result: { monitoring: true, sample_count: 2,
        samples: [
          { frame: 1, time: 0.1, values: { fps: 60 } },
          { frame: 2, time: 0.2, values: { fps: 20 } },
        ] } };
      return { result: {} };
    });
    const suite = { name: 'm4', steps: [
      { type: 'monitor_start', node_path: '/root/P', properties: ['fps'] },
      { type: 'assert', assert: 'monitor', property: 'fps', min: 30 },
    ] } as never as QaSuite;
    const report = await runQaSuite(suite, 'D:/proj', makeCtx(), 'inline');
    expect(report.steps[1]!.status).toBe('FAILED');
    expect(report.steps[1]!.mismatch?.fps).toEqual({ expected: '≥ 30', actual: 20 });
  });

  it('monitor 断言:样本缺属性 → ERROR(不假绿)', async () => {
    vi.mocked(sendToBridge).mockImplementation(async (method: string) => {
      if (method === 'monitor.start') return { result: { monitoring: true } };
      if (method === 'monitor.poll') return { result: { monitoring: true, sample_count: 1,
        samples: [{ frame: 1, time: 0.1, values: { other: 1 } }] } };
      return { result: {} };
    });
    const suite = { name: 'm5', steps: [
      { type: 'monitor_start', node_path: '/root/P', properties: ['fps'] },
      { type: 'assert', assert: 'monitor', property: 'fps', min: 30 },
    ] } as never as QaSuite;
    const report = await runQaSuite(suite, 'D:/proj', makeCtx(), 'inline');
    expect(report.steps[1]!.status).toBe('ERROR');
  });
});
```

- [ ] **Step 2:跑测试确认失败**

```bash
npx vitest run test/qa-runner.test.ts
```
Expected: 新 describe FAIL(signal/monitor 断言分支不存在)。

- [ ] **Step 3:实现——src/tools/qa/runner.ts**

3a. 取数 helper(放 execStep 之前;B-2 取数路径):

```ts
type MonitorSample = { frame: number; time: number; values?: Record<string, unknown>; error?: string; stopped_reason?: string };

/** 取 watch 全量事件:缓存优先(stop 后仍可用)→ poll → 非 active 且本套件开过 → 补 stop 全量。
 * B-2:GD 侧 max_events 满后自动置 inactive,poll 返回空,必须补 stop 才能拿到事件。 */
async function collectWatchEvents(runState: RunState, timeoutMs: number): Promise<{ events: WatchEvent[] } | { error: string }> {
  if (runState.watchEventsCache) return { events: runState.watchEventsCache };
  const poll = await sendToBridge('watch.poll', {}, timeoutMs);
  if (poll.error) return { error: `bridge: ${poll.error.message}` };
  const r = (poll.result ?? {}) as { watching?: boolean; events?: unknown[] };
  if (r.watching === true) return { events: (Array.isArray(r.events) ? r.events : []) as WatchEvent[] };
  if (!runState.watchActive) return { error: '无活跃 watch 且无缓存事件,先 watch_start' };
  const stop = await sendToBridge('watch.stop', {}, timeoutMs);
  if (stop.error) return { error: `bridge: ${stop.error.message}` };
  const sr = (stop.result ?? {}) as { events?: unknown[] };
  runState.watchActive = false;
  runState.watchEventsCache = (Array.isArray(sr.events) ? sr.events : []) as WatchEvent[];
  return { events: runState.watchEventsCache };
}

/** 取 monitor 全量样本:poll → 非 active 且本套件开过 → 补 stop 全量(B-2 同款)。 */
async function collectMonitorSamples(runState: RunState, timeoutMs: number): Promise<{ samples: MonitorSample[]; stoppedReason?: string } | { error: string }> {
  const poll = await sendToBridge('monitor.poll', {}, timeoutMs);
  if (poll.error) return { error: `bridge: ${poll.error.message}` };
  const r = (poll.result ?? {}) as { monitoring?: boolean; samples?: unknown[]; stopped_reason?: string };
  if (r.monitoring === true) return { samples: (Array.isArray(r.samples) ? r.samples : []) as MonitorSample[] };
  if (!runState.monitorActive) return { error: '无活跃 monitor,先 monitor_start' };
  const stop = await sendToBridge('monitor.stop', {}, timeoutMs);
  if (stop.error) return { error: `bridge: ${stop.error.message}` };
  const sr = (stop.result ?? {}) as { samples?: unknown[]; stopped_reason?: string };
  runState.monitorActive = false;
  return {
    samples: (Array.isArray(sr.samples) ? sr.samples : []) as MonitorSample[],
    stoppedReason: sr.stopped_reason || undefined,
  };
}

/** JSON 深比较(键序不敏感不保证;与既有 node_state 的 JSON.stringify 比较同风格) */
function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
```

3b. execStep 的 `case 'assert'` 分支重构:fn 选择表加 `screenshot_diff`(Task 7 接线前先占位直调,详见 Task 7;本任务只加 signal/errors/monitor 本地分支)。把现有 assert 分支末尾改为:

```ts
case 'assert': {
  const fn = step.assert === 'node_state' ? assertNodeState
    : step.assert === 'scene_structure' ? assertSceneStructure
    : step.assert === 'screen_text' ? assertScreenText
    : step.assert === 'perf' ? assertPerf
    : step.assert === 'screenshot_diff' ? assertScreenshotDiff   // Task 7 接线;Task 4 阶段先不引入(见下)
    : null;
  if (fn) {
    // 原有 runtime-assert 复用流程(args 组装 → fn → parseToolJson 判定),原样保留
    const args: Record<string, unknown> = { action: step.assert };
    for (const k of ['path', 'expect', 'tolerance', 'nodes', 'text', 'present', 'baseline', 'reference', 'threshold', 'max_diff_ratio'] as const) {
      const v = step[k];
      if (v !== undefined) args[k] = v;
    }
    const res = await fn(args);
    const json = parseToolJson(res);
    if (!json) return err(`assert ${step.assert} 返回非 JSON: ${condense(res.content[0]?.type === 'text' ? res.content[0].text : '')}`);
    if (json.success === false) return err(`assert ${step.assert}: ${condense(json.error)}`);
    if (json.passed === true) return { status: 'PASSED', detail: `assert ${step.assert} ok` };
    return { status: 'FAILED', detail: `assert ${step.assert} mismatch`, mismatch: json.mismatch as Record<string, { expected: unknown; actual: unknown }> | undefined };
  }
  // ── 套件内本地断言(signal/errors/monitor:依赖 RunState 跨步骤状态)──
  if (step.assert === 'signal') return await execSignalAssert(step, runState, o);
  if (step.assert === 'errors') return await execErrorsAssert(step, runState, o);          // Task 5 实现
  if (step.assert === 'monitor') return await execMonitorAssert(step, runState, o);
  return err(`assert ${step.assert}: 未实现`);
}
```

> 注:Task 4 阶段 `screenshot_diff` 那一行与 `execErrorsAssert` 先以最小占位存在(`return err('Task 5/7 未接线')`),让本任务测试先行;Task 5/7 各自替换为真实现。若采用逐任务分支提交,也可在本任务直接不加 screenshot_diff 行、Task 7 再加——以"每步全绿"为准则。

3c. 两个本地断言函数(execStep 之后):

```ts
async function execSignalAssert(step: { min_count?: number; max_count?: number; args_match?: unknown }, runState: RunState, o: ResolvedOptions): Promise<StepOutcome> {
  const collected = await collectWatchEvents(runState, o.step_timeout_ms);
  if ('error' in collected) return err(collected.error);
  const minCount = step.min_count ?? 1;
  const maxCount = step.max_count ?? Number.POSITIVE_INFINITY;
  const hasArgsMatch = step.args_match !== undefined;
  const matched = collected.events.filter(e => !hasArgsMatch || jsonEqual(e.args, step.args_match));
  if (matched.length >= minCount && matched.length <= maxCount) {
    return { status: 'PASSED', detail: `signal ${matched.length}/${collected.events.length} event(s) matched${hasArgsMatch ? ' args_match' : ''}` };
  }
  const last = matched.at(-1) ?? collected.events.at(-1);
  return {
    status: 'FAILED',
    detail: `signal count mismatch${last ? `(last event: ${condense(last)})` : ''}`,
    mismatch: { count: { expected: `[${minCount}, ${maxCount === Number.POSITIVE_INFINITY ? '∞' : maxCount}]`, actual: matched.length } },
  };
}

async function execMonitorAssert(step: { property: string; min?: number; max?: number; monotonic?: 'increasing' | 'non_decreasing' | 'decreasing' | 'non_increasing' }, runState: RunState, o: ResolvedOptions): Promise<StepOutcome> {
  const collected = await collectMonitorSamples(runState, o.step_timeout_ms);
  if ('error' in collected) return err(collected.error);
  const { samples, stoppedReason } = collected;
  // 数据完整性(不假绿):非空 stopped_reason 或任一样本带 error 键(node_lost 等)
  const badSample = samples.find(s => s.error !== undefined);
  if (stoppedReason || badSample) {
    return err(`monitor 数据不完整: stopped_reason=${stoppedReason || badSample?.stopped_reason || badSample?.error}`);
  }
  // 提取数值序列(样本缺属性=数据不完整,ERROR)
  const series: Array<{ frame: number; value: number }> = [];
  for (const s of samples) {
    const v = s.values?.[step.property];
    if (typeof v !== 'number') {
      return err(`样本缺属性 ${step.property} 或非数值(frame ${s.frame}: ${condense(v)})`);
    }
    series.push({ frame: s.frame, value: v });
  }
  // 区间断言
  if (step.min !== undefined || step.max !== undefined) {
    const viol = series.find(p =>
      (step.min !== undefined && p.value < step.min) || (step.max !== undefined && p.value > step.max));
    if (viol) {
      const range = `${step.min !== undefined ? `≥ ${step.min}` : ''}${step.min !== undefined && step.max !== undefined ? ' 且 ' : ''}${step.max !== undefined ? `≤ ${step.max}` : ''}`;
      return {
        status: 'FAILED',
        detail: `monitor ${step.property} 越界(首个违规 frame ${viol.frame})`,
        mismatch: { [step.property]: { expected: range, actual: viol.value } },
      };
    }
  }
  // 单调性断言
  if (step.monotonic !== undefined && series.length >= 2) {
    const ok = series.every((p, i) => {
      if (i === 0) return true;
      const prev = series[i - 1]!.value;
      switch (step.monotonic) {
        case 'increasing': return p.value > prev;
        case 'non_decreasing': return p.value >= prev;
        case 'decreasing': return p.value < prev;
        case 'non_increasing': return p.value <= prev;
      }
    });
    if (!ok) {
      const violIdx = series.findIndex((p, i) => {
        if (i === 0) return false;
        const prev = series[i - 1]!.value;
        return step.monotonic === 'increasing' ? p.value <= prev
          : step.monotonic === 'non_decreasing' ? p.value < prev
          : step.monotonic === 'decreasing' ? p.value >= prev
          : p.value > prev;
      });
      return {
        status: 'FAILED',
        detail: `monitor ${step.property} 违反 ${step.monotonic}(首个违规 frame ${series[violIdx]?.frame})`,
        mismatch: { [`${step.property}_monotonic`]: { expected: step.monotonic, actual: `frame ${series[violIdx! - 1]?.frame}=${series[violIdx! - 1]?.value} → frame ${series[violIdx]?.frame}=${series[violIdx]?.value}` } },
      };
    }
  }
  return { status: 'PASSED', detail: `monitor ${step.property} ${series.length} sample(s) ok` };
}
```

- [ ] **Step 4:跑测试确认通过**

```bash
npx vitest run test/qa-runner.test.ts
```
Expected: 全 PASS。

- [ ] **Step 5:Commit**

```bash
git add src/tools/qa/runner.ts test/qa-runner.test.ts
git commit -m "feat(qa): signal/monitor 断言(poll 优先+补 stop 取全量,单调四档,node_lost 不假绿)"
```

---

### Task 5:errors baseline 按需采集 + errors 断言

**Files:**
- Modify: `src/tools/qa/runner.ts`
- Test: `test/qa-runner.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `RunState.errorsBaselineSeq`。
- Produces: `execErrorsAssert`(Task 4 的 assert 分支已预留调用点)。

- [ ] **Step 1:写失败测试(test/qa-runner.test.ts 追加)**

```ts
describe('qa runner: errors 断言(Task PR-1a)', () => {
  it('含 errors 断言的套件:setup 后采 baseline,期间零新错误 → PASSED', async () => {
    const calls: Array<{ m: string; p: unknown }> = [];
    vi.mocked(sendToBridge).mockImplementation(async (method: string, params: unknown) => {
      calls.push({ m: method, p: params });
      if (method === 'get_errors') return { result: { errors: [], next_seq: 0 } };
      return { result: {} };
    });
    const suite = { name: 'e1', steps: [
      { type: 'assert', assert: 'errors' },
    ] } as never as QaSuite;
    const report = await runQaSuite(suite, 'D:/proj', makeCtx(), 'inline');
    expect(report.summary.status).toBe('PASSED');
    // baseline 采集 + 断言查询,两次 get_errors 都带 since_seq
    const ge = calls.filter(c => c.m === 'get_errors');
    expect(ge.length).toBe(2);
  });

  it('期间新增 2 条 error → FAILED,mismatch 带实际计数', async () => {
    let seq = 0;
    vi.mocked(sendToBridge).mockImplementation(async (method: string) => {
      if (method === 'get_errors') {
        if (seq++ === 0) return { result: { errors: [], next_seq: 0 } };
        return { result: { errors: [
          { seq: 1, kind: 'error', message: 'null instance', code: '', function: 'f', file: 'a.gd', line: 1 },
          { seq: 2, kind: 'script', message: 'script err', code: '', function: 'g', file: 'b.gd', line: 2 },
          { seq: 3, kind: 'warning', message: 'warn should be excluded', code: '', function: 'h', file: 'c.gd', line: 3 },
        ], next_seq: 3 } };
      }
      return { result: {} };
    });
    const suite = { name: 'e2', steps: [
      { type: 'assert', assert: 'errors' },
    ] } as never as QaSuite;
    const report = await runQaSuite(suite, 'D:/proj', makeCtx(), 'inline');
    expect(report.steps[0]!.status).toBe('FAILED');
    expect(report.steps[0]!.mismatch?.new_errors).toEqual({ expected: '≤ 0', actual: 2 }); // warning 排除
  });

  it('kinds 含 warning 时 warning 计入', async () => {
    let seq = 0;
    vi.mocked(sendToBridge).mockImplementation(async (method: string) => {
      if (method === 'get_errors') {
        if (seq++ === 0) return { result: { errors: [], next_seq: 0 } };
        return { result: { errors: [{ seq: 1, kind: 'warning', message: 'w', code: '', function: '', file: '', line: 1 }], next_seq: 1 } };
      }
      return { result: {} };
    });
    const suite = { name: 'e3', steps: [
      { type: 'assert', assert: 'errors', kinds: ['error', 'warning'], max_count: 0 },
    ] } as never as QaSuite;
    const report = await runQaSuite(suite, 'D:/proj', makeCtx(), 'inline');
    expect(report.steps[0]!.status).toBe('FAILED');
  });

  it('baseline 采集失败(旧 bridge)→ 降级 warning + 断言 ERROR,不 failSetup', async () => {
    vi.mocked(sendToBridge).mockImplementation(async (method: string) => {
      if (method === 'get_errors') return { error: { code: -32003, message: 'Error capture not initialized' } };
      return { result: {} };
    });
    const suite = { name: 'e4', steps: [
      { type: 'assert', assert: 'errors' },
    ] } as never as QaSuite;
    const report = await runQaSuite(suite, 'D:/proj', makeCtx(), 'inline');
    expect(report.setup_error).toBeUndefined();           // 不 failSetup
    expect(report.teardown_warnings?.some(w => w.includes('get_errors baseline'))).toBe(true);
    expect(report.steps[0]!.status).toBe('ERROR');
  });

  it('不含 errors 断言的套件:setup 不采 baseline(零多余 bridge 调用)', async () => {
    const calls: string[] = [];
    vi.mocked(sendToBridge).mockImplementation(async (method: string) => {
      calls.push(method);
      return { result: {} };
    });
    const suite = { name: 'e5', steps: [
      { type: 'input', method: 'send_key', params: { key: 'ui_accept' } },
    ] } as never as QaSuite;
    await runQaSuite(suite, 'D:/proj', makeCtx(), 'inline');
    expect(calls).not.toContain('get_errors');
  });
});
```

- [ ] **Step 2:跑测试确认失败**

```bash
npx vitest run test/qa-runner.test.ts
```
Expected: 新 describe FAIL(Task 4 占位 `execErrorsAssert` 返 ERROR / setup 未采 baseline)。

- [ ] **Step 3:实现——src/tools/qa/runner.ts**

3a. `runQaSuite` setup 段(`record_on_failure` 采集之前)加按需 baseline:

```ts
// errors baseline(I-2:仅含 errors 断言的套件采集;失败降级不 failSetup)
if (suite.steps.some(s => s.type === 'assert' && s.assert === 'errors')) {
  const resp = await sendToBridge('get_errors', { since_seq: 0 }, o.step_timeout_ms);
  if (resp.error) {
    report.teardown_warnings = [...(report.teardown_warnings ?? []), `get_errors baseline 采集失败(errors 断言将判 ERROR,旧 bridge 可能无错误捕获): ${resp.error.message}`];
  } else {
    runState.errorsBaselineSeq = ((resp.result ?? {}) as { next_seq?: number }).next_seq ?? 0;
  }
}
```

3b. `execErrorsAssert` 真实现(替换 Task 4 的占位):

```ts
async function execErrorsAssert(step: { kinds?: string[]; max_count?: number }, runState: RunState, o: ResolvedOptions): Promise<StepOutcome> {
  if (runState.errorsBaselineSeq === null) {
    return err('errors 断言不可用:baseline 采集失败(见 teardown_warnings,旧 bridge 无 get_errors)');
  }
  const resp = await sendToBridge('get_errors', { since_seq: runState.errorsBaselineSeq }, o.step_timeout_ms);
  if (resp.error) return err(`bridge: ${resp.error.message}`);
  const r = (resp.result ?? {}) as { errors?: Array<{ seq: number; kind: string; message: string }> };
  const kinds = step.kinds ?? ['error', 'script', 'shader'];   // 默认排除 warning(太吵)
  const maxCount = step.max_count ?? 0;
  const hits = (r.errors ?? []).filter(e => kinds.includes(e.kind));
  if (hits.length <= maxCount) {
    return { status: 'PASSED', detail: `errors ${hits.length} ≤ ${maxCount} [${kinds.join(',')}]` };
  }
  const entries = hits.slice(0, 5).map(e => `${e.kind}: ${e.message.slice(0, 80)}`).join(' | ');
  return {
    status: 'FAILED',
    detail: `新增 ${hits.length} 条(前 5: ${entries.slice(0, 160)})`,
    mismatch: { new_errors: { expected: `≤ ${maxCount}`, actual: hits.length } },
  };
}
```

- [ ] **Step 4:跑测试确认通过**

```bash
npx vitest run test/qa-runner.test.ts
```
Expected: 全 PASS。

- [ ] **Step 5:Commit**

```bash
git add src/tools/qa/runner.ts test/qa-runner.test.ts
git commit -m "feat(qa): errors 断言(setup 后 next_seq 锚点增量,warning 默认排除,旧 bridge 降级)"
```

---

### Task 6:runtime-assert screenshot_diff 真实现(含 B-1 语义修正)

**Files:**
- Modify: `src/tools/runtime-assert.ts`
- Test: `test/runtime-assert-screenshot-diff.test.ts`(重写)

**Interfaces:**
- Consumes: Task 1 的 `resolveGameDataPath`(from `./game-fs.js`)、`diffPngBuffers`(from `./screenshot-detail.js`)、`sendToBridge`。
- Produces: `export async function assertScreenshotDiff(args: Record<string, unknown>): Promise<ToolResult>`(Task 7 的 qa runner 直调)。内部参数(工具 schema 不暴露):`project_path`(screenshot_diff 必填)、`evidence_path`(可选,落 diff 染红图)。

- [ ] **Step 1:重写失败测试(test/runtime-assert-screenshot-diff.test.ts 全文件替换)**

```ts
// PR-1a:screenshot_diff 真实现(像素差异容忍,复用 screenshot-detail diffPngBuffers)。
// 真契约 mock:take_screenshot → {success:true, path:'user://…', size:{x,y}}(无 base64)。
// 占位时代(2026-08-06 NOT_IMPLEMENTED)行为测试全部废弃,本文件锁定真实现。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PNG } from 'pngjs';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('../src/tools/game-bridge.js', () => ({
  sendToBridge: vi.fn(),
  setBridgeProjectDir: vi.fn(),
}));
vi.mock('../src/tools/game-fs.js', () => ({
  // user:// → 测试临时目录内的实际 PNG(绕开 APPDATA 布局)
  resolveGameDataPath: vi.fn((_proj: string, uri: string): string | null =>
    uri.startsWith('user://') ? join(gameDir, uri.slice('user://'.length)) : null),
}));

import { sendToBridge } from '../src/tools/game-bridge.js';
import { handleTool } from '../src/tools/runtime-assert.js';

const tmp = mkdtempSync(join(tmpdir(), 'radiff-'));
const projDir = join(tmp, 'proj');
const gameDir = join(tmp, 'gamedata');
const refPath = join(projDir, 'ref.png');

function makePng(width: number, height: number, fill: [number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const idx = i << 2;
    png.data[idx] = fill[0]; png.data[idx + 1] = fill[1]; png.data[idx + 2] = fill[2]; png.data[idx + 3] = 255;
  }
  return PNG.sync.write(png);
}

// 参考图:32x32 纯红;同款截图 → diffRatio 0
writeFileSync(refPath, makePng(32, 32, [200, 30, 30]));
// 截图(游戏侧):同尺寸纯红
writeFileSync(join(gameDir, 'shot-identical.png'), makePng(32, 32, [200, 30, 30]));
// 截图(游戏侧):右半纯蓝(一半像素差异)
const halfDiff = new PNG({ width: 32, height: 32 });
for (let i = 0; i < 32 * 32; i++) {
  const idx = i << 2;
  const blue = (i % 32) >= 16;
  halfDiff.data[idx] = blue ? 30 : 200; halfDiff.data[idx + 1] = 30; halfDiff.data[idx + 2] = blue ? 200 : 30; halfDiff.data[idx + 3] = 255;
}
writeFileSync(join(gameDir, 'shot-halfblue.png'), PNG.sync.write(halfDiff));
// 截图(游戏侧):尺寸不一致
writeFileSync(join(gameDir, 'shot-16x16.png'), makePng(16, 16, [200, 30, 30]));

const shotResult = (file: string) => ({ result: { success: true, path: `user://${file}`, size: { x: 32, y: 32 } } });

describe('runtime-assert screenshot_diff 真实现(PR-1a)', () => {
  beforeEach(() => { vi.mocked(sendToBridge).mockReset(); });

  it('reference 缺失 → INVALID_PARAMS', async () => {
    const r = await handleTool('runtime_assert', { action: 'screenshot_diff', project_path: projDir }, {} as never);
    const p = JSON.parse((r!.content[0] as { text: string }).text);
    expect(p.success).toBe(false); expect(p.error_code).toBe('INVALID_PARAMS');
  });

  it('project_path 缺失 → INVALID_PARAMS(I-1:解析 user:// 必需)', async () => {
    const r = await handleTool('runtime_assert', { action: 'screenshot_diff', reference: refPath }, {} as never);
    const p = JSON.parse((r!.content[0] as { text: string }).text);
    expect(p.success).toBe(false); expect(p.error_code).toBe('INVALID_PARAMS');
    expect(p.error).toContain('project_path');
  });

  it('reference 越出白名单 → INVALID_PARAMS(不读文件)', async () => {
    const r = await handleTool('runtime_assert', { action: 'screenshot_diff', reference: 'Z:/elsewhere/x.png', project_path: projDir }, {} as never);
    const p = JSON.parse((r!.content[0] as { text: string }).text);
    expect(p.success).toBe(false); expect(p.error_code).toBe('INVALID_PARAMS');
    expect(p.error).toContain('ALLOWED_PROJECT_PATHS');
  });

  it('同图 → passed:true,diff_ratio=0(B-1:threshold 语义=差异容忍,默认 0.12)', async () => {
    vi.mocked(sendToBridge).mockResolvedValue(shotResult('shot-identical.png') as never);
    const r = await handleTool('runtime_assert', { action: 'screenshot_diff', reference: refPath, project_path: projDir }, {} as never);
    const p = JSON.parse((r!.content[0] as { text: string }).text);
    expect(p.success).toBe(true); expect(p.passed).toBe(true);
    expect(p.details.diff_ratio).toBe(0);
  });

  it('半图差异(≈0.5)> max_diff_ratio 默认 0.05 → FAILED,mismatch 带实际 ratio', async () => {
    vi.mocked(sendToBridge).mockResolvedValue(shotResult('shot-halfblue.png') as never);
    const r = await handleTool('runtime_assert', { action: 'screenshot_diff', reference: refPath, project_path: projDir }, {} as never);
    const p = JSON.parse((r!.content[0] as { text: string }).text);
    expect(p.success).toBe(true); expect(p.passed).toBe(false);
    expect(p.mismatch.diff_ratio.actual).toBeGreaterThan(0.4);
    expect(p.mismatch.diff_ratio.expected).toContain('≤ 0.05');
  });

  it('max_diff_ratio=0.6 时半图差异 → passed(阈值校准语义,I-3)', async () => {
    vi.mocked(sendToBridge).mockResolvedValue(shotResult('shot-halfblue.png') as never);
    const r = await handleTool('runtime_assert', { action: 'screenshot_diff', reference: refPath, project_path: projDir, max_diff_ratio: 0.6 }, {} as never);
    const p = JSON.parse((r!.content[0] as { text: string }).text);
    expect(p.passed).toBe(true);
  });

  it('尺寸不一致 → FAILED(非 success:false),detail 带双方尺寸', async () => {
    vi.mocked(sendToBridge).mockResolvedValue(shotResult('shot-16x16.png') as never);
    const r = await handleTool('runtime_assert', { action: 'screenshot_diff', reference: refPath, project_path: projDir }, {} as never);
    const p = JSON.parse((r!.content[0] as { text: string }).text);
    expect(p.success).toBe(true); expect(p.passed).toBe(false);
    expect(JSON.stringify(p.mismatch)).toContain('dimensions');
  });

  it('evidence_path 内部参数 → diff 染红图落盘', async () => {
    vi.mocked(sendToBridge).mockResolvedValue(shotResult('shot-halfblue.png') as never);
    const ev = join(tmp, 'ev-diff.png');
    const r = await handleTool('runtime_assert', { action: 'screenshot_diff', reference: refPath, project_path: projDir, evidence_path: ev }, {} as never);
    const p = JSON.parse((r!.content[0] as { text: string }).text);
    expect(p.details.evidence_path).toBe(ev);
    const buf = readFileSync(ev);
    expect(buf.length).toBeGreaterThan(0);
  });
});
```

> ⚠️ 白名单:测试需让 tmp 目录进白名单。按 `test/qa-runner.test.ts` 现有的 env 处理惯例,在文件顶部(beforeAll 或模块级)`process.env.ALLOWED_PROJECT_PATHS = tmp`(并在 afterAll 还原;若仓库已有 `withUnrestricted`/env helper 惯例,照抄)。若现有测试直接删 `GODOT_MCP_UNRESTRICTED` 相关 env,保持一致。

- [ ] **Step 2:跑测试确认失败**

```bash
npx vitest run test/runtime-assert-screenshot-diff.test.ts
```
Expected: FAIL(现实现返 NOT_IMPLEMENTED / 新字段不识别)。

- [ ] **Step 3:实现——src/tools/runtime-assert.ts**

3a. import 区加:

```ts
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, isAbsolute, dirname } from 'path';
import { PNG } from 'pngjs';
import { diffPngBuffers } from './screenshot-detail.js';
import { isPathInAllowedRoots } from '../core/path-utils.js';
import { resolveGameDataPath } from './game-fs.js';
```

3b. 工具 schema 的 screenshot_diff 字段更新(`getToolDefinitions` 内):

```ts
// screenshot_diff(B-1:差异容忍语义,禁用"相似度"措辞;引擎=screenshot 工具 action=diff)
reference: { type: 'string', description: 'screenshot_diff: 参考截图路径(res://、项目相对或绝对路径;须在白名单内)' },
threshold: { type: 'number', description: 'screenshot_diff: 像素差异容忍阈值(0-1,默认 0.12)。per-pixel 归一化 RGB 距离严格大于此值才计为差异像素;值越小越严格' },
max_diff_ratio: { type: 'number', description: 'screenshot_diff: 允许的差异像素占比上限(0-1,默认 0.05)。严格像素回归传 0;常规视觉回归建议以同布局好图对校准(本仓实测同布局好图对 ≈0.176,勿低于该量级)' },
```
`project_path` 字段 description 改:`'项目路径(screenshot_diff 必填:解析 user:// 截图落盘位置)'`。

3c. `assertScreenshotDiff` 全量替换(277-306 行),并**导出**:

```ts
/** screenshot_diff: 截图与参考图像素级对比(差异容忍语义)。PR-1a 真实现,导出供 qa 复用。
 * 真契约(v0.30 e2e 实测):take_screenshot 把 PNG 存游戏侧 user:// 并返回 {success, path, size}——无 base64。
 * 内部参数(schema 不暴露):evidence_path 落 diff 染红图(qa 传报告目录;工具级不传则只回数值)。 */
export async function assertScreenshotDiff(args: Record<string, unknown>): Promise<ToolResult> {
  const reference = args.reference as string | undefined;
  const threshold = (args.threshold as number | undefined) ?? 0.12;
  const maxDiffRatio = (args.max_diff_ratio as number | undefined) ?? 0.05;
  const projectPathRaw = args.project_path as string | undefined;
  if (!reference) {
    return textResult(JSON.stringify({ success: false, error: 'reference is required for screenshot_diff', error_code: 'INVALID_PARAMS' }));
  }
  if (!projectPathRaw) {
    return textResult(JSON.stringify({ success: false, error: 'project_path is required for screenshot_diff (解析 user:// 截图路径)', error_code: 'INVALID_PARAMS' }));
  }
  const projAbs = resolve(projectPathRaw);
  if (!isPathInAllowedRoots(projAbs)) {
    return textResult(JSON.stringify({ success: false, error: `project_path 不在 ALLOWED_PROJECT_PATHS 白名单内: ${projAbs}`, error_code: 'INVALID_PATH' }));
  }
  // reference 解析:res:// → 项目内;相对 → 项目内;绝对直用;统一过白名单
  let refAbs: string;
  if (reference.startsWith('res://')) refAbs = resolve(projAbs, reference.slice('res://'.length));
  else if (isAbsolute(reference)) refAbs = resolve(reference);
  else refAbs = resolve(projAbs, reference);
  if (!isPathInAllowedRoots(refAbs)) {
    return textResult(JSON.stringify({ success: false, error: `reference 不在 ALLOWED_PROJECT_PATHS 白名单内: ${refAbs}`, error_code: 'INVALID_PATH' }));
  }

  const resp = await sendToBridge('take_screenshot', {});
  if (resp.error) {
    return textResult(JSON.stringify({ success: false, error: `Bridge error: ${resp.error.message}`, error_code: 'BRIDGE_ERROR' }));
  }
  const shot = (resp.result ?? {}) as { success?: boolean; path?: string; size?: { x: number; y: number } };
  if (shot.success !== true || typeof shot.path !== 'string') {
    return textResult(JSON.stringify({ success: false, error: `take_screenshot 未成功: ${JSON.stringify(resp.result).slice(0, 200)}`, error_code: 'BRIDGE_ERROR' }));
  }
  const localShot = resolveGameDataPath(projAbs, shot.path);
  if (!localShot) {
    return textResult(JSON.stringify({ success: false, error: `user:// 截图无法解析到本机路径: ${shot.path}(user:// 布局异常或文件不存在)`, error_code: 'ASSERT_ERROR' }));
  }

  let refBuf: Buffer;
  let actualBuf: Buffer;
  try {
    refBuf = readFileSync(refAbs);
    actualBuf = readFileSync(localShot);
  } catch (e) {
    return textResult(JSON.stringify({ success: false, error: `读图失败: ${(e as Error).message}`, error_code: 'ASSERT_ERROR' }));
  }

  let diff;
  try {
    diff = diffPngBuffers(refBuf, actualBuf, threshold);
  } catch (e) {
    // 尺寸不一致:FAILED(带双方尺寸),不是基础设施错误
    return fail('screenshot_diff', { dimensions: { expected: '参考图与截图同尺寸', actual: (e as Error).message } }, { reference: refAbs });
  }

  // 可选证据落盘(失败不改变判定)
  const evidencePath = args.evidence_path as string | undefined;
  if (evidencePath) {
    try {
      mkdirSync(dirname(evidencePath), { recursive: true });
      const outPng = new PNG({ width: diff.width, height: diff.height });
      outPng.data = diff.diffImageData;
      writeFileSync(evidencePath, PNG.sync.write(outPng));
    } catch { /* 证据 best-effort */ }
  }

  if (diff.diffRatio <= maxDiffRatio) {
    return pass('screenshot_diff', { diff_ratio: diff.diffRatio, diff_pixels: diff.diffPixels, threshold, max_diff_ratio: maxDiffRatio, evidence_path: evidencePath, size: shot.size });
  }
  return fail('screenshot_diff', {
    diff_ratio: { expected: `≤ ${maxDiffRatio}`, actual: diff.diffRatio },
    diff_pixels: { expected: `≤ ${Math.round(maxDiffRatio * diff.width * diff.height)}`, actual: diff.diffPixels },
  }, { bbox: diff.bbox, size: shot.size, evidence_path: evidencePath });
}
```

- [ ] **Step 4:跑测试确认通过**

```bash
npx vitest run test/runtime-assert-screenshot-diff.test.ts test/runtime-assert-actions.test.ts
```
Expected: 全 PASS(actions 测试若断言旧 schema 描述文案,同步更新该断言)。

- [ ] **Step 5:Commit**

```bash
git add src/tools/runtime-assert.ts test/runtime-assert-screenshot-diff.test.ts test/runtime-assert-actions.test.ts
git commit -m "feat(assert): screenshot_diff 真实现(像素差异容忍,修复占位;evidence_path 供 qa 复用)"
```

---

### Task 7:runner 接线 screenshot_diff 断言步骤

**Files:**
- Modify: `src/tools/qa/runner.ts`
- Test: `test/qa-runner.test.ts`

**Interfaces:**
- Consumes: Task 6 的 `assertScreenshotDiff`(import 加入 runner.ts 的 runtime-assert import 列表)。
- Produces: qa `assert screenshot_diff` 步骤;evidence 落 `qa-reports/<run_id>-step<N>-diff.png`,路径回填 `StepRecord.evidence.screenshot_path`。

- [ ] **Step 1:写失败测试(test/qa-runner.test.ts 追加)**

```ts
describe('qa runner: screenshot_diff 断言步骤(Task PR-1a)', () => {
  it('复用 runtime-assert 真实现:reference+project_path+evidence_path 传参,diff 图路径回填 evidence', async () => {
    process.env.GODOT_MCP_QA_REPORTS_DIR = mkdtempSync(join(tmpdir(), 'qarep-')).replaceAll('\\', '/');
    try {
      vi.mocked(sendToBridge).mockImplementation(async (method: string) => {
        if (method === 'take_screenshot') return { result: { success: true, path: 'user://x.png', size: { x: 32, y: 32 } } };
        return { result: {} };
      });
      // mock runtime-assert 依赖的 game-fs(resolveGameDataPath)返回 null → 走降级?
      // 不:直接 vi.mock game-fs 指到假路径会 ERROR。这里断言传参链路:mock assertScreenshotDiff。
      const { assertScreenshotDiff } = await import('../src/tools/runtime-assert.js');
      vi.spyOn(await import('../src/tools/runtime-assert.js'), 'assertScreenshotDiff');
      // vi.spyOn 对 ESM 命名导出不可写 → 改为断言 sendToBridge 收到 take_screenshot 且步骤 FAILED/ERROR 不抛
      const suite = { name: 'sd1', steps: [
        { type: 'assert', assert: 'screenshot_diff', reference: 'D:/ref/x.png' },
      ] } as never as QaSuite;
      const report = await runQaSuite(suite, 'D:/proj', makeCtx(), 'inline');
      // resolveGameDataPath 真实现对 D:/proj 返 null → runtime-assert 返 success:false → 步骤 ERROR(诚实降级)
      expect(['ERROR', 'FAILED']).toContain(report.steps[0]!.status);
    } finally { delete process.env.GODOT_MCP_QA_REPORTS_DIR; }
  });
});
```

> 注:ESM 命名导出无法 vi.spyOn。本用例退而断言"接线存在且不抛"(ERROR/FAILED 都证明 fn 被调用);传参正确性由 Task 6 的 runtime-assert 测试 + 下面补的一个**传参断言**用例覆盖——在 `vi.mock('../src/tools/game-bridge.js')` 的 factory 里捕获 `take_screenshot` 调用参数(已天然捕获),并在套件步骤断言后检查 `report.steps[0].detail` 含 'screenshot_diff'。若要精确断言 `reference/project_path` 传到了 assertScreenshotDiff,用 `vi.mock('../src/tools/runtime-assert.js', async (orig) => ({ ...await orig(), assertScreenshotDiff: vi.fn(async (a) => textResult(JSON.stringify({ success: true, passed: true }))) }))` **在独立测试文件** `test/qa-screenshot-diff-step.test.ts` 里做(mock 后 import runner)——推荐此方案,代码:

```ts
// test/qa-screenshot-diff-step.test.ts(新文件)
import { describe, it, expect, vi } from 'vitest';
import { textResult } from '../src/types.js';

vi.mock('../src/tools/game-bridge.js', () => ({
  sendToBridge: vi.fn().mockResolvedValue({ result: {} }),
  setBridgeProjectDir: vi.fn(),
  handleTool: vi.fn(),
}));
vi.mock('../src/tools/runtime.js', () => ({
  handleTool: vi.fn().mockResolvedValue(textResult(JSON.stringify({ success: true }))),
}));
vi.mock('../src/tools/runtime-assert.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/tools/runtime-assert.js')>();
  return { ...orig, assertScreenshotDiff: vi.fn(async () => textResult(JSON.stringify({ success: true, passed: true, action: 'screenshot_diff' }))) };
});

import { assertScreenshotDiff } from '../src/tools/runtime-assert.js';
import { runQaSuite } from '../src/tools/qa/runner.js';
import type { QaSuite } from '../src/tools/qa/spec.js';

describe('qa runner screenshot_diff 步骤传参', () => {
  it('reference/max_diff_ratio/project_path/evidence_path 正确传给 assertScreenshotDiff', async () => {
    process.env.GODOT_MCP_QA_REPORTS_DIR = 'D:/tmp-qarep';
    try {
      const suite = { name: 'sd', steps: [
        { type: 'assert', assert: 'screenshot_diff', reference: 'res://refs/a.png', threshold: 0.2, max_diff_ratio: 0.1 },
      ] } as never as QaSuite;
      await runQaSuite(suite, 'D:/proj', { opsScript: '', findGodot: async () => 'godot', runningProcess: null, setRunningProcess: () => {}, outputBuffer: [], setOutputBuffer: () => {}, processStartTime: 0, setProcessStartTime: () => {} } as never, 'inline');
      expect(vi.mocked(assertScreenshotDiff)).toHaveBeenCalledTimes(1);
      const arg = vi.mocked(assertScreenshotDiff).mock.calls[0]![0];
      expect(arg.reference).toBe('res://refs/a.png');
      expect(arg.threshold).toBe(0.2);
      expect(arg.max_diff_ratio).toBe(0.1);
      expect(arg.project_path).toBe('D:/proj');
      expect(arg.evidence_path).toMatch(/-step0-diff\.png$/);
    } finally { delete process.env.GODOT_MCP_QA_REPORTS_DIR; }
  });
});
```

- [ ] **Step 2:跑测试确认失败**

```bash
npx vitest run test/qa-screenshot-diff-step.test.ts
```
Expected: FAIL(assertScreenshotDiff 未被调用——接线不存在)。

- [ ] **Step 3:实现——src/tools/qa/runner.ts**

3a. import 加 `assertScreenshotDiff`(扩展现有 runtime-assert import 行):

```ts
import { assertNodeState, assertSceneStructure, assertScreenText, assertPerf, assertScreenshotDiff } from '../runtime-assert.js';
```

3b. execStep `case 'assert'` 内,fn 选择表补(Task 4 已预留注释位):

```ts
    : step.assert === 'screenshot_diff' ? assertScreenshotDiff
```

args 组装扩展(reference/threshold/max_diff_ratio 已在 Task 4 的字段白名单数组里),在 `const res = await fn(args);` 前加 screenshot_diff 专属注入:

```ts
    if (step.assert === 'screenshot_diff') {
      args.project_path = projectPath;
      const dir = qaReportsDir();
      mkdirSync(dir, { recursive: true });
      args.evidence_path = join(dir, `${runId}-step${index}-diff.png`);
    }
```

3c. PASSED 分支回填 evidence(仅 screenshot_diff):

```ts
    if (json.passed === true) {
      const evidence = step.assert === 'screenshot_diff'
        ? { screenshot_path: (json.details as Record<string, unknown> | undefined)?.evidence_path as string | undefined }
        : undefined;
      return { status: 'PASSED', detail: `assert ${step.assert} ok`, evidence };
    }
```

- [ ] **Step 4:跑测试确认通过**

```bash
npx vitest run test/qa-screenshot-diff-step.test.ts test/qa-runner.test.ts
```
Expected: 全 PASS。

- [ ] **Step 5:Commit**

```bash
git add src/tools/qa/runner.ts test/qa-screenshot-diff-step.test.ts test/qa-runner.test.ts
git commit -m "feat(qa): screenshot_diff 断言步骤接线 runtime-assert 真实现(证据图落 qa-reports)"
```

---

### Task 8:qa 工具描述重构(Nit-3)+ capability-matrix 重建

**Files:**
- Modify: `src/tools/qa/index.ts`
- Test: `test/qa-index.test.ts`
- 生成产物: `docs/capability-matrix.{json,md}`(npm run build-matrix,不手改)

**Interfaces:**
- Produces: 新 description(<600B 目标)+ 各 schema 字段 description(断言细节迁移落点)。下游 `qa run/report/diff` 行为零变化。

- [ ] **Step 1:更新 qa-index.test.ts 中对 description 的断言**

先 grep 现有断言:`grep -n "description" test/qa-index.test.ts`,把对旧 description 内容的断言改为锁定新 description 关键词(如 `'QA 测试套件编排'`、`'回归 diff'`、包含 `watch_start`),并新增长度断言:

```ts
it('qa description 收敛(Nit-3):<600B 且步骤细节移入 schema', () => {
  const def = getToolDefinitions()[0]!;
  const bytes = Buffer.byteLength(def.description!, 'utf8');
  expect(bytes).toBeLessThan(600);
  expect(def.description).not.toContain('options:');       // 选项说明移入字段 description
  expect(def.inputSchema.properties?.spec_path?.description).toBeTruthy();
});
```

- [ ] **Step 2:跑测试确认失败**

```bash
npx vitest run test/qa-index.test.ts
```
Expected: FAIL(现 description 773B)。

- [ ] **Step 3:实现——src/tools/qa/index.ts 的 getToolDefinitions 重写**

新 description(目标 ≈350B):

```
'QA 测试套件编排：结构化测试规范 → 自动安装 bridge → 运行游戏 → 逐步执行 → 聚合报告 + 回归 diff。'
+ '步骤类型：input/wait/wait_frames/freeze/unfreeze/step_until/snapshot/restore/set/call/'
+ 'watch_start|stop/monitor_start|stop/assert/screenshot/sleep；断言 8 种与各字段语义见 schema 字段 description。'
+ '报告落 ~/.godot-mcp/qa-reports/<run_id>.{json,md}。'
```

inputSchema 各字段补 description(迁移自旧 description 的语义,新断言字段一并写全):

```ts
inputSchema: {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string',
      enum: ['run', 'report', 'diff'],
      description: 'run=执行套件；report=读报告；diff=对比两份报告找回归',
    },
    spec: { type: 'object', description: 'run: inline 套件 spec 对象。步骤为 discriminated union(type 字段决定形态)：input(method+params,bridge 原生参数)、wait(wait_for_node/wait_for_property 轮询)、wait_frames(1-60 帧确定性推进)、freeze/unfreeze、step_until(结构化条件{path,property,op,value}[]，规避 RCE)、snapshot/restore、set(写节点属性)、call(bridge 只读白名单方法，写方法需 GODOT_MCP_BRIDGE_EXTRA_METHODS)、watch_start(node_path+signal_name，单套件单 watch)、watch_stop、monitor_start(node_path+properties[]，单套件单 monitor)、monitor_stop、screenshot(证据落报告目录)、sleep。步骤带 label 便于 diff 对齐' },
    spec_path: { type: 'string', description: 'run: spec 文件路径(.json 或含 ```qa-spec 围栏的 .md)，大套件建议用文件避免 token 截断；须在 ALLOWED_PROJECT_PATHS 白名单内' },
    project_path: { type: 'string', description: 'run: 项目路径(覆盖 spec 内的 project_path；spec 未写时必填)' },
    report_path: { type: 'string', description: 'report: 报告路径或 run_id；latest=最新，prev=次新' },
    base_path: { type: 'string', description: 'diff: 基线报告(默认 prev)' },
    head_path: { type: 'string', description: 'diff: 对比报告(默认 latest)' },
  },
  required: ['action'],
},
```

> 注:assert 8 种断言的字段级语义已经在 `spec.ts` 的 zod schema 注释与 runtime-assert schema description 里(Task 6 已写全);qa 顶层 schema 的 `spec` 字段 description 只做**索引级**概述(上面文本),避免重复维护两份字段语义(快照护栏:总字节以 matrix 实测为准)。

- [ ] **Step 4:测试通过 + matrix 重建 + budget 验证**

```bash
npx vitest run test/qa-index.test.ts && npm run build && npm run build-matrix && npm run check:budget
node -e "const m=require('./docs/capability-matrix.json');const qa=m.tools.find(t=>t.name==='qa');console.log('qa descBytes=',qa.size.descBytes,'schemaBytes=',qa.size.schemaBytes,'totalBytes=',qa.size.totalBytes)"
```
Expected: 测试 PASS;check:budget 无 error;输出 `descBytes < 600`、schemaBytes < 6000、totalBytes < 7000。

- [ ] **Step 5:Commit**

```bash
git add src/tools/qa/index.ts test/qa-index.test.ts docs/capability-matrix.json docs/capability-matrix.md
git commit -m "docs(qa): 工具描述重构——断言细节移入 schema 字段 description(Nit-3,descBytes<600)"
```

---

### Task 9:收尾验证 + 审查文档 + memory

**Files:**
- Create: `docs/reviews/2026-08-17-qa-assert-batch.md`(实现后由 code-reviewer 子 agent 产出,本任务只建占位结构并派单)
- memory 登记(feature-decision-log + engineering-lesson)

- [ ] **Step 1:全量验证(AGENTS.md 完成前强制检查)**

```bash
npm run lint && npm run build && npm test
```
Expected: 三项全绿(0 error / 0 failed)。若有失败,修复后重跑,连续 2 次失败停下问用户。

- [ ] **Step 2:e2e 冒烟(可选,有 GODOT_PATH 时)**

```bash
export GODOT_PATH="D:/godot/Godot_v4.7.1-stable_win64.exe"
export GODOT_MCP_E2E_L2=1
npx vitest run test/e2e-full-tool-verification.test.ts
```
Expected: 无新增 failed(qa 新断言的 e2e 深度覆盖在 spec §4 挂接任务中逐步补,本批至少不回归)。无 GODOT_PATH 则跳过并在审查文档注明。

- [ ] **Step 3:派 code-reviewer 子 agent 出第三方审查文档**

审查维度按 AGENTS.md「plan 落地后必出第三方审查文档」:设计正确性 / TS-GD 一致性 / 测试质量(接线零验证判别:删掉被测代码测试必须红) / 部署同步(build-matrix、双副本核查结论复核) / 仓库级约束独立核查(不对照本 plan 的改动面清单) / 验证完整性。产出 `docs/reviews/2026-08-17-qa-assert-batch.md`。

- [ ] **Step 4:处置审查意见(Blocking/Important 必处置,Nit 记录)**

- [ ] **Step 5:memory 登记**

`mcp__memory__create_entities`:
- `feature-decision-log`:qa-assert-batch PR-1a / commit 清单 / 关键决策(B-2 取数路径 poll 优先+补 stop;B-1 threshold 差异容忍语义三入口区分;errors baseline next_seq 锚点;RunState 跨步骤状态;resolveGameDataPath 上移 game-fs 解环) / 实现位置 file:line / deferred 项(monitor stop 后断言缓存未做——YAGNI)。
- `engineering-lesson`:GD 侧 watch/monitor 自动置 inactive 后 poll 返回空——断言取数必须 poll+stop 全量双路径(file:line:mcp_bridge.gd:1798-1800/1922)。

- [ ] **Step 6:最终提交**

```bash
git add docs/reviews/2026-08-17-qa-assert-batch.md
git commit -m "docs(review): PR-1a 断言四件套第三方审查归档"
```

---

## Self-Review 记录(writing-plans 自检)

1. **Spec 覆盖**:spec §1.1(Task 2)、§1.2 四断言语义(Task 4/5/7)+ teardown 兜底(Task 3)、§1.3 runtime-assert 真实现 + B-1 语义修正 + I-1 project_path(Task 6)、§1.4 描述重构 + B-4 验收口径(Task 8)、§1.5 改动面全对齐(含 build-matrix);§4 负向用例散布各 Task 测试代码;§5.1/5.2 验收在 Task 8 Step 4 与 Task 9。**无缺口。**
2. **占位符扫描**:Task 4 Step 3 的 `execErrorsAssert`/screenshot_diff 行是显式的分任务接线占位(带替换指令),非"implement later"式留白;其余步骤均含完整代码。**通过。**
3. **类型一致性**:`RunState`/`WatchEvent`/`MonitorSample` 在 Task 3 定义、Task 4/5 消费,签名一致;`assertScreenshotDiff` Task 6 导出、Task 7 import;`execStep` 六参签名 Task 3 变更后所有调用点(runQaSuite 步骤循环)同步。**通过。**
