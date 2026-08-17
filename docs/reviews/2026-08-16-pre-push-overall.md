# 2026-08-16 feat/qa-closeout 分支 push 前整体(跨批次)第三方审查报告

> **审查者**:code-reviewer 独立子代理(隔离视角,不预设实现者声明为真)
> **审查对象**:分支 `feat/qa-closeout` 相对 master 的 5 个 commit(a9e78f7 fix(ui) / e6c06ab chore(ci) / 2ca5ece fix(review) / 480fe77 feat(qa) / eb4e60c fix(review)),覆盖原型翻译层小修批 + QA 编排收尾批。
> **审查方式与限制声明**:审查环境无 Bash,动态命令(tsc/lint/build/STRICT check/budget/version-check/vitest/git diff)未亲跑,由 coordinator 侧补跑(见文末「修复后记」验证段,七项全绿)。全部结论基于文件系统静态实测(.git/HEAD 确认工作区即分支检出)+ Read/Grep 逐文件核对最终态 + 与两份单批审查文档交叉印证。

## 总体判定:FIX BEFORE PUSH(处置后 READY TO PUSH,见修复后记)

功能设计、接线真实性、安全面均通过;两批工作叠加无语义冲突;单批审查的关键修复全部实测在位。审查产出 3 Important + 2 Nit,全部已由 coordinator 处置(见后记)。

## 逐维度结论

### 1. 跨批次交互 — 通过(Important-1/3 见后)

- 两批改动面无重叠冲突;`.claude/rules/` 全目录 grep `qa|nightly|record_on_failure` 零命中——第二批"无需双副本同步"豁免成立。
- N-1 "root/ → /root/" 修复本体在位(rule-templates.ts:291-315 全绝对形态,rules 目录零命中)——**但全仓 grep 发现同款漏网到使用指南(Important-1)**。
- qa description 两次改动最终态与 matrix 逐字一致(descBytes 773)。
- 双副本 9 键 9 文件结构对齐;N-4 归一化锚定在位;逐字比对由 coordinator 补跑 STRICT 确认。
- CHANGELOG 三段叠加内容无冲突——但段位置异常(Important-3)。

### 2. 仓库级约束全量核查 — 通过

