# 审查提示词防漏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 5 份审查提示词加防漏结构(新建索引 + 5 份顶部加定位块 + 专项2 加与通用版边界导读),并用更新后的专项2 提示词补跑生成第 5 份审查报告。

**Architecture:** 纯文档/提示词改动,无代码、无 TDD。Task 1-4 改 `D:\AI\提示词精选\godot-mcp-enhanced\`(非 git 目录,靠 `.bak\` 备份兜底);Task 5 补跑审查产出 Obsidian 报告 + 同步项目待办。验证用 Read/grep 内容检查替代测试。

**Tech Stack:** Markdown(提示词)/ Obsidian(报告)/ spec `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-22-review-prompts-anti-skip-design.md`

## Global Constraints

- **非 git 目录**:`D:\AI\提示词精选\godot-mcp-enhanced\` 不是 git 仓库 → Task 1-4 的提示词/索引改动**不 git commit**,靠 Task 1 的 `.bak\` 备份兜底;只有本 plan 文档在项目仓库 commit。
- **报告名全角括号**:期望报告名一律用全角 `（）`,对齐 Obsidian 既有 4 份文件命名(`三层架构综合审查（RCE面+进程通信+协议正确性）.md` 等)。
- **提示词正文不动**:深挖清单 / 已知非 bug / 基线实测命令 / 横切铁律 / 输出格式 / 交付落地——一律不改,只在顶部加 B 块、专项2 深挖清单前加 C 导读、新建索引。
- **B 块插入点**:5 份均在 `> 维护基线日期:**2026-07-22**…` 行之后、`---` 分隔线之前(用户已核实 5 份该段写法逐字一致,在第 6 行)。
- **绝对路径**:所有文件引用一律绝对路径(全局规则)。

---

### Task 1: 备份 5 份提示词到 `.bak\`

**Files:**
- Create: `D:\AI\提示词精选\godot-mcp-enhanced\.bak\` (目录)
- 复制 5 份:`通用版.md` / `专项1-安全RCE.md` / `专项2-可靠性.md` / `专项3-GDScript编辑器.md` / `专项4-测试缺口.md`

**Why:** 提示词目录非 git,B/C 块改动不可 git 回滚;先备份兜底(spec 验收#5 + 范围外第 3 条)。

- [ ] **Step 1: 创建 .bak 目录并复制 5 份**

```bash
mkdir -p "D:/AI/提示词精选/godot-mcp-enhanced/.bak"
cp "D:/AI/提示词精选/godot-mcp-enhanced/通用版.md" \
   "D:/AI/提示词精选/godot-mcp-enhanced/专项1-安全RCE.md" \
   "D:/AI/提示词精选/godot-mcp-enhanced/专项2-可靠性.md" \
   "D:/AI/提示词精选/godot-mcp-enhanced/专项3-GDScript编辑器.md" \
   "D:/AI/提示词精选/godot-mcp-enhanced/专项4-测试缺口.md" \
   "D:/AI/提示词精选/godot-mcp-enhanced/.bak/"
```

- [ ] **Step 2: 验证备份齐全**

Run: `ls "D:/AI/提示词精选/godot-mcp-enhanced/.bak/"`
Expected: 5 个 .md 文件(通用版 / 专项1-安全RCE / 专项2-可靠性 / 专项3-GDScript编辑器 / 专项4-测试缺口)

---

### Task 2: 新建 `00-索引.md`

**Files:**
- Create: `D:\AI\提示词精选\godot-mcp-enhanced\00-索引.md`

**Produces:** 跑前看、跑后核对的单一来源(spec A.1 对应表 + A.2 核对清单 + A.3 工作流)。

- [ ] **Step 1: 写入索引全文**

创建 `D:\AI\提示词精选\godot-mcp-enhanced\00-索引.md`,内容:

```markdown
# 审查提示词索引 · godot-mcp-enhanced

> 5 份审查提示词的配合关系 + 跑完核对清单。跑前看定位,跑后核对 5 份报告齐全。
> 维护基线日期:**2026-07-22**(对齐 0.23.0 已发版 + Unreleased)。

## 五份对应表

