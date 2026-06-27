# 版本漂移根治设计 (version-sync)

**日期**: 2026-06-27
**分支**: master
**状态**: 已批准 → 待写实施计划 (writing-plans)
**来源**: superpowers:brainstorming 会话

## 背景与问题

版本号当前散落在 6 个文件(不含 package-lock.json 与历史 spec/plan 文档):

| 文件 | 行 | 当前值 | 语义 |
|------|-----|--------|------|
| `package.json` | 3 | `"version": "0.19.1"` | 真相源候选 |
| `manifest.json` | 5 | `"version": "0.19.1"` | 当前版本 |
| `addons/godot_mcp_server/plugin.cfg` | 6 | `version="0.19.1"` | 当前版本 |
| `docs/使用指南.md` | 5 | `> **版本**：0.19.1` | 当前版本 |
| `CHANGELOG.md` | 9 | `## [0.19.1] - 2026-06-27` | 版本历史(追加) |
| `README.md` | 623 | `\| **v0.19.1** \| 2026-06-27 \| ...` | 版本表(追加) |

每次发版手动同步,易漂移。

**v0.19.0 发版事故**:npm 包元数据基于 tag `2a48d06`,但 `manifest.json`/`plugin.cfg` 仍停在 `0.18.2`,导致 npm v0.19.0 元数据漂移,不得不发 v0.19.1 补救(commit `3145b60`)。`CHANGELOG.md` v0.19.1 条目明确记录了此事。

### memory 纠正

memory 曾记"根治 esbuild define 未实施"。**实测此方向不成立**:
- 项目构建用 `tsc`(非 esbuild),`package.json:30` 的 `"build": "tsc && node -e ..."`
- TS 源码无运行时版本号需求(`src/helpers.ts` 的 `0.19` 是 `@deprecated since v0.19.0` 注释文字,非版本常量)
- 版本号纯粹是"发布元数据",根治方向应是"单一来源 + 同步脚本 + CI 门禁",而非编译期注入

## 目标

1. `package.json` 的 `version` 成为唯一真相源
2. 发版时一条命令同步 A 类元数据,消除手动 4 处手改负担
3. CI 门禁强制版本一致性,使未来漂移无法合入 master
4. 不绑 `build`(避免本地 build 误改 `manifest.json`/`plugin.cfg` 源文件)

## 非目标 (YAGNI)

- **不**自动生成 `CHANGELOG.md`/`README.md` 版本表的描述文本(变更描述是人写创作,空壳骨架价值低且易"生成空壳忘填就发版")
- **不**处理 prerelease 后缀的特殊逻辑(当前项目无 prerelease;脚本对 `0.20.0-rc.1` 这类全串透传写/比对即可)
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
| `scripts/version-sync.mjs` | ESM 脚本,遵循 `scripts/check-rules-version-bump.mjs` 范本(`#!/usr/bin/env node` + 0/1 退出码 + 清晰修复指引 + Windows git bash 注意) |
| `package.json` scripts 两项 | `"version-sync": "node scripts/version-sync.mjs"` + `"version-check": "node scripts/version-sync.mjs --check"` |
| `ci.yml` 1 步 | check job,`check-rules-version-bump` 之后、`vitest` 之前,加 `node scripts/version-sync.mjs --check` |

脚本两种模式:
- **默认模式(写入)**:读 `package.json` version,写入 A 类 3 文件
- **`--check` 模式(校验)**:读全部 5 文件版本号,与 `package.json` 比对,任一不一致 `exit 1`

### §2 数据流与算法

**写入模式** (`npm run version-sync`):
1. 读 `package.json` → `version`
2. `manifest.json`:`JSON.parse` → 改 `.version` → `JSON.stringify`(2-space 缩进 + trailing newline)写回
3. `plugin.cfg`:正则替换 `^version=".*"` → `version="<version>"`(仅 `[plugin]` 段)
4. `docs/使用指南.md`:正则替换 `(\*\*版本\*\*：)\d+\.\d+\.\d+` → 保留前缀换版本号
5. 输出每文件 before→after,便于人工核对

