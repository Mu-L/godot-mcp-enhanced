# 第三方审查:分发优先批(P0-2/P1-1/P1-2/P2-1/P2-2)— 2026-08-19

> **审查对象**:分支 `feat/distribution-batch-20260819`,commits `3c06ac4..db706be`(5 commits)。
> **审查者**:独立 code-reviewer 子代理(与实现者上下文隔离,所有声明 grep/read 实测)。
> **审查者声明边界**:该会话无 Bash 工具,`npm test`/`STRICT=1 check:rules-sync`/`npm pack` 等运行类声明未复验,以源码逐行阅读 + 双副本逐字比对替代;lint 0 错/5974 passed 由实现者侧证据背书(见 §5)。

## 总体判定:SHIPPED WITH NITS(2 Important + 5 Nit,处置见 §4)

无 Blocking Issue。核心安全声明全部核实为真:translation 三路文件 IO 全过 `resolveWithinRoot` 白名单;uid 的 `executeGdscriptTrusted` 豁免论证成立(脚本 100% 工具生成,TS 三层校验覆盖注入面);双副本计数行逐字一致;skills `--target` 任意目录写入不构成可利用面(CLI 由人类本人运行,等价 cp,不在 MCP 工具参数防御体系管辖内)。

## 逐维度结论(摘要)

| 维度 | 结论 | 关键证据 |
|---|---|---|
| 仓库级约束 | 通过 | `src/tools/rule-templates.ts:24` 与 `.claude/rules/godot-mcp-core.md:10` 计数行逐字一致;translation read/write/register 全过 `resolveWithinRoot`(`src/tools/translation-ops.ts:295,319,350,403`);uid 注入面被 sanitizeResPath + escapeForGdLiteral + UID_TEXT_RE + EXT_RE 四层覆盖 |
| 设计正确性 | 1 bug(I-1)+其余核实 | warp working_directory 语义正确;configure 幂等/越闸齐全;GD_WALK res:/// 修复正确;PO msgstr[0]/flush 主体正确;注册器三场景正确 |
| 测试质量 | 1 缺口(I-2)+其余合格 | translation 负向五类、configure mock 清零+幂等、warp C1 白名单保留断言齐全 |
| 部署/分发 | 通过 | files 含 "skills" + 双输出 DRY 断言;版本五处一致 0.32.7;取舍段源与产物同步 |
| 验证完整性 | 抽查通过 | 组计数断言实为动态等价锁定(`toEqual(allGroups)`,比声明的硬编码更抗漂移) |

## Important Issues(2 项,均已修复)

- **I-1 translation CSV 引号内换行 write→read 往返损坏**(置信 95):`parseTranslationCsv` 按行 split,serializeCsvLine 写出的合法 RFC 4180 含换行字段被拆成错位记录。**处置**:`src/tools/translation-ops.ts` 重写为字符级状态机 `parseCsvRecords`(inQuotes 内 \n 是字段内容),删 `parseCsvLine`;补 I-1 回归用例 2 条(记录级 + 文件级往返)。
- **I-2 uid handler 正向执行路径测试零接线**(置信 90):vi.mock 工厂只提供 `executeGdscript` 而源码 import `executeGdscriptTrusted`,且无用例走到执行点("删 handler 执行调用测试仍绿"成立)。**处置**:mock 补 `executeGdscriptTrusted` 导出;新增正向用例锁定 handler↔执行器↔parseGdscriptResult 接线(断言传入 code 含 `_mcp_walk`/`"missing_count"`、projectPath、loadAutoloads=false、返回 outputs JSON.parse 解回结构)。

## Nits(5 项处置)

- **N-1 PO 反斜杠转义顺序**(`\\n` 链式 replace 把字面 `C:\new` 变换行):已修——单遍 `replace(/\\(.)/g, ...)`;补 N-1 回归用例。
- **N-2 半发版中间态**(package.json 0.32.7 而 CHANGELOG 仍 [Unreleased]):**不修,设计如此**——「默认不发版」定规(2026-08-19,AGENTS.md「发版前额外门禁」节):rule-templates 变更强制 bump(check-rules-version-bump 硬门禁)与"变更进 [Unreleased]、用户明确要求才定版"并存,下次真发版时 [Unreleased] 整段定 0.32.7。check-changelog-sync 加定版检测的建议记 backlog。
- **N-3 uid_check_refs 忽略 ext_resource 的 path fallback**(uid 悬空但 path 存在的引用引擎可正常加载,仍计 dangling)+ `col` 死代码:死代码已删(GD 脚本真机复验行为一致);边界在工具 description 显式声明("uid 悬空但 path fallback 存在的引用引擎可正常加载,计入 dangling 属诊断提示,非断链")。
- **N-4 configure/warp 不校验 cwd 是 Godot 项目**(在非项目目录运行会复现指南 §5 的坑):已修——project scope adapter 前置 `project.godot` 存在性检查,console.warn 警告不阻断;补行为用例。
- **N-5 文档计数滞后**(AGENTS.md "13 客户端适配器" vs 实际 15 实例):已修——AGENTS.md 更新为 15(Claude Desktop/Cursor/Cline/Windsurf/Zed/Claude Code CLI/Codex CLI/Cherry Studio/Antigravity/Trae/Qwen Code/Gemini CLI/OpenCode/ZCode/Warp)并补 configure/skills 子命令到路由清单。

## 验证证据(处置后复验)

- `npx vitest run test/uid-ops.test.ts test/translation-ops.test.ts test/cli/` → **230 passed**(含 I-1 回归 ×2、I-2 正向接线、N-1 回归、N-4 行为用例)
- `npm run build` 0 error;`npm run lint` 0 输出
- N-3 死代码删除后 uid check_refs 真机(Godot 4.6.3)复验:同一 fixture 抓到同一悬空引用(`res://screenshot.png.import` line 5 `uid://c47ygxsr81r46`),行为不变

## 值得进 memory 的工程教训(审查者提炼)

1. **序列化/解析能力不对称是往返测试的盲区**:serialize 支持引号内换行而 parse 按行 split 时,往返测试必须覆盖"序列化器能产出的每一种形态",否则单行级往返全绿、文件级往返损坏(I-1)。
2. **vi.mock 工厂导出集合与被测模块实际 import 名不一致是接线零验证的静默信号**:若无任何用例走到执行点,此类不匹配永不暴露。凡 mock 外部执行器的测试组,至少要有一个正向用例真的到达 mock 执行点(I-2)。

## 关联

- 待办来源:`D:\workspace\Obsidian\GodotMCP\项目待办.md` 2026-08-19 竞品横扫行动批
- 横扫报告:`D:\GitHub\_notes\2026-08-19-godot-mcp-22竞品横扫-新增8仓深扫.md`
- 云路由评估:`D:\GitHub\godot-mcp-series\godot-mcp-enhanced\docs\research\2026-08-19-云路由与多项目管理评估.md`