| 提示词 | 定位 | 期望报告文件名(YYYY-MM-DD) | 增量深挖(通用版未覆盖) |
|---|---|---|---|
| `通用版.md` | 全维度概览基线 | `三层架构综合审查（RCE面+进程通信+协议正确性）.md` | —(概览,不深挖) |
| `专项1-安全RCE.md` | 安全 / RCE 深挖 | `安全RCE面专项审查.md` | 入口点枚举 / load·exec·spawn / 路径穿越 / guard 绕过 / 网络面 / 凭证日志 / 供应链 |
| `专项2-可靠性.md` | 进程通信 + 崩溃恢复 + 并发 深挖 | `可靠性专项审查（进程通信+崩溃恢复+并发）.md` | TCP 半开 / in-flight 归宿 / 超时链雪崩 / zombie·孤儿·端口占用 / 崩溃恢复(详见专项2 C 导读) |
| `专项3-GDScript编辑器.md` | addons GDScript 深挖 | `审查 addons GDScript（0.23.0 后）.md` | undo 栈 / guards / @tool 生命周期 / 主线程 / ResourceSaver 分派 |
| `专项4-测试缺口.md` | 测试覆盖缺口 深挖 | `审查测试覆盖缺口与可信度.md` | 模块矩阵 / mock 掩盖 / 假绿弱断言 / env 隔离 / 集成 vs 单元 |

## 跑完核对清单

5 份都跑完后逐项打勾,缺一即漏跑:

- [ ] 通用版报告在 `D:\workspace\Obsidian\GodotMCP\开发日志\YYYY-MM-DD 三层架构综合审查（RCE面+进程通信+协议正确性）.md`
- [ ] 专项1 报告在 `...\YYYY-MM-DD 安全RCE面专项审查.md`
- [ ] 专项2 报告在 `...\YYYY-MM-DD 可靠性专项审查（进程通信+崩溃恢复+并发）.md`
- [ ] 专项3 报告在 `...\YYYY-MM-DD 审查 addons GDScript（0.23.0 后）.md`
- [ ] 专项4 报告在 `...\YYYY-MM-DD 审查测试覆盖缺口与可信度.md`
- [ ] `D:\workspace\Obsidian\GodotMCP\项目待办.md` 有 5 条对应发现条目(各引用一份报告)
- [ ] 通用版报告 ≠ 任一专项报告(无互替)

## 工作流建议(防漏跑)

