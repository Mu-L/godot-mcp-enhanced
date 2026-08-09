# 第三方审查:C-测试缺口批次

**审查日期**:2026-08-09
**审查对象**:`feat/sec-batch-p2-1-p2-2` 分支(原 commit `bad236d` 含 BLOCKING 已撤回,修正后 `3a33c5f`)
**审查者**:code-reviewer 子 agent(隔离视角,所有声明 grep/read 实测复核)

## 总体判定历程:BLOCKING → 撤回 P2-5 → SHIPPED WITH NITS

初判 **BLOCKING ISSUES**(P2-5 接 weekly CI 必失败),撤回 P2-5 后重审 **SHIPPED WITH NITS**(0 Blocking + 2 Nit,N-2 已当场修复)。

## Blocking Issue(已通过撤回 P2-5 解决)

### B-1: P2-5 e2e-asset-tools 接 weekly CI 必失败(已撤回)
- **问题**:`e2e-asset-tools.test.ts:18/20-21` 设计是**手工启动 editor 模式**,beforeAll :102 `readEditorSecret` 找不到 secret 就 throw。weekly workflow 每个 vitest step 独立进程不共享 editor daemon,直接接必失败 → 每周触发 Create issue 堆积噪声
- **对比**:e2e-resilience-editor.test.ts:113 + e2e-testing-undo-manager.test.ts:58 都自 spawn editor,故能接 weekly CI
- **处理**:**撤回 editor-e2e.yml 改动**(grep 确认零命中),P2-5 回退 open 并加 DEFERRED 注明"需先重写 harness 自 spawn"。commit `bad236d` reset,重 commit `3a33c5f` 只含 P2-6
- **教训**:接 CI 前必读测试 harness 设计(grep `spawn.*--editor` 判定自启动 vs 手工启动)。这是我探索偷工的实例——只看 yaml 语法没读测试文件设计

## Nits

### N-1: P1-2 回标描述偏差(非阻断)
`ci.yml:79 --exclude` 是为 issue #15 Linux 平台 vi.mock 失败排除,非为 contract test 抽离。但 P1-2 声明"contract test 已抽"事实成立(8 文件 Glob 实测)。建议补直接证据:8 文件清单本身。

### N-2: P2-6 it#2 invariant 注释(已当场修复)
在"无跨调用缓存"测试加核查点注释:editor-auth.ts 若引入模块级 secret 缓存(如 `let _cachedSecret`),本测试第二次读 A 而非 B 会红。明确这个测试守护的不变量。

### N-3: P2-6 it#3/it#4 防假绿核查(通过)
- it#3 setTimeout 300ms 创建文件(>200ms interval),耗时 ≥300ms,非秒过
- it#4 setTimeout 500ms 写真内容,空文件 trim 返 null 继续轮询,耗时 ≥500ms
- 两测试异步触发非预存在,非假绿

## 5 项回标核实结论

| 项 | 声明 | 核实结果 |
|---|---|---|
| P2-4 | e2e-bridge 接 godot-matrix CI | ✅ ci.yml:179 命中 |
| P1-2 | contract test 已抽 8 个 | ✅ Glob 8 文件(描述偏差见 N-1) |
| P1-A | weekly SIGKILL + 分层设计 | ✅ e2e-resilience-editor:139/184 SIGKILL + editor-connection 仅 WS |
| P2-5 | 接 weekly CI | ❌ BLOCKING → **已撤回,DEFERRED** |
| P2-6 | characterization 4 测试 | ✅ 4 it 真实(见 N-3 防假绿核查) |

## 验证(修正后)

| 命令 | 结果 |
|------|------|
| lint | 0 error |
| test editor-auth | 16 passed(+4 P2-6) |
| open 计数 | 23 → 19(P2-5 回退 open;P2-4/P1-2/P1-A/P2-6 回标 4 项) |

## memory 教训(已登记)
- `engineering-lesson-weekly-editor-e2e-step-must-self-spawn`:weekly editor e2e step 必须自 spawn editor,接 CI 前 grep `spawn.*--editor` 判定测试 harness 模式

## 关联
- C-安全批次:`docs/reviews/2026-08-09-sec-batch-p2-1-p2-2.md`
- C-可靠性批次:`docs/reviews/2026-08-09-reliability-batch.md`
- memory:`feature-decision-2026-08-09-test-gap-batch` + `engineering-lesson-characterization-test-when-scenario-vague` + `engineering-lesson-weekly-editor-e2e-step-must-self-spawn`
