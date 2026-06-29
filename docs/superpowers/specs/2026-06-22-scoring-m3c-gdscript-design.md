# M3c: Scoring gdscript 维度(Godot 编译检查)

- **里程碑**: scoring M3c
- **前置**: M3b 报告+门禁已完成(`coverage/score.json` + `score:gate` + `DIM_ORDER` 已含 gdscript + `dimensions.ts` gdscript 权重 0.10);M3b-PR PR comment 已完成
- **范围**: gdscript 维度从 na 变真实值——用 Godot 4.6.3 项目级 `--import` 检查 addon 编译,errors 归零硬否决,warnings 渐进扣分
- **范围决策**: 方案 A(Godot 项目级编译检查),否决 B(gdtoolkit gdparse)/ C(纯 TS 扫描)

## 背景

gdscript 维度现状 `generate-score.ts:39` `na('gdscript')` 占位。addon(`addons/godot_mcp_server/`,19 个 .gd)的真实痛点:4.7 下编译失败(`command_helpers.gd` 用 4.6 API `Vector.from_string` 等,4.7 被改)。M3c 用 Godot 4.6.3(目标版本)检查编译,捕捉此类静态问题。

**为什么不用 gdtoolkit / 纯 TS**:addon 痛点是"调用了目标版本不存在的 API"。gdtoolkit `gdparse` 只查语法结构(无 API 数据库),纯 TS 扫描同理。**只有 Godot 自己能查 API 类编译错**——这是方案 A 的决定性优势。

## 方案选择

| 方案 | 数据源 | 查 API 错 | 依赖 | 选 |
|------|--------|-----------|------|-----|
| A Godot `--import` | Godot 4.6.3 项目级编译 | ✅ | check job 装 Godot | ✅ |
| B gdtoolkit `gdparse` | Python gdtoolkit | ❌ 只语法 | Python | ✗ |
| C 纯 TS 扫描 | 自写 | ❌ 无 API 库 | 无 | ✗ |

## 数据流

```
[CI check job]
  ① 装 Godot 4.6.3(复用 ci.yml e2e-godot 安装脚本,check job 内复制——job 隔离不共享环境)
  ② check-gdscript.ts(新增,src/scoring/,TS 享类型):
     - GODOT_PATH 缺失 → incomplete report + process.stderr.write 告警(IMPORTANT-9b 防假绿)
     - 复制 addon → test/fixtures/gdscript-check/addons/(gitignore,每次新拷)
     - runGodotHeadless(['--import']) [共享 helper,复用 forceKillTree]
     - 解析 stderr+stdout(正则)
     - false negative 断言(files + class cache)
     - → coverage/gdscript-report.json
  ③ npm run score: generateScore 加 gdscriptReportPath
     → collectGdscript [纯函数] → 三态(na / incomplete→0 / 曲线)
     → score.json(gdscript 从 na 变真值)
  ④ npm run score:gate: errors≥1 或 incomplete → gdscript score=0 < 60 → HARD_FAILOUT → gate 红
```

## 核心设计

### GdscriptReport interface(`types.ts`,TS 两侧共享锁契约)

```ts
export interface GdscriptReport {
  errors: number;        // 编译错误数
  warnings: number;      // 脚本警告数
  files: number;         // 检查的 .gd 文件数(断言用,= addon 源 .gd 数)
  details: string[];     // 全部问题明细(errors 优先排前),≤20 条
  detailsTotal: number;  // = errors + warnings(独立计数,不受截断影响)
  incomplete?: boolean;  // check-gdscript 断言失败(setup 坏) → collector score=0
  reason?: string;       // incomplete 原因
}
```

### collectGdscript(`src/scoring/collectors/gdscript.ts`,纯函数)

**三态分离(关键:na 不卡 gate,incomplete 卡 gate)**:

```ts
export function collectGdscript(reportPath: string): DimensionResult {
  // ① report 不存在 → na(环境降级:check-gdscript 没跑/Godot 没装,不该卡 PR)
  if (!existsSync(reportPath))
    return { score: NA_SCORE, weight: WEIGHTS.gdscript, status: 'na',
             detail: `报告不存在: ${reportPath}` };
  let report: GdscriptReport;
  try { report = JSON.parse(readFileSync(reportPath, 'utf8')); }
  catch (e) { return { score: NA_SCORE, weight: WEIGHTS.gdscript, status: 'na',
                       detail: `解析失败: ${(e as Error).message}` }; }

  // ② incomplete(check-gdscript 跑了但断言失败) → score=0 → <60 硬否决卡 gate
  //   优先于 errors/warnings:检查不完整则 errors 不可信
  if (report.incomplete)
    return { score: 0, weight: WEIGHTS.gdscript, status: 'fail',
             detail: `检查不完整: ${report.reason ?? 'setup 失败'}`,
             raw: { errors: 0, warnings: 0, files: report.files ?? 0,
                    details: [], detailsTotal: 0 } };

  // ③ 缺 errors/warnings → na(契约异常)
  if (typeof report.errors !== 'number' || typeof report.warnings !== 'number')
    return { score: NA_SCORE, weight: WEIGHTS.gdscript, status: 'na',
             detail: '报告缺 errors/warnings 字段' };

  // ④ 扣分曲线:errors 归零硬否决,warnings 渐进
  const { errors, warnings } = report;
  const score = errors >= 1 ? 0 : Math.max(0, 100 - warnings * WARN_PENALTY);
  // 80/60,与 security/integration 一致;集中抽取待 N+1 collector
  const status: DimensionStatus = score >= 80 ? 'pass' : score >= 60 ? 'warn' : 'fail';
  return { score, weight: WEIGHTS.gdscript, status,
           raw: { errors, warnings, files: report.files ?? 0,
                  details: report.details ?? [], detailsTotal: errors + warnings } };
}
```

**扣分语义**:
- `errors`(编译错)= 布尔硬否决:errors≥1 → score=0(0<60 触发 HARD_FAILOUT)。不用梯度(errors×50):梯度制造虚假精度(50 vs 0 都卡 gate,但 50 让读者误以为"还行");errors 数量在 `raw.errors`/`details` 保留诊断。
- `warnings`(脚本警告)= 渐进:`score = max(0, 100 - warnings × WARN_PENALTY)`。

**`HARD_FAILOUTS.gdscript = 60`**(`dimensions.ts` 加,与 security 对称)。

`WARN_PENALTY` + 容忍上限(几 warning 到 fail)都依赖 Task 0 基线,初始 TBD。基线 0 warning 时系数跳 ×10 量级(1 warning 就该显著扣)。

### 执行层 `check-gdscript.ts`(`src/scoring/`,TS 享类型)