- **推荐顺序**:先跑通用版建图 → 4 专项各开干净会话深挖(只读该专项 + 项目代码,隔离上下文质量更高)。
- **或并行**:5 份各开独立会话,跑完用上方核对清单逐项打勾。
- **每跑完一份**,立即在本索引「期望报告」列打勾,防跑漏。
- **通用版 ≠ 专项**:通用版是全维度概览基线,各专项是单维度深挖,二者不可互替。尤其专项2-可靠性:通用版【P0 进程通信】+【P1 并发】横切提及了 scheduleReconnect/重连耗尽/health-monitor/资源泄漏/并发/降级对称,但专项2 系统深挖 + 覆盖通用版未单列的 TCP 半开/in-flight/超时链雪崩/zombie·端口占用/崩溃恢复(见专项2 顶部 C 导读)。
```

- [ ] **Step 2: 验证索引内容**

Run: `grep -c "可靠性专项审查（进程通信" "D:/AI/提示词精选/godot-mcp-enhanced/00-索引.md"`
Expected: `2`(对应表 1 + 核对清单 1,均为全角括号)

Run: `grep -c "^| \`专项" "D:/AI/提示词精选/godot-mcp-enhanced/00-索引.md"`
Expected: `4`(专项1-4 四行)

---

### Task 3: 5 份提示词顶部各加 B 块

**Files:**
- Modify: `D:\AI\提示词精选\godot-mcp-enhanced\通用版.md`(第 6 行「维护基线日期」后)
- Modify: `D:\AI\提示词精选\godot-mcp-enhanced\专项1-安全RCE.md`(同)
- Modify: `D:\AI\提示词精选\godot-mcp-enhanced\专项2-可靠性.md`(同)
- Modify: `D:\AI\提示词精选\godot-mcp-enhanced\专项3-GDScript编辑器.md`(同)
- Modify: `D:\AI\提示词精选\godot-mcp-enhanced\专项4-测试缺口.md`(同)

**Interfaces:**
- Consumes: Task 2 索引表的期望报告名(全角括号)
- Produces: 每份顶部 B 块(定位 / 不可互替 / 期望报告名)

**统一插入锚点**(5 份逐字一致):在 `> 维护基线日期:**2026-07-22**(对齐 0.23.0 已发版 + Unreleased 变更)。` 这一行之后、`---` 之前,插入对应 B 块。用 Edit 工具,old_string = 该锚点行,new_string = 该行 + 换行 + B 块。

**注意**:5 份的锚点行文本可能略有差异(`Unreleased 变更` vs `Unreleased 变更)`),Edit 前先 Read 每份第 6 行确认精确文本,再以实际文本为 old_string。

- [ ] **Step 1: 通用版.md 加 B 块**

Edit old_string(以实际第 6 行为准):
```
> 维护基线日期:**2026-07-22**(对齐 0.23.0 已发版 + Unreleased 变更)。
```
Edit new_string:
```
> 维护基线日期:**2026-07-22**(对齐 0.23.0 已发版 + Unreleased 变更)。
> **本份定位**:通用版=全维度概览基线(建图 + 基线实测,不替代单维度深挖)。
> **不可互替**:通用版概览不替代专项深挖,专项不替代通用版,5 份各自独立产出报告。
> **期望报告**:跑完生成 `D:\workspace\Obsidian\GodotMCP\开发日志\YYYY-MM-DD 三层架构综合审查（RCE面+进程通信+协议正确性）.md`;5 份跑完用 `00-索引.md` 核对齐全。
```

- [ ] **Step 2: 专项1-安全RCE.md 加 B 块**

同锚点。new_string 在锚点行后接:
```
> **本份定位**:专项=安全 / RCE 单维度深挖。
> **不可互替**:通用版概览不替代专项深挖,专项不替代通用版,5 份各自独立产出报告。
> **期望报告**:跑完生成 `D:\workspace\Obsidian\GodotMCP\开发日志\YYYY-MM-DD 安全RCE面专项审查.md`;5 份跑完用 `00-索引.md` 核对齐全。
```

- [ ] **Step 3: 专项2-可靠性.md 加 B 块**

同锚点。new_string 在锚点行后接:
```
> **本份定位**:专项=进程通信 + 崩溃恢复 + 并发 单维度深挖。
> **不可互替**:通用版概览不替代专项深挖,专项不替代通用版,5 份各自独立产出报告。
> **期望报告**:跑完生成 `D:\workspace\Obsidian\GodotMCP\开发日志\YYYY-MM-DD 可靠性专项审查（进程通信+崩溃恢复+并发）.md`;5 份跑完用 `00-索引.md` 核对齐全。
```

- [ ] **Step 4: 专项3-GDScript编辑器.md 加 B 块**

同锚点。new_string 在锚点行后接:
```
> **本份定位**:专项=addons GDScript 单维度深挖。
> **不可互替**:通用版概览不替代专项深挖,专项不替代通用版,5 份各自独立产出报告。
> **期望报告**:跑完生成 `D:\workspace\Obsidian\GodotMCP\开发日志\YYYY-MM-DD 审查 addons GDScript（0.23.0 后）.md`;5 份跑完用 `00-索引.md` 核对齐全。
```

- [ ] **Step 5: 专项4-测试缺口.md 加 B 块**

同锚点。new_string 在锚点行后接:
```
> **本份定位**:专项=测试覆盖缺口 单维度深挖。
> **不可互替**:通用版概览不替代专项深挖,专项不替代通用版,5 份各自独立产出报告。
> **期望报告**:跑完生成 `D:\workspace\Obsidian\GodotMCP\开发日志\YYYY-MM-DD 审查测试覆盖缺口与可信度.md`;5 份跑完用 `00-索引.md` 核对齐全。
```

- [ ] **Step 6: 验证 5 份都有 B 块**

Run: `grep -c "不可互替" "D:/AI/提示词精选/godot-mcp-enhanced/通用版.md" "D:/AI/提示词精选/godot-mcp-enhanced/专项1-安全RCE.md" "D:/AI/提示词精选/godot-mcp-enhanced/专项2-可靠性.md" "D:/AI/提示词精选/godot-mcp-enhanced/专项3-GDScript编辑器.md" "D:/AI/提示词精选/godot-mcp-enhanced/专项4-测试缺口.md"`
Expected: 每个文件 `1`

Run: `grep -rc "可靠性专项审查（进程通信+崩溃恢复+并发）" "D:/AI/提示词精选/godot-mcp-enhanced/专项2-可靠性.md"`
Expected: `1`(全角括号)

---

### Task 4: `专项2-可靠性.md` 深挖清单前加 C 导读

**Files:**
- Modify: `D:\AI\提示词精选\godot-mcp-enhanced\专项2-可靠性.md`(提示词正文代码块内,`# 深挖清单` 标题之前)

