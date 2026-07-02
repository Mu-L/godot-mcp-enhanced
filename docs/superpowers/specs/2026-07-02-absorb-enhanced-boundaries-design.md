# 吸收 ai-kit enhanced-boundaries 工具陷阱进 mcp rules

日期: 2026-07-02
关联: ai-kit 整合讨论(用户决定不整体合并 ai-kit,只吸收 enhanced-boundaries 的有效部分进 mcp rules)

## 背景

`godot-ai-kit/docs/enhanced-boundaries.md`(194 行,9 条 enhanced 工具裂缝 + 降级方案 + 3 条补充认知)写于 ai-kit v0.1.0 / 基于 enhanced **v0.18.2**。用户决定:不整体整合 ai-kit(其套件灵魂 workflow + 多组件聚合不适合并入 mcp 工具仓库),只把 enhanced-boundaries 里**mcp rules 缺失的有效工具陷阱**吸收进 mcp(工具陷阱归工具仓库)。

## 核实结果(方案 A:逐条核实当前 mcp v0.20.0+ 现状)

**不引入(mcp rules 已覆盖,避免重复)**:
- #1 autoload 盲区 → mcp core.md 已有 load_autoloads 说明
- #2 Edit tab 不匹配 → mcp core.md 已强调禁用内置 Edit 改 .gd,走 edit_script search_and_replace
- #3 CRLF 行尾 → mcp core.md 已有 search_and_replace CRLF 安全
- #6 超时 → mcp core.md 已有 timeout / computeRunTimeout
- #7 2D 截图 headless → mcp core.md 已有 2D 截图空白限制
- #8 确认令牌/GateGuard → mcp rules 已有 GUARDED + confirm_and_execute
- #9 run_and_verify 残留进程 → mcp core.md 已有 stop_project 清理

**不引入(过时)**:
- #10 sanitizePath 未接线 → mcp 已知(resolveWithinRoot 接线承担防护),enhanced-boundaries 自身也标"不构成漏洞"
- #11 index.ts 启动文案滞后 → 已修(enhanced 1c03909)

**吸收(3 条有效补充,mcp rules 缺失)** 👇

## 吸收清单(3 条)

### 1. add_node 幂等(完整吸收,原 #5)

**核实**:`src/tools/scene/index.ts:255` 的 add_node 创建场景时只查**场景文件**是否存在(`existsSync(sceneAbsPath)`),**无节点级冲突检测**(全 scene/ 目录无 has_node/find_child/already exists 节点检查)。→ batch_add_nodes 后再单独 add 同名子节点不会报错,可能产生重复。

**条目(加进 core.md 常见陷阱段)**:
> **add_node 无节点级冲突检测**:`batch_add_nodes` 后再单独 `add_node` 加同名子节点不会报错,可能产生重复节点(尤其同父路径)。add 前先 `query_scene_tree` 查目标父下是否已有同名节点,走"query → 条件 add"模式。

### 2. validate_scripts 交叉确认(调整措辞,原 #4)

**核实**:`src/tools/validation.ts:231` 当前 validate_scripts 用 `spawnGodot(['--headless', '--path', projectPath, '--script', validatorPath])` —— **跑 headless 验证器脚本**(能捕跨文件编译依赖),比 enhanced-boundaries 描述的 v0.18.2"单文件静态"强;但验证脚本 ≠ 实跑场景(运行时动态行为/场景加载差异)。**去"最致命"过时定性**。

**条目**:
> **validate_scripts vs run_and_verify 可能不一致**:validate_scripts 跑 headless 验证器脚本(捕跨文件编译依赖),但不等于实跑场景(运行时动态行为/场景加载)。关键验证结论(如"脚本通过")用 validate_scripts + run_and_verify 交叉确认,不一致时以 run_and_verify 实跑为准。

### 3. load_skill 召回代码须审(通用化,原 #12)

**核实**:原条目针对 gd-agentic-skills 硬编码密钥(godot-adapt-desktop-to-mobile/scripts/offline_save_sync.gd);**通用化**为 mcp load_skill 检索任何第三方 skill 库的警告。

**条目**:
> **load_skill 召回的是参考代码**:load_skill 检索第三方 skill 库(GodotPrompter / gd-agentic 等)召回的 scripts 是教学示例,非生产代码(可能含硬编码密钥 / null 崩溃 / 未验证模式)。复制到生产项目前必须人工审。

## 位置

`D:\GitHub\godot-mcp-enhanced\.claude\rules\godot-mcp-core.md` 的"常见陷阱"段 —— 与现有 remove_node 路径格式 / ui_build_layout scene_path / findGodot 缓存等条目并列。不新建文件(就 3 条,不值得)。

## 验收

- [ ] core.md 常见陷阱段加 3 条:add_node 幂等 / validate_scripts 交叉确认 / load_skill 参考代码
- [ ] 措辞去 v0.18.2 过时定性(如 #4"最致命"不引入)
- [ ] 不与 core.md 现有条目重复(7 条已覆盖的不加)
- [ ] edit_script search_and_replace 模式写入(CRLF + tab 安全)
- [ ] validate:edit 后无语法问题(core.md 是 .md,人读无编译)

## 非目标

- 不吸收 7 条 mcp rules 已覆盖的(避免重复)
- 不吸收过时的 #10 / #11
- 不把 ai-kit 的 workflow 6阶段 / compatibility-matrix / rules / demo / install 整体并入 mcp(用户已决定只吸收 enhanced-boundaries;套件灵魂不适合工具仓库)
- 不动 ai-kit 仓库本身(去留另定,本次只在 mcp 加 rules)
