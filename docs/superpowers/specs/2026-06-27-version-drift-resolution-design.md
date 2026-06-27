# 版本漂移根治设计 (version-sync)

**日期**: 2026-06-27
**分支**: master
**状态**: 已批准(R1 工程审查反馈已并入)→ 待写实施计划 (writing-plans)
**来源**: superpowers:brainstorming 会话 + superpowers:plan-eng-review R1 审查

## 修订记录

- **v1**(初版):brainstorming 产出
- **v1.1**(R1 审查响应,本次):修 1 CRITICAL + 4 IMPORTANT + 3 ADVISORY。审查 artifact:`D:\workspace\review\.claude\reviews\2026-06-27-godot-mcp-enhanced-version-sync-spec-eng-review.md`
  - C1(阻塞):CHANGELOG 锚点被 `[Unreleased]` 劫持 → 锚点改"首个带日期段"
  - I1:使用指南锚点不接受 prerelease 后缀(与 §3 全串承诺矛盾)→ 字符类改接受后缀
  - I2:**push back 事实前提**(工作区实测纯 LF,非审查者所称 CRLF),但接受机制建议(正则排除 `\r` + manifest 改最小正则替换)作为防御性改进
  - I3:CI 门禁措辞与"直推 master"矛盾 → 目标 3 改"事后兜底"
  - I4:发版流程漏 `npm publish` → 补 publish 节点与时序
  - A1/A4/A5:顺手纳入

## 背景与问题

版本号当前散落在 6 个文件(不含 `package-lock.json`——`npm install` 自动同步 version 到 lock,且 `package.json` 的 `files` 字段不打包 lock;亦不含历史 spec/plan 文档):

| 文件 | 行 | 当前值 | 语义 |
|------|-----|--------|------|
| `package.json` | 3 | `"version": "0.19.1"` | 真相源候选 |
| `manifest.json` | 5 | `"version": "0.19.1"` | 当前版本 |
| `addons/godot_mcp_server/plugin.cfg` | 6 | `version="0.19.1"` | 当前版本 |
| `docs/使用指南.md` | 5 | `> **版本**：0.19.1` | 当前版本 |
| `CHANGELOG.md` | 7=Unreleased / 9=0.19.1 | `## [0.19.1] - 2026-06-27` | 版本历史(追加;`:7` 有 `[Unreleased]` 段,锚点须跳过) |
| `README.md` | 623 | `\| **v0.19.1** \| 2026-06-27 \| ...` | 版本表(追加) |

每次发版手动同步,易漂移。

**v0.19.0 发版事故**:npm 包元数据基于 tag `2a48d06`,但 `manifest.json`/`plugin.cfg` 仍停在 `0.18.2`,导致 npm v0.19.0 元数据漂移,不得不发 v0.19.1 补救(commit `3145b60`)。`CHANGELOG.md` v0.19.1 条目明确记录了此事。

### memory 纠正

memory 曾记"根治 esbuild define 未实施"。**实测此方向不成立**(R1 审查独立确认):
- 项目构建用 `tsc`(非 esbuild),`package.json:30` 的 `"build": "tsc && node -e ..."`
- TS 源码无运行时版本号需求(`src/helpers.ts` 的 `0.19` 是 `@deprecated since v0.19.0` 注释文字,非版本常量)
- 版本号纯粹是"发布元数据",根治方向应是"单一来源 + 同步脚本 + CI 门禁",而非编译期注入

## 目标

1. `package.json` 的 `version` 成为唯一真相源
2. 发版时一条命令同步 A 类元数据,消除手动 4 处手改负担
3. CI **事后兜底**检测版本一致性(push 后跑),漏同步时 CI 红阻塞后续 —— 项目发版直推 master,CI 为事后兜底而非事前 PR 门禁;若需事前本地拦截,可另加 git pre-commit hook(本设计不纳入,YAGNI)
4. 不绑 `build`(避免本地 build 误改 `manifest.json`/`plugin.cfg` 源文件)

## 非目标 (YAGNI)

- **不**自动生成 `CHANGELOG.md`/`README.md` 版本表的描述文本(变更描述是人写创作,空壳骨架价值低且易"生成空壳忘填就发版")
- **不**处理 prerelease 后缀的**特殊语义**逻辑(当前项目无 prerelease;脚本对 `0.20.0-rc.1` 这类全串透传写/比对 —— 但**锚点字符类须接受后缀**,见 §2;否则与"全串透传"承诺矛盾)
- **不**碰 TS 运行时版本号(无此需求;若将来需要,`tsconfig.json:13` 已开 `resolveJsonModule`,可直接 `import pkg from '../package.json'`)

## 文件分类

| 类 | 文件 | 语义 | 处理方式 |
|----|------|------|----------|
| **A** | `manifest.json`、`plugin.cfg`、`docs/使用指南.md` | 当前版本(单值) | `version-sync` 写入 + CI `--check` 校验 |
| **B** | `CHANGELOG.md`、`README.md`(版本表) | 版本历史(每发版追加一段) | CI `--check` 校验首条版本号,**不**写入 |