**Why:** 专项2 是漏跑重灾区,C 导读让审查者一眼看出"本专项深挖什么、与通用版有何不同",防跑完通用版误判可省(spec C 块)。

**插入点**:专项2 提示词正文是 ` ``` ` 代码块,内含 `# 深挖清单` 标题(约第 28 行)。在 `# 深挖清单` 之前插入 C 导读(代码块内,审查者读到的内容)。用 Edit,old_string = `# 深挖清单\n1. EditorConnection.ts scheduleReconnect`,new_string = C 导读 + `\n\n# 深挖清单\n1. ...`。先 Read 确认 `# 深挖清单` 上下文精确文本。

- [ ] **Step 1: 插入 C 导读**

Edit old_string(以实际为准,锚定 `# 深挖清单` 标题):
```
# 深挖清单
1. EditorConnection.ts scheduleReconnect 状态机
```
Edit new_string:
```
# 与通用版的边界(必读,防漏跑)
本专项深挖清单(下方第 1-8 条)的导读。通用版【P0 进程通信可靠性】+【P1 并发】+【P1 历史 bug 模式】已横切提及 scheduleReconnect 状态机、重连耗尽 maxReconnectAttempts、health-monitor、资源泄漏、并发改编辑器状态(async 竞争 / free 后访问 / 主线程)、降级/fallback 对称性(通用版 grep 实测均命中)。本专项做两件事:① 对上述横切项单维度系统深挖(通用版是横切一句,本专项是深挖清单 + 调用链 + 行号);② 覆盖通用版完全未单列的边界场景(grep 实测 0 命中):
- TCP 半开(OS 崩溃无 FIN,WS 'close' 永不触发 → 心跳连续失败检测)
- in-flight 工具调用归宿(重连中:超时 / 错误返回 / 永久卡死——通用版反向清单仅提 do_not_retry 一面)
- 超时链放大(工具级超时 × 自动重试 → 雪崩;退避策略)
- 进程生命周期(zombie / orphan WS / 端口占用恢复)
- 崩溃优雅恢复 + 资源释放(编辑器 kill -9 / Godot 崩溃;通用版仅在测试缺口段提一句)
跑完通用版 ≠ 跑完本专项——通用版横切提及,本专项系统深挖 + 覆盖通用版未单列的边界场景,二者不可互替。

# 深挖清单
1. EditorConnection.ts scheduleReconnect 状态机
```

- [ ] **Step 2: 验证 C 导读就位**

Run: `grep -c "与通用版的边界" "D:/AI/提示词精选/godot-mcp-enhanced/专项2-可靠性.md"`
Expected: `1`

Run: `grep -c "跑完通用版 ≠ 跑完本专项" "D:/AI/提示词精选/godot-mcp-enhanced/专项2-可靠性.md"`
Expected: `1`

- [ ] **Step 3: 验证未误伤深挖清单正文**

Run: `grep -c "^# 深挖清单" "D:/AI/提示词精选/godot-mcp-enhanced/专项2-可靠性.md"`
Expected: `1`(仍是单个深挖清单标题,C 导读插在其前,标题未被删/重复)

---

### Task 5: 用更新后的专项2 提示词补跑,生成第 5 份报告

**Files:**
- Create: `D:\workspace\Obsidian\GodotMCP\开发日志\2026-07-22 可靠性专项审查（进程通信+崩溃恢复+并发）.md`
- Modify: `D:\workspace\Obsidian\GodotMCP\项目待办.md`(追加专项2 发现条目)