```
① GODOT_PATH 缺失防假绿(IMPORTANT-9b,对齐 e2e-p1-p5.test.ts:24-37):
   GODOT_PATH = process.env.GODOT_PATH || ''(默认空,强制显式)
   !existsSync(GODOT_PATH) → 产出 incomplete report + process.stderr.write 告警
     (非 console.warn — vitest 捕获 console.* 不透传,直接写 stderr 才在 CI 日志可见)
② glob 源 addons/godot_mcp_server/**/*.gd → expected 文件数(当前 19)
③ 复制进 test/fixtures/gdscript-check/addons/(gitignore,每次新拷最新源)
④ runGodotHeadless(['--import','--path',project], godotPath, timeoutMs)
     → {exitCode, stdout, stderr}(共享 helper,exit code 不当成败判据)
⑤ 解析 stdout+stderr(部分 Godot 版本错误走 stdout),正则:
     RE_ERROR = /^(?:SCRIPT ERROR:|.*-\s*(?:Parse|Compile) Error:)/
     RE_WARN  = /^(?:WARNING:|.*-\s*Warning:)/
   匹配不到的行不计数不崩(保留原行到 details 尾供诊断);Godot 核心关键字不翻译,locale 风险低
   ⚠ 正则模式需 Task 0 用真实 Godot 4.6.3 stderr 校验(不凭记忆)
⑥ false negative 断言(setup 坏 → incomplete report,不产出虚假 0/0):
   - files 断言:检查项目 addons/ 实际 .gd 数 === expected,不等 → incomplete
   - class cache 断言:import 后 .godot/global_script_class_cache.cfg 含全部源 class_name
     (动态提取源 class_name 列表,当前仅 CommandHelpers 1 个),缺 → incomplete
   防线②真实价值 = 验"setup 发生"(import 执行+plugin 加载),非"19 个都 parse"。
   "都 parse"靠 stderr 无错(被引用脚本 parse 错进 stderr)+ files 到位。
   盲区:未被任何东西引用的孤立 .gd 不被 parse 也不进 stderr。addon 结构上 commands/*
   都被 plugin.gd 注册引用,M3c 接受"被引用即覆盖"假设。
⑦ 写 coverage/gdscript-report.json
```

**false negative 三重防御**(任一失败 → incomplete → score=0 → 卡 gate,不产出 0/0 误报满分):

| 防线 | 位置 | 失败动作 |
|------|------|----------|
| ① files 断言 | check-gdscript.ts | 检查项目 addons/ .gd 数 ≠ expected → incomplete |
| ② class cache 验证 | check-gdscript.ts | 全部源 class_name 不在 cache → incomplete |
| ③ collector na/incomplete 守卫 | collectGdscript | incomplete→score=0;缺字段→na 兜底 |

外加 **GODOT_PATH 缺失 → incomplete**(防 IMPORTANT-9b 假绿:Godot 根本没跑不能算 0/0 过关)。

### 共享 godot spawn helper

抽 `runGodotHeadless(args, godotPath, timeoutMs): Promise<{exitCode, stdout, stderr}>`(spawn + forceKillTree + 累积 stdio,**不加成败判断**)。`runImport`(`import-check.ts:100-158`)重构用它(套 code===0 判断 resolve),check-gdscript 直接用它(拿 stderr 解析,exitCode 不当成败)。

**约束:禁止 check-gdscript 重写 spawn**——必须复用共享 helper 继承 forceKillTree(防 CI Godot 卡住留僵尸进程挂 job,对齐 import-check.test.ts 的 forceKillTree 超时杀进程树验证)。

helper 放置位置 + runImport 重构幅度 = plan 阶段决策。

### 检查项目

新建 `test/fixtures/gdscript-check/project.godot`(持久),**不复用 e2e-project**(它故意无 addon 避免 autoload 链,改装污染 e2e):

```ini
[editor_plugins]
enabled=PackedStringArray("godot_mcp_server")
config/features=PackedStringArray("4.6")
```

`addons/` 不入 git(`.gitignore` 加 `test/fixtures/gdscript-check/addons/`,运行时复制最新源)。

## 渲染层(`report.ts` 补一行)

`report.ts:16-30` `dimMetric()` switch 加 gdscript case(唯一必改渲染点;`DIM_ORDER:50` 已含 gdscript,表格行自动出现;pr-comment 复用同渲染无需另改):

```ts
case 'gdscript':
  return `${raw.errors ?? 0} err / ${raw.warnings ?? 0} warn`;
```

## CI 接入(`ci.yml` check job)

- check job 与 e2e-godot job 独立(ci.yml:9 vs :63),环境不共享 → check job 内复制 ci.yml:75-83 Godot 4.6.3 安装脚本(curl/unzip/GODOT_PATH)
- 加 step `npm run check:gdscript`(score step 前,`continue-on-error: true`,与 audit/score 一致;失败由 gate step 卡)
- `package.json` 加 `"check:gdscript": "node build/scoring/check-gdscript.js"`
- `timeout-minutes: 10`,Godot 下载 ~80MB + import 19 脚本 ~40-60s,首跑盯

