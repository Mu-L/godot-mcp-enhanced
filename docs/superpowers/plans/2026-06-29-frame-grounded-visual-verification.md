# Frame-Grounded 视觉验证闭环 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Godogen 的 frame-grounded self-repair 核心（帧退化检测 + ASSERT 文本协议 + reference 对比 + proof 硬门）移植成 godot-mcp-enhanced 的可程序化验证能力，挂在现有 dev_loop acceptance 框架上。

**Architecture:** 双轨证据制——**像素/数值证据走 GDScript**（Godot 进程内 Image API 算 32×32 L2 embedding + 余弦相似度，零 npm 依赖），**判据/协议/归档走 TS 纯函数**（可单测）。所有新逻辑通过现有 `dev_loop`（workflow.ts）和 `verify_delivery`（delivery.ts）暴露，不新增独立 MCP 工具（YAGNI）。重写 `workflow.ts:407-444` 名字误导的"假 screenshot_diff"为真视觉对比。

**Tech Stack:** TypeScript (ESM), Vitest, GDScript (通过 executeGdscript 执行字符串), Godot 4 Image API

---

## Global Constraints

- **零新原生 npm 依赖**：所有图像数值计算用 GDScript 的 `Image.load_from_file` + `resize` + `get_data`，禁止引入 sharp/jimp/pixelmatch/pngjs（符合项目"避免原生依赖"风格，参考 Bridge 用 TCP 而非 ws 库）。
- **ESM 导入**：测试与源码均用 `import { x } from '../../src/tools/frame-verify/xxx.js'`（.js 扩展名，项目现有约定）。
- **多文件子系统建目录**：`src/tools/frame-verify/` 下放 ≥2 个源文件（符合 godot-mcp CLAUDE.md 目录规则）。
- **GDScript 输出协议**：所有 GDScript 探针用 `_mcp_output(key, value)` 返回结果，TS 侧从 `executeGdscript` 返回的 `outputs: {key, value}[]` 读取。数组值通过 GDScript `JSON.stringify` 编码为字符串传输（见 Task 1 注释）。
- **绝对路径**：本计划所有文件引用用绝对路径；GDScript 接收的 `frames_dir` 必须是 Godot 可访问路径（`user://` 或绝对路径）。
- **2D 截图空白限制**：帧序列捕获必须走 Bridge `take_screenshot`（GPU 渲染），不能用 headless screenshot（2D CanvasItem 在 headless 下空白，见 `.claude/rules/godot-mcp-core.md`）。
- **TDD**：每个任务先写失败测试再实现。所有判据阈值必须可单测。
- **发版前**：完整实现后跑 `verify_delivery` 确认无回归。

---

## 可移植算法来源（来自 Godogen 研究报告）

| 判据 | 算法 | 阈值 | 出处 |
|------|------|------|------|
| 帧全等 | 逐帧余弦相似度均值 | > 0.998 → 退化 | `D:\GitHub\godogen\godot\skills\godogen\capture.md:229` |
| 画面从未变化 | 1 − min(首帧 vs 各帧 sim) | < 0.002 → 退化 | `D:\GitHub\godogen\shared\skills\godogen\tools\find_loop_frame.py:86` |
| 窗口停滞 | 7帧滑动窗口内逐帧相似度均值 | > 0.95 占 >50% 窗口 → 退化 | `D:\GitHub\godogen\shared\skills\godogen\tools\find_loop_frame.py:40-44` |
| 后半段卡死 | 后1/3 − 前1/3 的 mean consecutive sim | > 0.05 → 退化 | `D:\GitHub\godogen\godot\skills\godogen\capture.md:182` |
| 帧数不足 | 帧序列长度 | < 9 → 退化 | 7 窗口 + 2 边界 |
| reference 整体相似 | cos(embed(截图), embed(reference)) | > 0.85 → 粗筛通过 | 复用 embedding 底座（移植新增） |
| ASSERT 协议 | grep stdout `ASSERT PASS:` / `ASSERT FAIL:` | 0 FAIL 且 ≥1 PASS → 通过 | `D:\GitHub\godogen\godot\skills\godogen\test-harness.md:16` |

帧 embedding 算法（`D:\GitHub\godogen\shared\skills\godogen\tools\find_loop_frame.py:34-37`）：`Image → resize(32,32) → flatten → L2 归一化 → 3072 维向量`，相似度 = 归一化向量点积（余弦）。

---

## File Structure

### 新建文件

```
src/tools/frame-verify/
  degradation.ts       — 帧退化判据引擎（纯函数）：classifyDegradation(metrics) + 阈值常量
  assert-protocol.ts   — ASSERT 文本协议解析（纯函数）：parseAsserts(stdout)
  proof-bundle.ts      — proof 目录管理：createProofRun/archiveFrame/writeMetrics
  gdscripts.ts         — GDScript 代码字符串生成器：extractFrameMetricsScript/referenceSimScript
test/tools/frame-verify/
  degradation.test.ts
  assert-protocol.test.ts
  proof-bundle.test.ts
  gdscripts.test.ts
```

### 修改文件

```
src/tools/workflow.ts   — 重写 screenshot_diff(407-444) + validateScreenshotAssertion(677-688)
                          + 新增 frame_degradation 断言类型 + frame_sequence 帧捕获参数
src/tools/delivery.ts   — verify_delivery 新增 visual_proof 维度（聚合退化/ASSERT/reference）
```

### 职责边界

- **degradation.ts**：只做"给定 metrics 数组 → 判定 degraded + reason"。不知道 GDScript、不知道文件系统。纯函数，100% 可单测。
- **assert-protocol.ts**：只做"给定 stdout 文本 → 提取 ASSERT PASS/FAIL"。纯函数。
- **proof-bundle.ts**：只做"创建/写入 proof 目录"。用 fs，不碰 GDScript。
- **gdscripts.ts**：只做"生成 GDScript 代码字符串"。返回 string，不执行。可单测（断言字符串含关键代码）。
- **workflow.ts**：编排层。调用上述纯函数 + executeGdscript + Bridge take_screenshot，把结果挂到 acceptance。
- **delivery.ts**：聚合层。调用 degradation/assert-protocol 做最终门禁判定。

---

## Task 1: 帧退化判据引擎（degradation.ts）

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\src\tools\frame-verify\degradation.ts`
- Test: `D:\GitHub\godot-mcp-enhanced\test\tools\frame-verify\degradation.test.ts`

**Interfaces:**
- Consumes: 无（纯函数，自包含）
- Produces: `FrameMetrics` 类型 + `classifyDegradation(metrics: FrameMetrics): DegradationResult`，供 Task 5/7 调用。签名：
  ```typescript
  export interface FrameMetrics {
    frameCount: number;
    consecutiveSims: number[];   // 逐帧余弦相似度（长度 = frameCount-1）
    firstFrameSims: number[];    // 首帧 vs 各后续帧（长度 = frameCount-1）
  }
  export interface DegradationResult {
    degraded: boolean;
    reason: string;              // 未退化时为 'ok'
    metrics: { meanConsecutive: number; maxChange: number; stallWindowRatio: number; tailLag: number };
  }
  export const DEGRADATION_THRESHOLDS = { IDENTICAL: 0.998, NEVER_CHANGE: 0.002, STALL: 0.95, TAIL_LAG: 0.05, WINDOW: 7, MIN_FRAMES: 9 };
  ```

- [ ] **Step 1: 写失败测试**

创建 `test/tools/frame-verify/degradation.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { classifyDegradation, DEGRADATION_THRESHOLDS } from '../../../src/tools/frame-verify/degradation.js';