**Why:** spec 验收#4——5 份提示词 ↔ 5 份报告对齐的最后一块,补上漏跑的专项2。

**审查范围**(来自更新后的 `专项2-可靠性.md` 提示词 + C 导读 5 项真增量):
- 横切项系统深挖:`src/core/EditorConnection.ts`(scheduleReconnect 状态机 / 重连耗尽 maxReconnectAttempts / in-flight 工具归宿)、`src/core/health-monitor.ts`(onStateChange / editor stall 误判)、`src/core/process-state.ts`(orphan 会话隔离)、并发改编辑器状态、降级对称性
- 通用版未单列的边界场景:C 导读 5 项(TCP 半开 / in-flight 永久卡死 / 超时链雪崩 / zombie·orphan·端口占用 / 崩溃优雅恢复)
- 先跑专项2 提示词末尾的「基线实测命令」打印当前真实计数,再按深挖清单逐项审

**输出格式**:每条 = [P0/P1/P2] + 绝对路径:行号 + 问题 + 后果 + 修复 + 验证;最多 10 条;frontmatter + [!summary]/[!bug]/[!todo] callouts(对齐其他 4 份报告)。

- [ ] **Step 1: 跑专项2 提示词的基线实测命令**

在 `D:\GitHub\godot-mcp-enhanced` 跑专项2 提示词末尾的基线命令(scheduleReconnect 是否已删 / onStateChange / process-state orphan / editor-method-map 族action 数 / defects 计数),记录输出作为审查基线。

- [ ] **Step 2: 按深挖清单 + C 导读深挖,产出发现**

逐项审 EditorConnection / health-monitor / process-state + 5 项边界场景,产出 [P0/P1/P2] 发现(每条带绝对路径:行号)。已知非 bug 勿报(专项2 提示词反向清单:autoload change_scene 不销毁 / headless RID leak 无害)。

- [ ] **Step 3: 写第 5 份报告**

写入 `D:\workspace\Obsidian\GodotMCP\开发日志\2026-07-22 可靠性专项审查（进程通信+崩溃恢复+并发）.md`(全角括号),含 frontmatter(date/project/systems/status)+ [!summary] + [!bug] 发现清单 + [!todo]。

- [ ] **Step 4: 同步项目待办**

在 `D:\workspace\Obsidian\GodotMCP\项目待办.md`「其他待办」区追加一条专项2 发现修复条目,引用 `[[2026-07-22 可靠性专项审查（进程通信+崩溃恢复+并发）]]`。

- [ ] **Step 5: 验收(spec 验收#4)**

Run: `ls "D:/workspace/Obsidian/GodotMCP/开发日志/" | grep "2026-07-22.*审查\|2026-07-22.*可靠性"`
Expected: 含 `2026-07-22 可靠性专项审查（进程通信+崩溃恢复+并发）.md`(全角括号)

Run: `grep -c "可靠性专项审查" "D:/workspace/Obsidian/GodotMCP/项目待办.md"`
Expected: `>= 1`

至此 5 份提示词 ↔ 5 份报告对齐,可用 `00-索引.md` 核对清单逐项打勾确认无漏跑。

---

## Self-Review

**1. Spec coverage:**
- A 索引 → Task 2 ✓
- B 块(5 份)→ Task 3 ✓
- C 导读(专项2)→ Task 4 ✓
- 改动清单前置备份 → Task 1 ✓
- 验收#1(索引存在)→ Task 2 Step 2 ✓
- 验收#2(5 份 B 块 + 全角)→ Task 3 Step 6 ✓
- 验收#3(C 导读 + 5 项增量)→ Task 4 Step 1-2 ✓
- 验收#4(补跑第 5 份报告 + 待办)→ Task 5 ✓
- 验收#5(备份)→ Task 1 ✓

**2. Placeholder scan:** 无 TBD/TODO;B 块/C 导读/索引均给完整文案;基线命令引用专项2 提示词既有内容(非新造)。

**3. Type consistency:** 期望报告名跨 Task 2(索引表)/Task 3(B 块)/Task 5(报告文件名)一致,均为全角 `（）`:`可靠性专项审查（进程通信+崩溃恢复+并发）`、`审查 addons GDScript（0.23.0 后）`、`三层架构综合审查（RCE面+进程通信+协议正确性）`。