## 设计

### §1 架构与组件

**单一真相源**:`package.json` 的 `version` 字段。

新增物:

| 物 | 说明 |
|----|------|
| `scripts/version-sync.mjs` | ESM 脚本,**风格遵循** `scripts/check-rules-version-bump.mjs`(`#!/usr/bin/env node` + 0/1 退出码 + 清晰修复指引 + Windows git bash 注意)。⚠️ **比对方式不同**:范本用 `git diff HEAD`/`git show HEAD:`(CI checkout 后工作区==HEAD → 范本在 CI 永远跳过,仅本地 pre-commit 有效);version-sync 用 `readFileSync` 直接读工作区文件比对,**CI 有效**。勿照抄范本的 git 比对逻辑 |
| `package.json` scripts 两项 | `"version-sync": "node scripts/version-sync.mjs"` + `"version-check": "node scripts/version-sync.mjs --check"` |
| `ci.yml` 1 步 | check job,`check-rules-version-bump` 之后、`vitest` 之前,加 `node scripts/version-sync.mjs --check` |

脚本两种模式:
- **默认模式(写入)**:读 `package.json` version,写入 A 类 3 文件
- **`--check` 模式(校验)**:读全部 5 文件版本号,与 `package.json` 比对,任一不一致 `exit 1`

### §2 数据流与算法

**写入模式** (`npm run version-sync`):
1. 读 `package.json` → `version`
2. `manifest.json`:最小正则替换 `"version"\s*:\s*"[^"\r]*"` → `"version": "<version>"`(`JSON.parse` 仅用于校验读取,不 `JSON.stringify` 全量重写 —— 保行尾/格式/字段顺序/最小 diff)
3. `plugin.cfg`:正则替换 `^version="[^"\r]*"` → `version="<version>"`(字符类排除 `\r`,replace 串不含行尾符)
4. `docs/使用指南.md`:正则替换 `(\*\*版本\*\*：)[^\s｜\r]+` → `$1<version>`(全角`：`/`｜`;字符类接受后缀、排除 `\r` 与分隔符)
5. 输出每文件 before→after,便于人工核对

**校验模式** (`--check`):
1. 读 `package.json` version 作为期望值
2. 用 `readVersionFromFile(path)` 读取 5 文件版本号
3. 任一 != 期望值 → 差异表 + 修复指引 → `exit 1`
4. 全部一致 → `✓ 版本元数据一致 (<version>)` → `exit 0`

各文件版本号提取锚点:

| 文件 | 提取方式 |
|------|----------|
| `package.json`(期望源) | `JSON.parse(content).version` |
| `manifest.json` | `JSON.parse(content).version`(JSON 解析健壮,校验/写入幂等判断共用) |
| `plugin.cfg` | 正则 `^version="([^"\r]*)"` (m 标志) |
| `docs/使用指南.md` | 正则 `\*\*版本\*\*：([^\s｜\r]+)`(全角`：`/`｜`,接受后缀) |
| `CHANGELOG.md` | 正则首个 `^## \[(.+?)\] - \d{4}-\d{2}-\d{2}` (m 标志;首个**带日期**段,天然跳过 `[Unreleased]`,顺带校验日期存在) |
| `README.md` | 正则版本表首个 `^\| \*\*v([^*\r]+?)\*\*` (m 标志) |

**读写同源**:抽取共享函数 `readVersionFromFile(filepath)`,校验模式与写入的"幂等/before 对比"读取共用同一解析逻辑。例外:`manifest.json` 校验读用 `JSON.parse`(健壮)、写用最小正则(保格式)—— 语义同源(均指向 `.version`),此权衡为 I2 采纳。其余 4 文件读写同正则。通则:所有正则字符类**排除 `\r`**,且写入 replace 串**不含行尾符**。

### §3 错误处理与边界

- **文件缺失**:某目标文件不存在 → 报错列出缺失文件 + `exit 1`(不静默跳过)
- **锚点 miss**:某文件找不到版本字段(正则不匹配)→ 报错"`<file>` 未找到版本字段,文件格式可能被改动" + `exit 1`(防格式漂移导致校验静默通过)
- **semver 后缀**:`package.json` 若含 prerelease 后缀(如 `0.20.0-rc.1`)→ A 类全串写入,B 类全串比对(`plugin.cfg` 的 version 是自由字符串,接受后缀)。锚点字符类已接受后缀(见 §2)。脚本不主动剥离后缀
- **幂等**:写入前先用 `readVersionFromFile` 读取目标当前值,已是期望值则跳过写该文件(减少 diff/mtime 噪音)
- **行尾(具体机制)**:工作区实测纯 LF(`git ls-files --eol` 显示 `w/lf`;`.gitattributes` `* text=auto eol=lf` 覆盖 `core.autocrlf=true`,故虽 Windows 开发机 autocrlf=true,工作区仍 LF)。保行尾机制:所有正则字符类排除 `\r`,且 replace 串不含行尾符 —— 确保无论文件当前 LF 或将来被外部工具改成 CRLF,都只动版本字段、不破坏行尾。`JSON.stringify` 全量重写会破坏 CRLF,故 manifest 改最小正则替换
- **退出码**:写入模式成功 `exit 0`,写入失败(文件缺失/锚点 miss)`exit 1`;校验模式一致 `exit 0`,不一致或读不到 `exit 1`