describe('classifyDegradation', () => {
  // 帧数不足 → 退化
  it('flags degraded when frame count below MIN_FRAMES', () => {
    const r = classifyDegradation({ frameCount: 5, consecutiveSims: [0.9, 0.9, 0.9, 0.9], firstFrameSims: [0.9, 0.9, 0.9, 0.9] });
    expect(r.degraded).toBe(true);
    expect(r.reason).toContain('帧数不足');
  });

  // 帧全等 → 退化（mean consecutive > 0.998）
  it('flags degraded when all frames identical (mean consecutive > IDENTICAL)', () => {
    const n = 9;
    const consecutive = Array(n - 1).fill(0.999);
    const firstFrame = Array(n - 1).fill(1.0);
    const r = classifyDegradation({ frameCount: n, consecutiveSims: consecutive, firstFrameSims: firstFrame });
    expect(r.degraded).toBe(true);
    expect(r.reason).toContain('帧全等');
  });

  // 画面从未变化 → 退化（maxChange < 0.002，即 min firstFrameSim > 0.998）
  it('flags degraded when frame never changes (maxChange < NEVER_CHANGE)', () => {
    const n = 9;
    // consecutive 0.97（不全等），但首帧 vs 各帧都 0.999 → maxChange = 0.001 < 0.002
    const consecutive = Array(n - 1).fill(0.97);
    const firstFrame = Array(n - 1).fill(0.999);
    const r = classifyDegradation({ frameCount: n, consecutiveSims: consecutive, firstFrameSims: firstFrame });
    expect(r.degraded).toBe(true);
    expect(r.reason).toContain('从未变化');
  });

  // 后半段卡死 → 退化（后1/3 mean consecutive − 前1/3 > 0.05）
  it('flags degraded when tail stalls (tail lag > TAIL_LAG)', () => {
    const n = 12;
    // 前 1/3 consecutive=0.80，后 1/3 consecutive=0.99 → tailLag=0.19 > 0.05
    const consecutive = [0.80,0.80,0.80, 0.90,0.90,0.90,0.90, 0.99,0.99,0.99,0.99];
    const firstFrame = [0.5,0.4,0.3,0.25,0.2,0.18,0.16,0.15,0.15,0.15,0.15];
    const r = classifyDegradation({ frameCount: n, consecutiveSims: consecutive, firstFrameSims: firstFrame });
    expect(r.degraded).toBe(true);
    expect(r.reason).toContain('后半段卡死');
  });

  // 正常运动 → 未退化
  it('passes when frames show healthy motion', () => {
    const n = 12;
    // consecutive 0.6~0.8（适度变化），firstFrame 递减（持续远离首帧）
    const consecutive = [0.75,0.70,0.68,0.72,0.65,0.60,0.58,0.62,0.70,0.66,0.64];
    const firstFrame = [0.75,0.55,0.40,0.30,0.22,0.18,0.15,0.20,0.28,0.25,0.22];
    const r = classifyDegradation({ frameCount: n, consecutiveSims: consecutive, firstFrameSims: firstFrame });
    expect(r.degraded).toBe(false);
    expect(r.reason).toBe('ok');
  });

  // 阈值常量导出可引用
  it('exports threshold constants', () => {
    expect(DEGRADATION_THRESHOLDS.IDENTICAL).toBe(0.998);
    expect(DEGRADATION_THRESHOLDS.WINDOW).toBe(7);
    expect(DEGRADATION_THRESHOLDS.MIN_FRAMES).toBe(9);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/tools/frame-verify/degradation.test.ts`
Expected: FAIL — `Cannot find module '...degradation.js'`

- [ ] **Step 3: 实现纯函数**

创建 `src/tools/frame-verify/degradation.ts`：

```typescript
// 帧退化判据引擎 —— 纯函数，无 GDScript / 无文件系统依赖。
// 阈值来源：D:\GitHub\godogen（capture.md:229, find_loop_frame.py:40-86）

export const DEGRADATION_THRESHOLDS = {
  IDENTICAL: 0.998,      // 逐帧相似度均值 > 此值 = 帧全等
  NEVER_CHANGE: 0.002,   // maxChange = 1 - min(firstFrameSim) < 此值 = 从未变化
  STALL: 0.95,           // 窗口均值 > 此值 = 局部停滞
  STALL_RATIO: 0.5,      // 停滞窗口占比 > 此值 = 退化
  TAIL_LAG: 0.05,        // 后1/3 - 前1/3 的 consecutive 均值差 > 此值 = 后半段卡死
  WINDOW: 7,             // 滑动窗口大小（与 find_loop_frame 一致）
  MIN_FRAMES: 9,         // 最小帧数（WINDOW + 2 边界）
} as const;

export interface FrameMetrics {
  frameCount: number;
  consecutiveSims: number[];   // 长度 = frameCount - 1
  firstFrameSims: number[];    // 长度 = frameCount - 1
}

export interface DegradationResult {
  degraded: boolean;
  reason: string;
  metrics: {
    meanConsecutive: number;
    maxChange: number;
    stallWindowRatio: number;
    tailLag: number;
  };
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function classifyDegradation(m: FrameMetrics): DegradationResult {
  const T = DEGRADATION_THRESHOLDS;
  const empty: DegradationResult['metrics'] = { meanConsecutive: 0, maxChange: 0, stallWindowRatio: 0, tailLag: 0 };

  if (m.frameCount < T.MIN_FRAMES) {
    return { degraded: true, reason: `帧数不足（${m.frameCount} < ${T.MIN_FRAMES}）`, metrics: empty };
  }

  const meanConsecutive = mean(m.consecutiveSims);
  const minFirstSim = m.firstFrameSims.length > 0 ? Math.min(...m.firstFrameSims) : 1;
  const maxChange = 1 - minFirstSim;

  // 滑动窗口停滞占比
  const win = T.WINDOW;
  let stallWindows = 0;
  let totalWindows = 0;
  for (let i = 0; i + win <= m.consecutiveSims.length; i++) {
    const chunk = m.consecutiveSims.slice(i, i + win);
    if (mean(chunk) > T.STALL) stallWindows++;
    totalWindows++;
  }
  const stallWindowRatio = totalWindows > 0 ? stallWindows / totalWindows : 0;

  // 后半段卡死：前1/3 vs 后1/3 的 consecutive 均值差
  const third = Math.max(1, Math.floor(m.consecutiveSims.length / 3));
  const head = m.consecutiveSims.slice(0, third);
  const tail = m.consecutiveSims.slice(-third);
  const tailLag = mean(tail) - mean(head);

  const metrics = { meanConsecutive, maxChange, stallWindowRatio, tailLag };

  if (meanConsecutive > T.IDENTICAL) {
    return { degraded: true, reason: `帧全等（mean consecutive ${meanConsecutive.toFixed(4)} > ${T.IDENTICAL}，疑似相机/时序/输入未接线）`, metrics };
  }
  if (maxChange < T.NEVER_CHANGE) {
    return { degraded: true, reason: `画面从未变化（maxChange ${maxChange.toFixed(4)} < ${T.NEVER_CHANGE}）`, metrics };
  }
  if (stallWindowRatio > T.STALL_RATIO) {
    return { degraded: true, reason: `超过半数窗口停滞（${(stallWindowRatio * 100).toFixed(0)}% 窗口 consecutive > ${T.STALL}）`, metrics };
  }
  if (tailLag > T.TAIL_LAG) {
    return { degraded: true, reason: `后半段卡死（tailLag ${tailLag.toFixed(4)} > ${T.TAIL_LAG}，开头痛快后段冻结）`, metrics };
  }
  return { degraded: false, reason: 'ok', metrics };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/tools/frame-verify/degradation.test.ts`
Expected: PASS（全部 6 个用例）

- [ ] **Step 5: 提交**

```bash
git add src/tools/frame-verify/degradation.ts test/tools/frame-verify/degradation.test.ts
git commit -m "feat(frame-verify): 帧退化判据引擎（移植 Godogen capture.md 阈值）"
```

---

## Task 2: ASSERT 文本协议解析（assert-protocol.ts）

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\src\tools\frame-verify\assert-protocol.ts`
- Test: `D:\GitHub\godot-mcp-enhanced\test\tools\frame-verify\assert-protocol.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `parseAsserts(stdout: string): AssertSummary`，供 Task 7（verify_delivery）调用。
  ```typescript
  export interface AssertSummary { passCount: number; failCount: number; fails: string[]; passed: boolean; }
  ```
  协议约定：stdout 中 `ASSERT PASS: <desc>` 计入 pass，`ASSERT FAIL: <desc>` 计入 fail。passed = failCount===0 && passCount>0。

- [ ] **Step 1: 写失败测试**

创建 `test/tools/frame-verify/assert-protocol.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { parseAsserts } from '../../../src/tools/frame-verify/assert-protocol.js';

describe('parseAsserts', () => {
  it('counts PASS and FAIL lines', () => {
    const stdout = 'some log\nASSERT PASS: player moving\nASSERT FAIL: speed too low: 3.2\nASSERT PASS: hp full\n';
    const r = parseAsserts(stdout);
    expect(r.passCount).toBe(2);
    expect(r.failCount).toBe(1);
    expect(r.fails).toEqual(['speed too low: 3.2']);
    expect(r.passed).toBe(false);
  });

  it('passed when only PASS lines and no FAIL', () => {
    const r = parseAsserts('ASSERT PASS: a\nASSERT PASS: b\n');
    expect(r.passed).toBe(true);
    expect(r.passCount).toBe(2);
    expect(r.failCount).toBe(0);
  });

  it('not passed when no ASSERT lines at all (no evidence)', () => {
    const r = parseAsserts('just some output, no asserts');
    expect(r.passCount).toBe(0);
    expect(r.failCount).toBe(0);
    expect(r.passed).toBe(false);
  });

  it('captures full FAIL description after the prefix', () => {
    const r = parseAsserts('ASSERT FAIL: pos=(1,2) vel=(0,0) expected moving\n');
    expect(r.fails).toEqual(['pos=(1,2) vel=(0,0) expected moving']);
  });

  it('handles CRLF line endings', () => {
    const r = parseAsserts('ASSERT PASS: ok\r\nASSERT FAIL: bad\r\n');
    expect(r.passCount).toBe(1);
    expect(r.failCount).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/tools/frame-verify/assert-protocol.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现**

创建 `src/tools/frame-verify/assert-protocol.ts`：

```typescript
// ASSERT 文本协议解析 —— 把 Godogen test-harness.md 的 GD.Print("ASSERT PASS/FAIL") 协议
// 转成可程序化判定的结构。来源：D:\GitHub\godogen\godot\skills\godogen\test-harness.md:16

export interface AssertSummary {
  passCount: number;
  failCount: number;
  fails: string[];
  passed: boolean;   // failCount===0 && passCount>0
}

const PASS_RE = /^ASSERT PASS:\s*(.*)$/;
const FAIL_RE = /^ASSERT FAIL:\s*(.*)$/;

export function parseAsserts(stdout: string): AssertSummary {
  const lines = stdout.split(/\r?\n/);
  let passCount = 0;
  const fails: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const pm = trimmed.match(PASS_RE);
    if (pm) { passCount++; continue; }
    const fm = trimmed.match(FAIL_RE);
    if (fm) { fails.push(fm[1].trim()); continue; }
  }
  return {
    passCount,
    failCount: fails.length,
    fails,
    passed: fails.length === 0 && passCount > 0,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/tools/frame-verify/assert-protocol.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/tools/frame-verify/assert-protocol.ts test/tools/frame-verify/assert-protocol.test.ts
git commit -m "feat(frame-verify): ASSERT PASS/FAIL 文本协议解析"
```

---

## Task 3: proof bundle 目录管理（proof-bundle.ts）

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\src\tools\frame-verify\proof-bundle.ts`
- Test: `D:\GitHub\godot-mcp-enhanced\test\tools\frame-verify\proof-bundle.test.ts`

**Interfaces:**
- Consumes: 无（用 node:fs/node:path）
- Produces:
  ```typescript
  export interface ProofRun { runId: string; dir: string; }
  export function createProofRun(projectPath: string): ProofRun;                    // 创建 proof/<runId>/ 目录
  export function archiveFrame(run: ProofRun, index: number, pngBuffer: Buffer): string;  // 写 frame_NN.png，返回相对路径
  export function writeMetrics(run: ProofRun, metrics: Record<string, unknown>): string;   // 写 metrics.json
  ```
  供 Task 6（帧序列捕获）调用。命名借鉴 `recording.ts:67-73` 的 `recording_YYYYMMDD_HHmmss` 模式，用 `run_<timestamp>`。

- [ ] **Step 1: 写失败测试**

创建 `test/tools/frame-verify/proof-bundle.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createProofRun, archiveFrame, writeMetrics } from '../../../src/tools/frame-verify/proof-bundle.js';

describe('proof-bundle', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('createProofRun creates proof/<runId>/ under project', () => {
    const run = createProofRun(tmp);
    expect(run.runId).toMatch(/^run_\d+$/);
    expect(fs.existsSync(run.dir)).toBe(true);
    expect(run.dir.startsWith(path.join(tmp, 'proof'))).toBe(true);
  });

  it('archiveFrame writes frame_00.png with zero-padded index', () => {
    const run = createProofRun(tmp);
    const rel = archiveFrame(run, 0, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const abs = path.join(run.dir, 'frame_00.png');
    expect(fs.existsSync(abs)).toBe(true);
    expect(rel).toBe('frame_00.png');
  });

  it('archiveFrame pads to 2 digits', () => {
    const run = createProofRun(tmp);
    archiveFrame(run, 12, Buffer.from('x'));
    expect(fs.existsSync(path.join(run.dir, 'frame_12.png'))).toBe(true);
  });

  it('writeMetrics writes metrics.json', () => {
    const run = createProofRun(tmp);
    const rel = writeMetrics(run, { degraded: false, meanConsecutive: 0.7 });
    const abs = path.join(run.dir, 'metrics.json');
    expect(fs.existsSync(abs)).toBe(true);
    expect(JSON.parse(fs.readFileSync(abs, 'utf-8')).degraded).toBe(false);
    expect(rel).toBe('metrics.json');
  });

  it('two runs get distinct runIds', () => {
    const a = createProofRun(tmp);
    const b = createProofRun(tmp);
    expect(a.runId).not.toBe(b.runId);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/tools/frame-verify/proof-bundle.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现**

创建 `src/tools/frame-verify/proof-bundle.ts`：

```typescript
// proof bundle 目录管理 —— 借鉴 recording.ts:67-73 的 recording_<timestamp> 命名模式。
// 把一次验证运行的所有帧 + metrics 归档到 proof/<runId>/。

import * as fs from 'fs';
import * as path from 'path';

export interface ProofRun {
  runId: string;
  dir: string;   // 绝对路径
}

export function createProofRun(projectPath: string): ProofRun {
  // runId 用 Date.now() 保证唯一（TS 服务端可用 Date，非 Workflow 脚本限制范围）
  const runId = `run_${Date.now()}`;
  const dir = path.join(projectPath, 'proof', runId);
  fs.mkdirSync(dir, { recursive: true });
  return { runId, dir };
}

export function archiveFrame(run: ProofRun, index: number, pngBuffer: Buffer): string {
  const name = `frame_${String(index).padStart(2, '0')}.png`;
  fs.writeFileSync(path.join(run.dir, name), pngBuffer);
  return name;
}

export function writeMetrics(run: ProofRun, metrics: Record<string, unknown>): string {
  const name = 'metrics.json';
  fs.writeFileSync(path.join(run.dir, name), JSON.stringify(metrics, null, 2), 'utf-8');
  return name;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/tools/frame-verify/proof-bundle.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/tools/frame-verify/proof-bundle.ts test/tools/frame-verify/proof-bundle.test.ts
git commit -m "feat(frame-verify): proof bundle 目录管理（run_<timestamp> 归档）"
```

---

## Task 4: GDScript 帧指标提取 + reference 相似度（gdscripts.ts）

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\src\tools\frame-verify\gdscripts.ts`
- Test: `D:\GitHub\godot-mcp-enhanced\test\tools\frame-verify\gdscripts.test.ts`

**Interfaces:**
- Consumes: 无（只生成字符串）
- Produces: 两个字符串生成器，供 Task 5/6 通过 `executeGdscript({ code })` 执行：
  ```typescript
  export function extractFrameMetricsScript(framesDir: string): string;      // 扫描 frame_*.png，返回 frame_count/consecutive_sims/first_frame_sims（JSON 字符串）
  export function referenceSimScript(screenshotPath: string, referencePath: string): string;  // 返回 reference_sim 标量
  ```
  **输出协议**：GDScript 用 `_mcp_output("consecutive_sims", <json字符串>)` 等。数组经 `JSON.stringify` 编码成字符串传输（executeGdscript 的 outputs value 限定为标量安全）。

- [ ] **Step 1: 写失败测试**

创建 `test/tools/frame-verify/gdscripts.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { extractFrameMetricsScript, referenceSimScript } from '../../../src/tools/frame-verify/gdscripts.js';

describe('extractFrameMetricsScript', () => {
  it('embeds framesDir into the script', () => {
    const s = extractFrameMetricsScript('user://proof/run_1');
    expect(s).toContain('user://proof/run_1');
  });

  it('uses 32x32 resize and L2 normalization', () => {
    const s = extractFrameMetricsScript('user://x');
    expect(s).toContain('resize(32, 32)');
    expect(s).toContain('32 * 32 * 3');
    // L2 归一化：除以 sqrt(sum_sq)+eps
    expect(s).toMatch(/sqrt\(sum_sq\)/);
  });

  it('lists frame_*.png sorted and outputs consecutive + first_frame sims as JSON', () => {
    const s = extractFrameMetricsScript('user://x');
    expect(s).toContain('frame_');
    expect(s).toContain('.png');
    expect(s).toContain('JSON.stringify');
    expect(s).toContain('"consecutive_sims"');
    expect(s).toContain('"first_frame_sims"');
    expect(s).toContain('"frame_count"');
  });

  it('guards against empty dir (frame_count < 2 returns error)', () => {
    const s = extractFrameMetricsScript('user://x');
    expect(s).toContain('< 2');
  });
});

describe('referenceSimScript', () => {
  it('computes cosine sim between screenshot and reference embeddings', () => {
    const s = referenceSimScript('user://shot.png', 'user://ref.png');
    expect(s).toContain('user://shot.png');
    expect(s).toContain('user://ref.png');
    expect(s).toContain('resize(32, 32)');
    expect(s).toContain('"reference_sim"');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/tools/frame-verify/gdscripts.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现字符串生成器**

创建 `src/tools/frame-verify/gdscripts.ts`：

```typescript
// GDScript 代码字符串生成器 —— 返回字符串，不执行。由 workflow.ts 通过 executeGdscript 执行。
// 图像数值计算放 GDScript（Godot Image API，零 npm 依赖）。
// embedding 算法来源：D:\GitHub\godogen\shared\skills\godogen\tools\find_loop_frame.py:34-37

export function extractFrameMetricsScript(framesDir: string): string {
  // 注意：framesDir 用字符串拼接，调用方必须保证是可信路径（来自 proof-bundle 创建的目录）
  return `extends SceneTree

var _frames_dir := "${framesDir}"
var _outputs := []

func _mcp_output(key, value):
	_outputs.append({"key": key, "value": value})

func _mcp_done():
	print(JSON.stringify(_outputs))
	quit()

func _embed(path: String) -> PackedFloat32Array:
	var img := Image.load_from_file(path)
	img.resize(32, 32)
	var raw := img.get_data()
	var v := PackedFloat32Array()
	v.resize(32 * 32 * 3)
	var sum_sq := 0.0
	for i in range(32 * 32):
		var r := raw[i * 4] / 255.0
		var g := raw[i * 4 + 1] / 255.0
		var b := raw[i * 4 + 2] / 255.0
		v[i * 3] = r
		v[i * 3 + 1] = g
		v[i * 3 + 2] = b
		sum_sq += r * r + g * g + b * b
	var norm := sqrt(sum_sq) + 1e-8
	for i in range(v.size()):
		v[i] = v[i] / norm
	return v

func _cos(a: PackedFloat32Array, b: PackedFloat32Array) -> float:
	var s := 0.0
	for i in range(a.size()):
		s += a[i] * b[i]
	return s

func _initialize():
	var dir := DirAccess.open(_frames_dir)
	if dir == null:
		_mcp_output("error", "cannot open frames dir")
		_mcp_done()
		return
	var files := PackedStringArray()
	dir.list_dir_begin()
	var fn := dir.get_next()
	while fn != "":
		if fn.begins_with("frame_") and fn.ends_with(".png"):
			files.append(_frames_dir + "/" + fn)
		fn = dir.get_next()
	dir.list_dir_end()
	files.sort()
	if files.size() < 2:
		_mcp_output("frame_count", files.size())
		_mcp_output("error", "need >= 2 frames")
		_mcp_done()
		return
	var embs := []
	for f in files:
		embs.append(_embed(f))
	var consecutive := []
	for i in range(embs.size() - 1):
		consecutive.append(_cos(embs[i], embs[i + 1]))
	var first_sims := []
	for j in range(1, embs.size()):
		first_sims.append(_cos(embs[0], embs[j]))
	_mcp_output("frame_count", files.size())
	_mcp_output("consecutive_sims", JSON.stringify(consecutive))
	_mcp_output("first_frame_sims", JSON.stringify(first_sims))
	_mcp_done()
`;
}

export function referenceSimScript(screenshotPath: string, referencePath: string): string {
  return `extends SceneTree

var _outputs := []

func _mcp_output(key, value):
	_outputs.append({"key": key, "value": value})

func _mcp_done():
	print(JSON.stringify(_outputs))
	quit()

func _embed(path: String) -> PackedFloat32Array:
	var img := Image.load_from_file(path)
	img.resize(32, 32)
	var raw := img.get_data()
	var v := PackedFloat32Array()
	v.resize(32 * 32 * 3)
	var sum_sq := 0.0
	for i in range(32 * 32):
		var r := raw[i * 4] / 255.0
		var g := raw[i * 4 + 1] / 255.0
		var b := raw[i * 4 + 2] / 255.0
		v[i * 3] = r
		v[i * 3 + 1] = g
		v[i * 3 + 2] = b
		sum_sq += r * r + g * g + b * b
	var norm := sqrt(sum_sq) + 1e-8
	for i in range(v.size()):
		v[i] = v[i] / norm
	return v

func _cos(a: PackedFloat32Array, b: PackedFloat32Array) -> float:
	var s := 0.0
	for i in range(a.size()):
		s += a[i] * b[i]
	return s

func _initialize():
	var a := _embed("${screenshotPath}")
	var b := _embed("${referencePath}")
	_mcp_output("reference_sim", _cos(a, b))
	_mcp_done()
`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/tools/frame-verify/gdscripts.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/tools/frame-verify/gdscripts.ts test/tools/frame-verify/gdscripts.test.ts
git commit -m "feat(frame-verify): GDScript 帧指标提取 + reference 相似度脚本生成"
```

---

## Task 5: 重写 screenshot_diff 为真视觉对比（workflow.ts）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\tools\workflow.ts:407-444`（重写 screenshot_diff 分支）
- Modify: `D:\GitHub\godot-mcp-enhanced\src\tools\workflow.ts:677-688`（扩展 validateScreenshotAssertion）
- Test: `D:\GitHub\godot-mcp-enhanced\test\tools\workflow-screenshot-diff.test.ts`（新建）

**Interfaces:**
- Consumes: `referenceSimScript`（Task 4），`executeGdscript`（workflow.ts 内已有）
- Produces: screenshot_diff 断言增强——新增 `reference_path`（可选）触发余弦相似度对比（阈值 `sim_threshold` 默认 0.85）；`expect_present` 改用 `find_ui_elements(visible_only=true)` 真可见性检查（替代当前 `get_tree` + `includes` 假检查）。

**改动语义**：原来"screenshot_diff"只查"截图成功 + 节点名 includes"。现在：若提供 `reference_path`，额外跑 reference 余弦相似度作为粗筛；`expect_present` 改真可见性。向后兼容（无 reference_path 时行为不弱于现在）。

- [ ] **Step 1: 写失败测试**

创建 `test/tools/workflow-screenshot-diff.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { validateScreenshotAssertion } from '../../src/tools/workflow.js';

describe('validateScreenshotAssertion (增强)', () => {
  it('accepts reference_path as optional string', () => {
    const r = validateScreenshotAssertion({ description: 'd', reference_path: 'user://ref.png' });
    expect(r.valid).toBe(true);
  });

  it('rejects non-string reference_path', () => {
    const r = validateScreenshotAssertion({ description: 'd', reference_path: 123 });
    expect(r.valid).toBe(false);
    expect(r.error).toContain('reference_path');
  });

  it('accepts sim_threshold as optional number', () => {
    const r = validateScreenshotAssertion({ description: 'd', reference_path: 'user://r.png', sim_threshold: 0.9 });
    expect(r.valid).toBe(true);
  });

  it('still validates expect_present as string array', () => {
    const r = validateScreenshotAssertion({ description: 'd', expect_present: 'notarray' });
    expect(r.valid).toBe(false);
  });

  it('still requires description', () => {
    const r = validateScreenshotAssertion({ reference_path: 'user://r.png' });
    expect(r.valid).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/tools/workflow-screenshot-diff.test.ts`
Expected: FAIL — `reference_path` 未被识别（当前 validateScreenshotAssertion 不校验它）

- [ ] **Step 3: 扩展 validateScreenshotAssertion**

修改 `src/tools/workflow.ts:677-688`，替换 `validateScreenshotAssertion` 整个函数体为：

```typescript
export function validateScreenshotAssertion(
  assertion: Record<string, unknown>,
): { valid: boolean; error?: string } {
  if (!assertion.description || typeof assertion.description !== 'string') {
    return { valid: false, error: 'screenshot_diff assertion requires a description field' };
  }
  const ep = assertion.expect_present;
  if (ep !== undefined && !Array.isArray(ep)) {
    return { valid: false, error: 'expect_present must be a string array' };
  }
  const rp = assertion.reference_path;
  if (rp !== undefined && typeof rp !== 'string') {
    return { valid: false, error: 'reference_path must be a string' };
  }
  const st = assertion.sim_threshold;
  if (st !== undefined && (typeof st !== 'number' || st < 0 || st > 1)) {
    return { valid: false, error: 'sim_threshold must be a number in [0, 1]' };
  }
  return { valid: true };
}
```

并在文件顶部 import 区（`validateScreenshotAssertion` 定义之前）加入：

```typescript
import { referenceSimScript } from './frame-verify/gdscripts.js';
```

- [ ] **Step 4: 重写 screenshot_diff 分支**

替换 `src/tools/workflow.ts:407-444`（整个 `if (assertType === 'screenshot_diff') { ... continue; }` 块）为：

```typescript
            // ── screenshot_diff assertion（真视觉对比）──
            if (assertType === 'screenshot_diff') {
              const validation = validateScreenshotAssertion(a as Record<string, unknown>);
              if (!validation.valid) {
                assertionResults.push({ description: desc, passed: false, error: validation.error });
                continue;
              }
              try {
                const ssResp = await sendToBridge('take_screenshot', { path: 'user://mcp_assert_screenshot.png' }, 10000);
                if (ssResp.error) {
                  assertionResults.push({ description: desc, passed: false, error: `Screenshot failed: ${ssResp.error.message ?? JSON.stringify(ssResp.error)}` });
                  continue;
                }
                const partials: string[] = [];

                // (a) reference 余弦相似度粗筛（若提供 reference_path）
                const referencePath = (a as Record<string, unknown>).reference_path as string | undefined;
                if (referencePath) {
                  const simThreshold = (a as Record<string, unknown>).sim_threshold as number | undefined ?? 0.85;
                  const simResult = await executeGdscript({
                    godotPath: godot, projectPath,
                    code: referenceSimScript('user://mcp_assert_screenshot.png', referencePath),
                    timeout: Math.min(timeout, 15), loadAutoloads,
                  });
                  if (!simResult.compile_success || !simResult.run_success) {
                    assertionResults.push({ description: desc, passed: false, error: `reference sim failed: ${simResult.compile_error || simResult.run_error}` });
                    continue;
                  }
                  const sim = Number(simResult.outputs.find(e => e.key === 'reference_sim')?.value ?? -1);
                  partials.push(`reference_sim=${sim.toFixed(3)} (threshold ${simThreshold})`);
                  if (sim < simThreshold) {
                    assertionResults.push({ description: desc, passed: false, actual: partials.join('; '), expected: `reference_sim >= ${simThreshold}` });
                    continue;
                  }
                }

                // (b) 真可见性检查（替代旧 get_tree + includes 假检查）
                const expectPresent = (a as Record<string, unknown>).expect_present as string[] | undefined;
                if (expectPresent && expectPresent.length > 0) {
                  const visResp = await sendToBridge('find_ui_elements', { pattern: '*', visible_only: true, limit: 500 }, 10000);
                  if (visResp.error) {
                    assertionResults.push({ description: desc, passed: false, error: `find_ui_elements failed: ${visResp.error.message ?? JSON.stringify(visResp.error)}` });
                    continue;
                  }
                  const visStr = JSON.stringify(visResp);
                  const missing = expectPresent.filter(name => !visStr.includes(name));
                  if (missing.length > 0) {
                    assertionResults.push({ description: desc, passed: false, actual: `missing visible: ${missing.join(', ')}`, expected: `all visible: ${expectPresent.join(', ')}` });
                    continue;
                  }
                  partials.push(`visible: ${expectPresent.join(', ')}`);
                }

                assertionResults.push({ description: desc, passed: true, actual: partials.join('; ') || 'screenshot captured' });
              } catch (err) {
                assertionResults.push({ description: desc, passed: false, error: err instanceof Error ? err.message : String(err) });
              }
              continue;
            }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run test/tools/workflow-screenshot-diff.test.ts`
Expected: PASS（5 个用例）

Run: `npx vitest run test/tools/workflow*.test.ts`
Expected: 现有 workflow 测试无回归

- [ ] **Step 6: 提交**

```bash
git add src/tools/workflow.ts test/tools/workflow-screenshot-diff.test.ts
git commit -m "fix(workflow): screenshot_diff 真视觉对比（reference 余弦相似度 + 真可见性，替换假 includes）"
```

---

## Task 6: frame_sequence 帧捕获 + frame_degradation 断言（workflow.ts）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\tools\workflow.ts`（acceptance 断言循环内新增 `frame_degradation` 分支；新增 `frame_sequence` 捕获逻辑）
- Test: `D:\GitHub\godot-mcp-enhanced\test\tools\workflow-frame-degradation.test.ts`（新建）

**Interfaces:**
- Consumes: `classifyDegradation`（Task 1）, `extractFrameMetricsScript`（Task 4）, `createProofRun`/`archiveFrame`（Task 3）, `executeGdscript`, `sendToBridge('take_screenshot')`
- Produces: 两个新能力——
  1. **断言类型 `frame_degradation`**：参数 `{ description, frames_dir }`（或 `{ count, interval_frames }` 触发自动捕获）。截帧→GDScript 提取 metrics→classifyDegradation 判定。`degraded=true` 则断言失败。
  2. **acceptance 顶层 `frame_sequence` 字段**：`{ count: number, interval_frames: number }`，在断言执行前用 Bridge `take_screenshot` 循环捕获 N 帧到 proof 目录，供 frame_degradation 断言引用。

- [ ] **Step 1: 写失败测试**

创建 `test/tools/workflow-frame-degradation.test.ts`（纯字符串/常量层断言，不实际跑 Godot）：

```typescript
import { describe, it, expect } from 'vitest';
import { extractFrameMetricsScript } from '../../src/tools/frame-verify/gdscripts.js';
import { classifyDegradation } from '../../src/tools/frame-verify/degradation.js';

describe('frame_degradation 端到端契约（脚本生成 + 判据）', () => {
  it('生成的 GDScript 输出 consecutive_sims/first_frame_sims，classifyDegradation 能消费', () => {
    const script = extractFrameMetricsScript('user://proof/run_x');
    // 脚本必须输出这两个 key（JSON 字符串）
    expect(script).toContain('"consecutive_sims"');
    expect(script).toContain('"first_frame_sims"');
    expect(script).toContain('"frame_count"');
  });

  it('GDScript 返回的 metrics 喂给 classifyDegradation 能正确判定退化', () => {
    // 模拟 GDScript 对 9 张全等帧返回的 metrics
    const consecutive = Array(8).fill(0.999);
    const firstFrame = Array(8).fill(1.0);
    const r = classifyDegradation({ frameCount: 9, consecutiveSims: consecutive, firstFrameSims: firstFrame });
    expect(r.degraded).toBe(true);
  });

  it('正常运动帧的 metrics 判定为不退化', () => {
    const consecutive = [0.75,0.70,0.68,0.72,0.65,0.60,0.58,0.62];
    const firstFrame = [0.75,0.55,0.40,0.30,0.22,0.18,0.15,0.20];
    const r = classifyDegradation({ frameCount: 9, consecutiveSims: consecutive, firstFrameSims: firstFrame });
    expect(r.degraded).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/tools/workflow-frame-degradation.test.ts`
Expected: 三个用例中至少 "端到端契约" 用例需要 extractFrameMetricsScript + classifyDegradation 同时存在（Task 1/4 已实现，应 PASS）。此测试主要锁定**契约**，确认两边接口对齐。若已 PASS，说明契约成立，继续 Step 3 做集成。

- [ ] **Step 3: 在 workflow.ts acceptance 断言循环内新增 frame_degradation 分支**

在 `src/tools/workflow.ts` 顶部 import 区加入：

```typescript
import { classifyDegradation, type FrameMetrics } from './frame-verify/degradation.js';
import { extractFrameMetricsScript } from './frame-verify/gdscripts.js';
import { createProofRun, archiveFrame } from './frame-verify/proof-bundle.js';
```

在 acceptance 断言循环中，`if (assertType === 'screenshot_diff') { ... continue; }` 块**之后**、`// ── default: gdscript assertion ──` 之前，插入新分支：

```typescript
            // ── frame_degradation assertion（帧退化检测，Godogen 灵魂）──
            if (assertType === 'frame_degradation') {
              const fd = a as Record<string, unknown>;
              if (typeof fd.description !== 'string') {
                assertionResults.push({ description: 'frame_degradation', passed: false, error: 'requires description' });
                continue;
              }
              const framesDir = fd.frames_dir as string | undefined;
              if (!framesDir) {
                assertionResults.push({ description: fd.description, passed: false, error: 'frame_degradation requires frames_dir (run capture first via frame_sequence)' });
                continue;
              }
              try {
                const metricsResult = await executeGdscript({
                  godotPath: godot, projectPath,
                  code: extractFrameMetricsScript(framesDir),
                  timeout: Math.min(timeout, 30), loadAutoloads,
                });
                if (!metricsResult.compile_success || !metricsResult.run_success) {
                  assertionResults.push({ description: fd.description, passed: false, error: `metrics extraction failed: ${metricsResult.compile_error || metricsResult.run_error}` });
                  continue;
                }
                const out = (key: string) => metricsResult.outputs.find(e => e.key === key)?.value;
                const frameCount = Number(out('frame_count') ?? 0);
                const consecutive = JSON.parse(String(out('consecutive_sims') ?? '[]')) as number[];
                const firstFrame = JSON.parse(String(out('first_frame_sims') ?? '[]')) as number[];
                const verdict = classifyDegradation({ frameCount, consecutiveSims: consecutive, firstFrameSims: firstFrame } as FrameMetrics);
                assertionResults.push({
                  description: fd.description,
                  passed: !verdict.degraded,
                  actual: verdict.degraded ? `DEGRADED: ${verdict.reason}` : `healthy (meanConsecutive=${verdict.metrics.meanConsecutive.toFixed(3)}, maxChange=${verdict.metrics.maxChange.toFixed(3)})`,
                  expected: 'frames show real motion (not identical/stalled)',
                });
              } catch (err) {
                assertionResults.push({ description: fd.description, passed: false, error: err instanceof Error ? err.message : String(err) });
              }
              continue;
            }
```

- [ ] **Step 4: 新增 acceptance 顶层 frame_sequence 自动捕获**

在 `src/tools/workflow.ts` 的 acceptance 处理块**开头**（`if (acceptance) {` 之后、`const assertionList = ...` 之前，即约 397 行之后）插入帧序列捕获逻辑：

```typescript
        // ── frame_sequence: 自动捕获 N 帧到 proof 目录，供 frame_degradation 断言引用 ──
        let capturedFramesDir: string | undefined;
        const frameSeq = acceptance.frame_sequence as { count?: number; interval_frames?: number } | undefined;
        if (frameSeq && typeof frameSeq === 'object') {
          const count = Math.min(Math.max(Math.floor(frameSeq.count ?? 12), 2), 60);
          const interval = Math.min(Math.max(Math.floor(frameSeq.interval_frames ?? 10), 1), 300);
          try {
            const run = createProofRun(projectPath);
            // proof 目录在项目内；Bridge take_screenshot 路径必须 user:// 开头，先截到 user:// 再归档
            for (let i = 0; i < count; i++) {
              const tmpPath = `user://mcp_frame_${i}.png`;
              const ssResp = await sendToBridge('take_screenshot', { path: tmpPath }, 10000);
              if (ssResp.error) break;
              // 通过 executeGdscript 把 user:// 的 PNG 字节读到 proof 目录
              const copyScript = `extends SceneTree
func _initialize():
	var img := Image.load_from_file("${tmpPath}")
	var f := FileAccess.open("${run.dir}/frame_${String(i).pad_zeros(2)}.png", FileAccess.WRITE)
	f.store_buffer(img.save_png_to_buffer())
	quit()
`;
              await executeGdscript({ godotPath: godot, projectPath, code: copyScript, timeout: Math.min(timeout, 15), loadAutoloads });
              if (i < count - 1) {
                await sendToBridge('_sleep', { ms: interval * 16 }, 10000).catch(() => undefined);
              }
            }
            capturedFramesDir = run.dir;
            result.frame_sequence = { run_id: run.runId, dir: run.dir, count };
          } catch (err) {
            result.frame_sequence = { error: err instanceof Error ? err.message : String(err) };
          }
        }
```

然后修改 `frame_degradation` 分支：若断言未提供 `frames_dir` 但 `capturedFramesDir` 存在，自动用它。把 Step 3 里 `const framesDir = fd.frames_dir as string | undefined;` 下一行的校验改为：

```typescript
              const framesDir = (fd.frames_dir as string | undefined) ?? capturedFramesDir;
              if (!framesDir) {
                assertionResults.push({ description: fd.description, passed: false, error: 'frame_degradation requires frames_dir or acceptance.frame_sequence to capture frames first' });
                continue;
              }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run test/tools/workflow-frame-degradation.test.ts`
Expected: PASS

Run: `npx vitest run test/tools/workflow*.test.ts`
Expected: 现有测试无回归

- [ ] **Step 6: 提交**

```bash
git add src/tools/workflow.ts test/tools/workflow-frame-degradation.test.ts
git commit -m "feat(workflow): frame_sequence 帧捕获 + frame_degradation 断言（移植 Godogen 帧退化检测）"
```

---

## Task 7: verify_delivery visual_proof 维度（delivery.ts）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\tools\delivery.ts`（verify_delivery report 新增 visual_proof 维度）
- Test: `D:\GitHub\godot-mcp-enhanced\test\tools\delivery-visual-proof.test.ts`（新建）

**Interfaces:**
- Consumes: `parseAsserts`（Task 2）—— verify_delivery 已有 `assertions` 维度执行自定义 GDScript，这里增强为**同时解析 stdout 里的 ASSERT 协议**并聚合到 `visual_proof` 维度。
- Produces: verify_delivery 的 report 新增 `visual_proof: { passed: boolean, assert_summary: AssertSummary, issues: string[] }`。`report.passed` 聚合时纳入此维度。

**设计决策**：默认仍是软报告（passed=false 不改 isError，保持向后兼容）。visual_proof 失败只影响 `report.passed`，不阻断（硬门可选，见自审）。

- [ ] **Step 1: 写失败测试**

创建 `test/tools/delivery-visual-proof.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { parseAsserts } from '../../src/tools/frame-verify/assert-protocol.js';

// visual_proof 维度的核心是 ASSERT 协议聚合 —— 直接测 parseAsserts 的聚合语义
describe('verify_delivery visual_proof ASSERT 聚合', () => {
  it('clean stdout with PASS → assert_summary.passed true → visual_proof passed', () => {
    const s = parseAsserts('ASSERT PASS: player moving\nASSERT PASS: hp ok\n');
    expect(s.passed).toBe(true);
  });

  it('any ASSERT FAIL → visual_proof not passed', () => {
    const s = parseAsserts('ASSERT PASS: a\nASSERT FAIL: b\n');
    expect(s.passed).toBe(false);
    expect(s.fails).toContain('b');
  });

  it('no ASSERT evidence → not passed (no proof)', () => {
    const s = parseAsserts('random log lines\n');
    expect(s.passed).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败/确认**

Run: `npx vitest run test/tools/delivery-visual-proof.test.ts`
Expected: parseAsserts（Task 2）已实现，应 PASS。此测试锁定 visual_proof 维度**消费 parseAsserts 的契约**。继续 Step 3 做集成。

- [ ] **Step 3: 定位 delivery.ts 的 report 聚合处**

Run: `grep -n "dimensions\|report.passed\|assertions" src/tools/delivery.ts | head -20`

在 delivery.ts 中找到 verify_delivery 构建最终 report 的位置（约 `delivery.ts:421-520` 的 dimensions 聚合 + `report.passed = ...` 赋值处）。阅读该段确认 `assertions` 维度如何收集 GDScript 断言的 stdout（本任务在此基础上叠加 ASSERT 协议解析）。

- [ ] **Step 4: 在 delivery.ts 顶部 import，并新增 visual_proof 维度**

在 delivery.ts import 区加入：

```typescript
import { parseAsserts } from './frame-verify/assert-protocol.js';
```

在 verify_delivery 的 dimensions 收集段（紧接现有 `assertions` 维度处理之后），新增 visual_proof 维度。具体位置以 Step 3 grep 结果为准，插入如下逻辑（假设 assertions 维度已收集了各断言执行的 stdout 到 `assertStdouts: string[]`）：

```typescript
      // ── visual_proof 维度：聚合 ASSERT 协议（Godogen test-harness.md 范式）──
      const allAssertStdout = assertStdouts.join('\n');   // assertStdouts 来自现有 assertions 维度收集的 stdout
      const assertSummary = parseAsserts(allAssertStdout);
      const visualProofIssues: string[] = [];
      if (!assertSummary.passed) {
        if (assertSummary.passCount === 0 && assertSummary.failCount === 0) {
          visualProofIssues.push('no ASSERT PASS/FAIL evidence found in runtime stdout');
        }
        for (const f of assertSummary.fails) {
          visualProofIssues.push(`ASSERT FAIL: ${f}`);
        }
      }
      dimensions.visual_proof = {
        passed: assertSummary.passed,
        assert_summary: assertSummary,
        issues: visualProofIssues,
      };
```

并把 `report.passed` 的聚合表达式纳入 `dimensions.visual_proof.passed`（找到现有 `report.passed = dimensions.scene_tree.passed && dimensions.script_health.passed && ...` 那行，追加 `&& dimensions.visual_proof.passed`）。

> **注**：`assertStdouts` 的具体来源取决于 delivery.ts 现有 assertions 维度的实现。若现有实现未暴露各断言的原始 stdout，则需在 assertions 维度收集处同步保存 stdout 到 `assertStdouts` 数组。执行此 Step 时先读 delivery.ts assertions 维度实现，确认 stdout 可得；若不可得，最小改动是在 assertions 维度执行断言时把 stdout push 到一个局部 `assertStdouts: string[]`。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run test/tools/delivery-visual-proof.test.ts`
Expected: PASS

Run: `npx vitest run test/tools/delivery*.test.ts`
Expected: 现有 delivery 测试无回归

- [ ] **Step 6: 提交**

```bash
git add src/tools/delivery.ts test/tools/delivery-visual-proof.test.ts
git commit -m "feat(delivery): verify_delivery 新增 visual_proof 维度（ASSERT 协议聚合）"
```

---

## 依赖关系

```
Task 1 (degradation)   ─┐
Task 2 (assert-protocol)─┼─→ Task 5 (screenshot_diff) ──┐
Task 3 (proof-bundle)   ─┤   Task 6 (frame_degradation)─┼→ 完整闭环
Task 4 (gdscripts)      ─┘   Task 7 (visual_proof)     ─┘
```

- Task 1-4 是**算法层**，互相独立，可并行。
- Task 5 依赖 Task 4。
- Task 6 依赖 Task 1 + 3 + 4。
- Task 7 依赖 Task 2。
- Task 5/6/7 是**集成层**，各自挂在不同挂载点（workflow.ts 两个断言分支 + delivery.ts 一维度），可并行。

---

## 使用示例（实现后）

```json
// dev_loop：验证玩家移动行为（帧退化 + ASSERT 双轨）
{
  "code": "...",            // 启动游戏逻辑
  "acceptance": {
    "frame_sequence": { "count": 12, "interval_frames": 10 },
    "assertions": [
      {
        "type": "frame_degradation",
        "description": "玩家必须持续移动，不能卡死或帧全等"
      },
      {
        "type": "gdscript",
        "description": "速度断言",
        "gdscript": "if player.velocity.length() > 5.0:\n  _mcp_output('assert_result','moving')\n  print('ASSERT PASS: player moving')\nelse:\n  print('ASSERT FAIL: player static, vel='+str(player.velocity.length()))",
        "expect": "moving"
      },
      {
        "type": "screenshot_diff",
        "description": "画面整体接近目标 reference",
        "reference_path": "res://reference.png",
        "sim_threshold": 0.85
      }
    ]
  }
}
```

---

## 自检清单

- [x] **Spec coverage:** Godogen frame-grounded 闭环的核心要素全部有对应任务：
  - 帧退化检测（5 判据）→ Task 1 + 4 + 6
  - ASSERT 文本协议 → Task 2 + 7
  - reference 视觉锚对比 → Task 4 + 5
  - proof bundle 归档 → Task 3 + 6
  - stop 门禁（visual_proof）→ Task 7
  - screenshot_diff 假实现修复 → Task 5
- [x] **Placeholder scan:** 无 TBD/TODO。Task 7 Step 3/4 的 `assertStdouts` 来源标注了"先读 delivery.ts 确认"的具体处理（非占位，是真实的代码探查指令）。
- [x] **Type consistency:** `FrameMetrics`（Task 1 定义）在 Task 6 引用一致；`referenceSimScript`/`extractFrameMetricsScript`（Task 4 定义）在 Task 5/6 引用一致；`ProofRun`（Task 3）在 Task 6 引用一致；`parseAsserts`/`AssertSummary`（Task 2）在 Task 7 引用一致。阈值常量 `DEGRADATION_THRESHOLDS`（Task 1）与可移植算法来源表数值一致。
- [x] **File paths:** 所有路径均为 `D:\GitHub\godot-mcp-enhanced\` 下绝对路径。
- [x] **Test coverage:** 每个任务都有对应测试文件和用例。

---

## 已知限制与后续（不在本计划范围）

1. **reference 对比是粗筛**：余弦相似度（32×32 embedding）只能判断"整体观感"，像素级精确回归（如 UI 错位 1px）需后续加 pixelmatch（若引入 npm 依赖）。
2. **硬门可选**：本计划 visual_proof 默认软报告（影响 report.passed 不阻断）。若需真硬门（isError），在 Task 7 后追加：verify_delivery 加 `strict` 参数，true 时 visual_proof 失败返回 isError。
3. **frame_sequence 用 _sleep 间隔**：依赖 Bridge 的 `_sleep` 方法（recording 回放已用）。若 Bridge 无 `_sleep`，改用轮询 `wait_for_property` 或 TS 侧 `await new Promise(setTimeout)`。
4. **Godogen 完整 proof bundle（video.mp4 + ffprobe 校验）未实现**：godot-mcp 当前无录视频能力（Godot `--write-movie` 未接入）。帧序列 PNG + metrics.json 已足够支撑退化检测闭环；视频合成是后续独立工作。
5. **executeGdscript outputs 数组值假设**：Task 4 的 GDScript 把数组 `JSON.stringify` 成字符串传输，TS 侧 `JSON.parse` 还原。若 executeGdscript 的 outputs 解析对字符串值有转义问题，需在 gdscript-executor.ts 验证（执行 Task 6 时顺带测）。