## 测试策略

### collectGdscript 单测(`test/scoring/gdscript.test.ts`,对称 `security.test.ts` inline 模式)

inline `JSON.stringify` 造数据(`writeReport` helper + `__tmp_gdscript__/`,beforeEach mkdir / afterEach rmSync),**不引入 fixture 文件**(现有 scoring 测试约定):
- 三态:na(不存在/坏 JSON/缺字段)/ incomplete→score=0+fail / 正常曲线
- 曲线:errors 归零(1错→0)/ warnings 边界(20→60 warn,21→58 fail 硬否决)/ status 80/60 线
- **incomplete 优先**:`incomplete:true + errors:3` → score=0 不走曲线(锁优先级)
- raw 回填:`detailsTotal === errors+warnings`(非 details.length)/ details 截断≤20 / errors 优先排前

**契约锁 = TS interface**(check-gdscript.ts 共享 import,编译期抓字段漂移)+ **check-gdscript 集成测试**(真实 Godot 产出,运行时验证格式),不靠 fixture 文件。

### check-gdscript.ts 测试

- **GODOT_PATH 缺失 → incomplete report + stderr 告警**(纯逻辑测,不 spawn,对齐 IMPORTANT-9b)
- stderr 正则:`SCRIPT ERROR` / `Parse Error` / `Warning` 命中 + 未知行容错 + stdout+stderr 合并
- false negative:files 不足 / class cache 缺 → incomplete
- 真实 Godot 集成(复用 `runGodotHeadless`,hasGodot-gated):验证 spawn + forceKillTree 无僵尸进程(对齐 import-check.test.ts 的 forceKillTree 验证模式) + **stderr 贴版本断言**:故意写一个语法错的 .gd → 真跑 `--import` → 采集真实 stderr → 断言 `RE_ERROR` 命中(锁正则贴当前 4.6.3,防 Godot 版本升级后真实 stderr 格式漂移→正则失配→漏计 errors,而手写单测字符串不变仍绿 = IMPORTANT-9b 同构假绿)

## Task 0 基线(反推 WARN_PENALTY)

真实 Godot 4.6.3 跑 addon → 量 warnings 实际数 → 按产品问题"容忍多少 warning 才卡"反推:
- 系数 = (100 - 阈值60) / 容忍 warning 数
- 基线 0 warning → 系数 ×10 量级(1 warning 显著扣)+ 定"几 warning 到 fail"上限
- `WARN_PENALTY` + 容忍上限都 TBD,Task 0 定,数据回填本节

## 非目标(不在 M3c)

- ❌ 运行时缺陷捕获:`--headless --import` 只 parse + 注册 class + 导入资源,**不执行函数体**(_ready/_process/运行时调用)。headless 下 root=null 静默崩溃类缺陷(`_mcp_get_root()` 可返回 null,项目 `test/navigation-tools.test.js:184` / `test/workflow.test.js:14` 有回归守卫)属运行时,M3c 抓不到——M3c 只查编译/import 时错,运行时缺陷由测试套件守卫,不在评分维度范围
- ❌ `load()` 显式探针堵孤立脚本(盲区接受"被引用即覆盖"假设,留 M3b-HTML / 独立增强)
- ❌ status 分级线集中抽取 `gradeStatus`(coverage 60/40 vs integration/security 80/60 现状有意不一致,参数化抽取是独立重构,M3c 复制 80/60)
- ❌ M3b-HTML HTML dashboard / M3d performance / M3e flaky 维度接入

## 后续里程碑

- **M3b-HTML**:HTML dashboard(趋势图需历史 score 快照基建)
- **M3d**:performance 维度接入
- **M3e**:flaky 维度接入(完成后 partial 不再卡,6/6 维全验证)