### §4 测试

新增 `test/version-sync.test.ts`(vitest,遵循现有 test/ 根惯例;fixture 放 tmp 目录,不触碰真实仓库文件;无新依赖)。**fixture 通用约定**:所有涉及 `CHANGELOG.md` 的 fixture 均含 `[Unreleased]` 段 + 至少一个正式版段(模拟真实结构,确保 C1 的"跳过-Unreleased"路径被覆盖)。

| 用例 | 验证 |
|------|------|
| 写入同步 | fixture(package.json + A 类 3 文件版本各异)→ 跑写入 → 断言 3 文件 == package version |
| 校验一致 | 5 文件全一致 → `exit 0`(**CHANGELOG fixture 必须含 `[Unreleased]` 段**,否则测不到 C1) |
| 校验漂移 | A 类某文件漂移 → `exit 1` + 错误信息含漂移文件名 |
| round-trip | 写入后立即 `--check` 通过(验证读写同源) |
| CHANGELOG-Unreleased | fixture CHANGELOG 含 `[Unreleased]` + 正式版段 → `--check` 读正式版段版本(跳过 Unreleased),不误报(C1) |
| B 类校验 | `CHANGELOG.md`/`README.md` 正式版首条版本号漂移 → `exit 1` |
| prerelease round-trip | `package.json=0.20.0-rc.1` → 写入 A 类 → `--check` 通过(后缀不被截断,I1) |
| CRLF 行尾保持 | CRLF 行尾 fixture → 写入 → 断言仅版本字段字节变化,其余字节(含行尾)不变(I2) |
| 格式 miss | fixture 里 `plugin.cfg` 缺 `version` 键 → `exit 1`(不静默通过) |
| 幂等 | 已一致时再跑写入 → 目标文件内容不变 |

## CI 集成

`ci.yml` check job,在 `Check rules version bump` 之后、`vitest` 之前新增:

```yaml
- name: Check version metadata consistency
  run: node scripts/version-sync.mjs --check
```

与既有 `check-rules-version-bump.mjs` **主题互补、正交**:
- `check-rules-version-bump`:规则模板源文件变 → 必须伴随 `package.json` version bump(防偷偷改规则不 bump)
- `version-sync --check`:`package.json` version → A/B 类元数据必须一致(防 bump 了元数据漂移)

两者共同覆盖"版本一致性"的正反两侧。

## 发版流程(实施后)

1. 改代码
2. `npm version patch --no-git-tag-version`(bump `package.json` version)
3. 手写 `CHANGELOG.md` 段 + `README.md` 版本表行(B 类,描述是人写)
4. `npm run version-sync`(同步 A 类 3 文件)
5. `git add` + `commit` + `tag` + `push`(直推 master)
6. `npm publish` —— **必须基于 step 4 之后的 commit/tag**(v0.19.0 事故根因:publish 从旧 tag 取元数据导致漂移;此处确保 publish 的元数据已是同步后的)
7. CI 跑 `version-check` 事后兜底(漏 step 3/4 时 push 后 CI 红逼着补)

## 验收标准

- [ ] `npm run version-sync` 把 A 类 3 文件版本同步到 `package.json` version,幂等
- [ ] `npm run version-check` 在 5 文件一致时 `exit 0`,任一漂移 `exit 1`
- [ ] `--check` 在当前 v0.19.1 状态(CHANGELOG 含 `[Unreleased]`)下 `exit 0`(C1 修复后基线绿)
- [ ] `test/version-sync.test.ts` 全绿,覆盖上表 10 用例(含 CHANGELOG-Unreleased / prerelease / CRLF)
- [ ] `ci.yml` check job 含 `version-sync --check` 步骤
- [ ] `package.json=0.20.0-rc.1` 写入 + `--check` round-trip 通过(I1)
- [ ] CRLF fixture 写入后仅版本字段字节变化(I2)
- [ ] 发版流程文档含 `npm publish` 节点且时序在 version-sync 之后(I4)
- [ ] `npm run lint` + `tsc --noEmit` 不引入新错误

## 影响范围

- 新增:`scripts/version-sync.mjs`、`test/version-sync.test.ts`
- 修改:`package.json`(加 2 个 scripts)、`.github/workflows/ci.yml`(加 1 步)
- 不改任何现有源码逻辑;不绑 `build`;不破坏现有 `check-rules-version-bump` 行为
