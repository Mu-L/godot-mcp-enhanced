# 第三方审查:治理 check-changelog-sync + 补登欠账

**审查日期**:2026-08-09
**审查对象**:commit `c326535`(amend 后含 N1/N2 修复)
**审查者**:code-reviewer 子 agent(所有声明 grep/read 实测复核)

## 总体判定:**SHIPPED WITH NITS**(0 Blocking + 3 Nit,N1/N2 已当场修复)

核心功能全验证通过:
- ✅ advisory 恒 exit 0(main 四个 early return 无 process.exit(1) 非 STRICT)
- ✅ detect 闭包真能抓复发(防线删了 detect→1,实测验证)
- ✅ 补登条目与 commit 真实对应(8 条全部有源码落点,非编造)

## 逐项核实

### check-changelog-sync.mjs
- advisory 模式恒 exit 0 ✓(L113/121/128 early return + L143 仅 STRICT exit 1)
- git log --since 用 CHANGELOG 版本日期(非 tag)✓(getLatestVersionDate L44-48)
- 查双段([Unreleased] + 最近版本段)✓(防发版前 commit 误报)
- STRICT env 双模式 ✓

### defects.ts 新增 2 条 detect
- `test-framework-validatepath-no-root-check`:防线在→0,改回 validatePath→1 ✓
- `gd-secret-write-no-symlink-guard`:双副本三特征(readlink+LinkType+"is a symlink"),任一删→1 ✓
- 计数断言 131→133 已更新 ✓

### CHANGELOG 补登
- 8 条全部有真实源码落点(Tier1-1 scene/index.ts:214 / Tier2-1 .claude/skills/ 存在 / CMP-13 package.json:54 等)✓ 非编造

## Nits

### N1: [Unreleased] 段 Security 小节重复(置信度 100,已修复)
补登时 ### Security 出现两次(:9-11 和 :21-23)。已删重复段,保留 :9-11。

### N2: 标识符正则漏 Tier/Pn 类(置信度 85,已修复)
`[A-Z]{2,}` 要求 2+ 连续大写,Tier1-1/P2-6 不匹配。已放宽为 `[A-Za-z]{2,}`。

### N3: isChangelogWorthy 漏裸 BREAKING CHANGE: footer(置信度 80,保留)
Conventional Commits 的 footer 形态 `BREAKING CHANGE:` 漏检。advisory 盲区,升 STRICT 前再修。

## memory 教训
advisory 检测脚本的"非空即覆盖"是双刃剑:首版不阻塞(避免历史漏登误报),但对"有内容但漏登具体条目"失效。升 STRICT 前必须收紧标识符匹配(N2 已修)+ 无标识符 commit 的关键词模糊匹配(留后续)。已登 memory `engineering-lesson-advisory-ci-check-gradual-tightening`。

## 验证
- lint 0 / build 0 / test 4840 passed(+2 defect)
- check:changelog-sync ✓ 7 commit 均已登记
- 反向验证:清空 [Unreleased] → 报 6 漏登(检测生效)
- N1 修复:Security 段 [Unreleased] 内只 1 次
