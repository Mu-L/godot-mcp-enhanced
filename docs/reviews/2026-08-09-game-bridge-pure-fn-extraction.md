# 第三方审查:game-bridge 校验函数纯函数化 + 测试迁移

| 项 | 值 |
|----|-----|
| 审查日期 | 2026-08-09 |
| 审查对象 | `fix/ci-platform-exclusion-pure-fn` 分支未提交工作树改动(3 文件) |
| 审查者 | code-reviewer 子 agent(agent_96adfe23,隔离视角) |
| 总体判定 | **SHIPPED WITH NITS**(0 Blocking / 2 Nits) |

## 改动概览

| 文件 | 状态 | 行数 | 说明 |
|------|------|------|------|
| `src/tools/game-bridge.ts` | modified | +32/-5 | 3 个校验函数 export 化(`clampTimeoutMs` / `validateBridgePath` / `validateWaitPropertyParams`) |
| `test/game-bridge.test.ts` | modified | -136/+5 | 删除 T-1/I-1/I-2 socket 依赖测试块,头部注释更新 |
| `test/game-bridge-validation.test.ts` | untracked | +164 | 新增纯函数测试文件(29 个 it),零 `vi.mock`,Linux CI 可跑 |

**意图**:原 `game-bridge.test.ts` 因 vitest 4.1.x Linux 的 `vi.mock('net')` 跨文件隔离失效(issue #15),被 `ci.yml:75` `--exclude` 出 Linux CI,导致校验逻辑在 Linux 零覆盖。本次把校验函数抽成 export 纯函数 + 迁移测试到零 mock 文件,恢复 Linux CI 覆盖。

## 逐维度结论(实测证据)

### 维度 1:源码正确性 — ✅ 通过

三个函数纯函数化**语义零漂移**:

- **`clampTimeoutMs`**(`src/tools/game-bridge.ts:46-51`):仅加 `export`,函数体 5 行逻辑零改动。形态与 `shared/validation.ts:5-9` 的 `validateTimeout` 对齐(作者注释 :45 声称属实)。`def` 默认 10000ms 与 `validateTimeout` 默认 30s 不同(业务域不同),合理。
- **`validateBridgePath`**(`src/tools/game-bridge.ts:603-613`):仅加 `export`,遍历 `['path','node_path']` + `/root/` 前缀检查 + 错误消息文本逐字保留。
- **`validateWaitPropertyParams`**(`src/tools/game-bridge.ts:618-628`):**新抽函数**,与原 handleTool 内联逻辑语义等价:
  - `method === 'wait_for_property'` 守卫保留
  - property 非空字符串校验保留,错误消息 `'wait_for_property requires a non-empty "property" string in params'` 逐字
  - value 校验条件是 `=== undefined`(**不是 falsy**),错误消息 `'wait_for_property requires a "value" in params'` 逐字
  - 调用处(:825-826)`opsErrorResult('INVALID_PARAMS', waitParamErr)` 与原内联返回路径 code 一致
- **无副作用/闭包/this 问题**:三个函数都不引用模块级可变状态(`_socket`/`_cachedSecret`),入参纯。

### 维度 2:测试质量 — ✅ 通过

- **迁移完整性**:新文件含 29 个 it。核心迁移 T-1(4)+ I-1(5)+ I-2(3)= **12 个**(作者口头"11"是约数,见 Nit #1)。
- **断言强度**:全用 `.toContain('/root/')` / `.toContain('property')` / `.toBeNull()` / `.toBe(精确值)`,无 `toBeTruthy()` 弱断言。
- **clampTimeoutMs 边界覆盖**(`game-bridge-validation.test.ts:124-163`):9 个 it 覆盖 `undefined/null/NaN/Infinity/超上限/超下限/合法值/字符串数字/自定义 min-max-def`,完整覆盖纯函数所有分支。
- **`value=null` 测试(:117-121)**:锁定既有边界基线,注释诚实标注"本次不改语义,仅锁定基线"——是正确的 characterization test 模式,非固化 bug。
- **零 mock 反模式**:新文件仅 `import { describe, it, expect } from 'vitest'`,无 `vi.mock`/`vi.hoisted`/`queueMicrotask`。

### 维度 3:测试拆分完整性 — ✅ 通过

- **删除完整性**:原 T-1/I-1/I-2 三个 describe 块已整体删除,替换为 3 行迁移说明注释(`game-bridge.test.ts:372-374`)。
- **保留测试合理性**:原文件剩 24 个 it,全部需 socket/auth/error-path mock(T-2 / 739 catch / NOT_CONNECTED / N-1 / P3-6 / P1-8 / A4 / isBridgeReady / P1-3),**全部无法迁移到纯函数文件**。
- **头部注释更新**(`game-bridge.test.ts:1-19`):已更新为"socket 相关测试",标注 T-1/I-1/I-2 迁移去向,无"共 23 个"过时硬编码计数残留。

### 维度 4:CI 配置一致性 — ✅ 通过

- `ci.yml:75` `--exclude test/game-bridge.test.ts` 是**精确单数路径**(无通配符),`game-bridge-validation.test.ts` 不匹配,会被正常纳入 Linux CI。
- `vitest.config.ts:13` coverage exclude 含 `src/tools/game-bridge.ts`——本次抽 export 后该文件仍在 coverage exclude 名单。**合理**:整个文件因 socket 测试 Linux 跑不了而退本地覆盖率,抽出几个纯函数不改变这一事实(纯函数已被新测试覆盖,恢复的是**测试覆盖**而非 coverage 数字)。

### 维度 5:仓库级约束 — ✅ 通过

未触碰任何独立副本/生成产物/禁编辑类别:

- **`.claude/rules/` 独立副本**:grep `validateBridgePath|validateWaitPropertyParams|clampTimeoutMs` 在 9 个规则文件 0 命中,无需同步。
- **`rule-templates.ts` 分发模板**:0 命中。
- **capability-matrix 生成产物**:grep 仅命中 `game_bridge_install` 工具名描述,与本次改动无关。本次只给已有函数加 export,不改变 inputSchema/securityLevel/risk/工具清单,不触发 drift。
- **`build/` 生成产物**:`build/tools/game-bridge.js` + `.d.ts` 已含新 export,证明作者已跑 `npm run build` 同步,产物与源无漂移。

## Blocking Issues

**无。**

## Nits(不阻塞合并)

### Nit #1:计数口径不一致(非问题,仅记录)

作者口头与 plan 文档称"11 个迁移测试",但实际拆解 T-1(4)+ I-1(5)+ I-2(3)= **12 个**核心迁移。建议未来 plan 文档统一用精确计数,避免口头"11"与文档拆解"12"的歧义。

### Nit #2:ci.yml:73 历史快照注释轻微过时(既有状态,非本次引入)

`ci.yml:73` 注释写"Windows game-bridge.test.ts 23/23 过"——删 11 个测试后实际剩 24 个 it。但:
- (a) 该注释不在本次改动范围(作者明确声明"不改 ci.yml")
- (b) "23/23"语义指"全过基线"非精确 it 计数
- (c) 修正需改 ci.yml 注释,超出本次 scope

建议作为后续独立 nit 处理。

## 值得进 memory 的工程教训

### 教训 1:vitest mock 平台 bug 的"窄抑制 + 纯函数抽离"双层缓解模式

当 `vi.mock('net')` 因 vitest 4.1.x Linux 平台 bug(issue #15)导致整个测试文件被迫 `--exclude` 出 CI 时,正确做法不是放弃覆盖,而是把**可纯函数化的校验逻辑**从 socket-依赖的 handleTool 内联中抽出来 export,迁移到零 mock 的独立测试文件。这样既保留了 socket 测试(Windows 本地跑),又恢复了纯逻辑的 Linux CI 覆盖。

可复用场景:任何"测试因 mock 平台 bug 被 CI 排除"的情况,先识别其中的纯函数子集,抽 export 迁移。

### 教训 2:characterization test 应明确标注"锁定既有边界"而非"固化 bug"

`game-bridge-validation.test.ts:117-121` 的 `value: null → null 通过` 测试,注释诚实写明"仅 value===undefined 才拒,null 被接受"是既有逻辑边界,"本次不改语义,仅锁定基线"。这是正确的 characterization 模式(锁边界防回归),与"把 bug 固化成 green test"有本质区别。

审查此类测试时应区分:有诚实标注 + 语义合理的 = 锁基线(OK);无标注 + 语义可疑的 = 固化 bug(需拒)。

## 审查纪律声明

本审查所有"声称核实"项均经 grep/read 实测:3 个 export 函数体逐字比对(含 `build/` 编译产物交叉验证)、29 个新 it 逐个计数、24 个保留 it 逐个确认需 socket mock、ci.yml exclude 精确串核对、capability-matrix/rule-templates 0 命中确认、INVALID_PARAMS code 调用处核对。作者声明与实测无矛盾。