**校验模式** (`--check`):
1. 读 `package.json` version 作为期望值
2. 用**与写入同源的** `readVersionFromFile(path)` 读取 5 文件版本号
3. 任一 != 期望值 → 差异表 + 修复指引 → `exit 1`
4. 全部一致 → `✓ 版本元数据一致 (<version>)` → `exit 0`

各文件版本号提取锚点(读写共用):

| 文件 | 提取方式 |
|------|----------|
| `package.json`(期望源) | `JSON.parse(content).version` |
| `manifest.json` | `JSON.parse(content).version` |
| `plugin.cfg` | 正则 `^version="(.+?)"` (m 标志) |
| `docs/使用指南.md` | 正则 `\*\*版本\*\*：(\d+\.\d+\.\d+)` |
| `CHANGELOG.md` | 正则首个 `^## \[(.+?)\]` (m 标志) |
| `README.md` | 正则版本表首个 `^\| \*\*v(.+?)\*\*` (m 标志) |

**读写同源**:抽取共享函数 `readVersionFromFile(filepath)`,写入(读取当前值做 before 对比 + 幂等判断)与校验共用同一解析逻辑,杜绝"写入用一套正则、校验用另一套"的漂移。

### §3 错误处理与边界

- **文件缺失**:某目标文件不存在 → 报错列出缺失文件 + `exit 1`(不静默跳过)
- **锚点 miss**:某文件找不到版本字段(正则不匹配)→ 报错"`<file>` 未找到版本字段,文件格式可能被改动" + `exit 1`(防格式漂移导致校验静默通过)
- **semver 后缀**:`package.json` 若含 prerelease 后缀(如 `0.20.0-rc.1`)→ A 类全串写入,B 类全串比对(`plugin.cfg` 的 version 是自由字符串,接受后缀)。脚本不主动剥离后缀
- **幂等**:写入前先用 `readVersionFromFile` 读取目标当前值,已是期望值则跳过写该文件(减少 diff/mtime 噪音)
- **行尾**:脚本用 utf-8 读写,保留各文件原有 LF/CRLF 行尾风格不改动
- **退出码**:写入模式成功 `exit 0`,写入失败(文件缺失/锚点 miss)`exit 1`;校验模式一致 `exit 0`,不一致或读不到 `exit 1`

### §4 测试

新增 `test/version-sync.test.ts`(vitest,遵循现有 test/ 根惯例,无新依赖):

| 用例 | 验证 |
|------|------|
| 写入同步 | fixture(package.json + A 类 3 文件版本各异)→ 跑写入 → 断言 3 文件 == package version |
| 校验一致 | 5 文件全一致 → `exit 0` |
| 校验漂移 | A 类某文件漂移 → `exit 1` + 错误信息含漂移文件名 |
| round-trip | 写入后立即 `--check` 通过(验证读写同源) |
| B 类校验 | `CHANGELOG.md`/`README.md` 首条版本号漂移 → `exit 1` |
| 格式 miss | fixture 里 `plugin.cfg` 缺 `version` 键 → `exit 1`(不静默通过) |
| 幂等 | 已一致时再跑写入 → 目标文件内容不变 |

测试用 tmp 目录 fixture,不触碰真实仓库文件。

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
5. `git add` + `commit` + `tag` + `push`
6. CI 跑 `version-check` 兜底(漏 step 3/4 时 CI 红逼着补)

## 验收标准

- [ ] `npm run version-sync` 把 A 类 3 文件版本同步到 `package.json` version,幂等
- [ ] `npm run version-check` 在 5 文件一致时 `exit 0`,任一漂移 `exit 1`
- [ ] `test/version-sync.test.ts` 全绿,覆盖上表 7 用例
- [ ] `ci.yml` check job 含 `version-sync --check` 步骤
- [ ] 现有 v0.19.1 状态下,`version-check` 立即 `exit 0`(基线绿,无回归)
- [ ] `npm run lint` + `tsc --noEmit` 不引入新错误

## 影响范围

- 新增:`scripts/version-sync.mjs`、`test/version-sync.test.ts`
- 修改:`package.json`(加 2 个 scripts)、`.github/workflows/ci.yml`(加 1 步)
- 不改任何现有源码逻辑;不绑 `build`;不破坏现有 `check-rules-version-bump` 行为