| 项 | 结论 |
|---|------|
| 版本 bump 链 | 7 处全部 0.31.3(package/manifest/server/Dockerfile/plugin.cfg/matrix/使用指南) |
| capability-matrix | version + qa description/size/riskDistribution 与源码一致 |
| GDScript 零改动 | 静态印证通过(coordinator 补跑 git diff '*.gd' 为空确认) |
| 禁编辑类别 | 结构性排除(.gitignore 含 build//node_modules/) |
| token budget | totalSum warn 90KB 校准注释在位;qa desc 773B<800 无 warn |
| 两份单批审查文档 | 存在且关键结论逐条抽查全通过 |
| CHANGELOG 覆盖 | 内容覆盖 5 commits 全部用户可见变化;位置问题见 Important-3 |

### 3. 安全面(新增入口) — 通过(2 Nit)

- nightly specDir:readdirSync 枚举目录文件名(元数据),每个 spec 内容仍经 handleRun spec_path 白名单——执行面无绕过;CLI 为本地用户主动运行威胁面小于 list_projects;无同等裁决注释 → Nit-1。
- record_on_failure 落盘:仅写 ~/.godot-mcp/qa-reports(用户家目录),不写目标项目,无敏感外传面;stop 先于 stop_project 顺序由测试钉死。
- CLI audit:isAuditEnabled 开关门在位;appendAuditLine 的 projectPath 来自白名单+requireProjectPath 校验链,复用无新面。

### 4. 测试质量抽查 — 通过(接线真实)

五组"删修复必红"推演全成立:Panel 灰底 warning 正负例 / audit 开关两向 / findPreviousReport 碰撞三断言 / suite_budget Date.now spy 容错性复核(断言不看翻转步位,三步 remaining 不可能全落前 4 次调用)/ root 归一化两变体。

### 5. 验证完整性 — coordinator 补跑(全绿,见后记)

## Blocking Issues

无。

## Important Issues(审查产出 → 全部已处置)

| # | 问题 | 处置 |
|---|------|------|
| Important-1 [95] | `docs/使用指南.md:391/:413` bridge 示例 `"path": "root/Player"` 相对形态与 validateBridgePath 强校验冲突,照抄必 INVALID_PATH——第一批 N-1 修复只圈了 rules/模板/schema,用户指南漏网(同款失败模式) | ✅ 两处改 `/root/Player`/`/root/BattleScene`;全仓(README/README.en/docs 顶层)grep 复查零残留(历史快照 reviews/research/plans 除外) |
| Important-2 [85] | `cli/qa.ts` parseFlag 不消费 `--json`,前置形态 `qa run --json spec.json` 的 spec_path 被取成 '--json' 必失败;测试全后置形态未钉住 | ✅ parseFlag 统一剥除 `--json`(positional 过滤)+ 前置混合形态测试用例(`nightly --json <dir> --project <p>` 正确解析) |
| Important-3 [100] | CHANGELOG `[Unreleased]` 段错位在文件底部 158 行(应置顶),发版整理会漏内容/版本段错序;CI changelog-sync 只查内容不查位置 | ✅ 整段(含 CI Linux 债段)移到顶部并改名 `## [0.31.3] - 2026-08-16`(对齐项目"版本段与 bump 同 commit"惯例,bd54ba3 先例);README.md 版本表同步加 v0.31.3 行;version-sync --check 转绿 |

## Nits

| # | 问题 | 处置 |
|---|------|------|
| Nit-1 | nightly specDir 无安全裁决注释(对比 project.ts:102 先例) | ✅ 加注释:本地 CLI 用户自定目录不做前置白名单(仅元数据枚举),spec 内容仍经白名单 |
| Nit-2 | nightly 基线 catch 过宽:head 报告读失败也报"基线不可读",指向错误方向 | ✅ 提示措辞中性化"基线/head 报告读取失败" |

## 单批审查结论抽查(全部复核通过)

prototype 批 N-1 已修/N-4 锚定/90KB 校准注释、qa 批 isAuditEnabled 门/suite.name 二次校验/append 模式/baselineBroken/773B、qa description 逐字一致、Date.now spy 阈值不脆——逐条实测在位。

## 修复后记(2026-08-16,coordinator 侧)

- Important-1/2/3 + Nit-1/2 全处置(上表);Important-3 处置同时解决 coordinator 自查发现的 version-sync --check 红(CHANGELOG/README 版本引用 0.31.2→0.31.3)。
- coordinator 另行排查:并发审查期间全量测试曾现 9 failed(审查 agent 同机并发跑命令的资源竞争),串行重跑 5546 passed/0 failed 确认为瞬时环境性失败,非代码回归。
- 处置后补跑审查要求的全部门禁(七项):`npx tsc --noEmit` 0 / `npm run lint` 0 警告 / `npm run build` 0 + `STRICT=1 check:rules-sync` 9 模板一致 / `check:budget` 0 error / `version-sync --check` ✓ 0.31.3 / `git diff master...HEAD -- '*.gd'` 空 / 产物目录零 diff。定向 vitest(qa 7 文件 + prototype 2 文件)全绿,含新增前置 flag 用例(qa-cli-nightly 7 passed)。

## 值得进 memory 的工程教训

1. **"示例形态 vs 校验器"的全仓清剿不能只按修复责任文件圈范围**:N-1 修复按"rules+模板+schema"圈定,但同一错误形态早已扩散到用户指南——同类修复的收尾 grep 应以**校验器关键字**反查全部文档面,而非以本批改动面为界。
2. **CLI flag 解析要为"flag 前置"惯例设计并测试**:只提取带值 flag 的 parseFlag 会把无值 flag 混入 positional;测试若全用后置形态即形成盲区。
