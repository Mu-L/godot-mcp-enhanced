# 第三方审查:CI Linux 平台债修复(fixture 时序 / png gitignore / XAUTHORITY)

- **日期**:2026-08-15
- **审查对象**:分支 `fix/ci-linux-platform` commit `ecb275b3`(主修复)+ `b0dcda04`(nits 修复)
- **审查者**:code-reviewer 子 agent(独立上下文,不预设修复作者声明为真,逐条 grep/read 实测)
- **背景**:CI run#122(master `551328d`,v0.29.0)三 job 全红——check job 4 文件 23 用例、godot-matrix 4.7.1/4.6.3 两 job E2E 步骤,本地 Windows 全绿,历史 12 run 中 7 失败(58%)。

## 根因(三独立链,均经代码级+本机实验双重证实)

1. **check job 23 用例超时**:ci.yml 的 `Run vitest`(:98)跑在 `Check gdscript`(:105)之前,而 gdscript-check fixture 的 `src/scripts/`+`addons/` 是被 .gitignore(:43/:45)的运行时拷贝产物 → CI checkout 后 fixture 空壳 → GDScript 测试 `load()` 得 null → SCRIPT ERROR → `extends SceneTree` 脚本 `_init` 中断、`quit()` 不执行 → Godot headless 无限挂 → vitest 10s 超时。**本地 Windows 绿是环境假绿**(开发机留有旧拷贝残留;本机残留旧到缺 `_ErrorCapture` 类,恰好成为天然复现器)。
2. **screenshot analyze 3 用例**:依赖被 `.gitignore:40`(`test/fixtures/**/*.png`)忽略的 E2E 运行产物 `e2e-project/screenshot.png`,CI 缺文件。
3. **matrix job L2 2 用例 + get-node-layout 整 suite 静默 skip**:`buildSafeEnv()` 白名单缺 `XAUTHORITY` → xvfb-run 下 spawn 的 Godot 游戏无法认证 X11 连接秒退(本机对照实验:unset `XAUTHORITY` exit=1 秒退,保留则存活)→ `run_project` 报 `Bridge not ready (process exited during probe)`。

## 修复设计

- 抽 `syncCheckProjectFixture()` 导出函数(源 `src/scoring/check-gdscript.ts`)+ vitest `globalSetup`(`test/global-setup.ts`)在所有测试 worker 前填充——本地/CI 任意 vitest 入口统一就绪,**ci.yml 零改动**。
- screenshot 测试 pngjs 自生成 64×64 渐变 PNG,零磁盘 fixture 依赖。
- `buildSafeEnv()` 白名单补 `XAUTHORITY`(与既有 `DISPLAY` 配对的 X11 凭证文件路径)+ `helpers.test.js` 透传断言。

## 审查结论:SHIPPED WITH NITS

- 无 Blocking Issue。
- 三条根因链全部代码级证实(含 ci.yml 步骤顺序、gitignore 规则命中、spawn 环境链路 `runtime.ts:170-172` → `game-bridge.ts` 探测文案)。
- 安全维度:XAUTHORITY 是文件路径且 `HOME` 本就透传,攻击面无实质扩大;凭据 strip 逻辑与既有安全测试未触碰。
- 仓库级约束独立核查通过:未改 `.claude/rules/`(无同步义务)、未改工具清单(无 build-matrix 义务)、未改 `.gd`(无额外 build 义务)、build 产物已同步(`build/scoring/check-gdscript.js` 含新函数)。

## Nits 处置

| Nit | 内容 | 处置 |
|-----|------|------|
| NIT-1 | `XAUTHORITY ?? ''` 空串透传在 startx 类会话(依赖 `~/.Xauthority` 默认回退)理论上破坏回退 | 不修:与既有 `DISPLAY ?? ''` 白名单惯例一致;CI xvfb-run 必设值、Windows 不读该变量,风险场景在本项目不存在 |
| NIT-2 | globalSetup 无空守卫,0 文件静默通过 → 回到难诊断超时 | **已修**(commit `b0dcda04`):空守卫 fail fast |
| NIT-3 | watch 模式 rerun 不重跑 globalSetup,fixture 可能 stale | 不修:原行为同样需手动跑 `check:gdscript`,无回归 |
| NIT-4 | `syncCheckProjectFixture` 返回值 `srcFiles` 实为 addons 侧列表,命名歧义 | **已修**(commit `b0dcda04`):更名 `addonFiles` |

## 验证(本机 Linux,GODOT_PATH=4.7.stable)

- 删空 fixture 模拟 CI → 4 文件 26 用例全绿(globalSetup 输出 `addons=34, scripts=6`)
- `e2e-full-tool-verification` 单跑:79 过 2 skip **0 挂**(修复前 2 failed)
- matrix 7 文件组合(原样 ci.yml 命令 + xvfb):116 过 2 skip **0 挂**(修复前 2 failed + 6 skip)
- `npm run lint` 0 错 / `npm run build` 0 错 / 全量 vitest(CI 口径)5273 过 34 skip 0 挂 / `check:gdscript` errors=0 files=40
- 终极验证待 push 后的 GitHub CI run(check+matrix 双绿为合并门禁)

## 工程教训(已登 memory)

- gitignore 的运行时 fixture + CI 步骤时序 = 环境假绿:凡 fixture 靠工具链运行时填充,测试入口(globalSetup)与工具入口必须共用同一同步函数。
- X11 白名单变量成对出现:透传 `DISPLAY` 就必须透传 `XAUTHORITY`,缺失在 xvfb 下表现为"进程秒退"而非明确报错,极易误诊为 bridge 自身 bug。
- Godot `extends SceneTree` 脚本 `_init` 内运行时错误不退出进程(主循环空转),headless 挂死的表现是"零输出+超时",且 stdout 管道全缓冲会吞掉已 print 的内容——诊断时用 `--log-file` 绕过缓冲。
