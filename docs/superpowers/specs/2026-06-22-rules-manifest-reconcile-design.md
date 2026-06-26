---
date: 2026-06-22
status: draft
author: brainstorming session
related: 借鉴 ARIS install_aris.sh 清单+reconcile 模式（D:\GitHub\Auto-claude-code-research-in-sleep\tools\install_aris.sh）
---

# 规则文件清单与 Reconcile 对账设计

## 1. 背景与现状

`setup_project_rules`（`D:\GitHub\godot-mcp-enhanced\src\tools\project.ts`）向目标项目写入三类产物：
- `.claude/rules/godot-mcp*.md`（规则文件，约 7 个）
- `.claude/settings.json`（hooks，幂等 merge）
- `CLAUDE.md`（项目配置，mergeSections 保留用户段）

### 关键现状（代码已验证）

1. **规则文件"创建即冻结"**：`project.ts:430-435`（base 规则）和 `:447-453`（详细规则）在文件已存在时，即便 `force=true` 也只 push `"preserved (user modifications protected)"`，**不覆盖**。`force` 对规则文件是空操作。
2. **base 规则无版本占位符**：`godot-mcp.md` 用裸常量 `GODOT_MCP_RULES`（`project.ts:431`）直接写入；而详细规则 `DETAILED_RULE_TEMPLATES` 走 `{{MCP_VERSION}}` 插值（`project.ts:446`）。
3. hooks（`mergeHooks`/`replaceHookEntry`，`:334`）和 CLAUDE.md（`mergeSections`，`:404`）各有成熟 merge 机制，自洽。
4. `rule-templates.ts:4-5` 注释自认：模板内容与 `.claude/rules/` 实际文件是两份独立副本，更新需同步两处。

### 痛点

- 无法回溯哪些项目装了规则、装的什么版本（无清单）
- MCP 升级后规则**无法推送更新**（`force` 空操作 + 无版本追踪）
- 双副本维护负担

## 2. 目标与非目标

### 目标

- 给规则文件引入"可更新"能力 —— **新增语义，非改 `force` 旧义**
- manifest 追踪每个项目的规则安装状态
- reconcile 检测过时并按用户意图更新（检测+显式确认模式）

### 非目标（YAGNI）

- 不管 hooks（已幂等）
- 不管 CLAUDE.md（用户内容）
- 不管 Godot 插件 `addons/`（`install-plugin.js` 另一路）
- 不做 symlink（Windows 权限障碍，保留拷贝式）

## 3. 设计

### 3.1 manifest 结构

位置：`{project}/.claude/rules/.godot-mcp-manifest.json`（与规则文件同目录，隐藏文件）

```json
{
  "manifest_version": 1,
  "rules_installed_at_version": "0.18.2",
  "installed_at": "2026-06-22T10:30:00Z",
  "rules": {
    "godot-mcp.md":         { "source": "base",   "hash": "sha256:abc..." },
    "godot-mcp-core.md":    { "source": "detail", "hash": "sha256:def..." },
    "godot-mcp-bridge.md":  { "source": "detail", "hash": "sha256:ghi..." }
  }
}
```

字段说明：
- `rules_installed_at_version` —— **仅代表"规则文件安装时的 server 版本"**，不代表整个 MCP 安装（hooks/CLAUDE.md 不在本清单管辖内）。命名刻意框死语义，避免日后误读。
- `hash` —— 安装时文件内容的 SHA-256，**CRLF 归一化后计算**（见 3.5）。
- `source` —— 内容来源标记（`base` = `GODOT_MCP_RULES`，`detail` = `DETAILED_RULE_TEMPLATES`），便于诊断。

### 3.2 base 规则统一加版本号（修法 a）

给 `GODOT_MCP_RULES` 常量加 `{{MCP_VERSION}}` 占位符，base 规则也走版本插值路径（与详细规则统一）。

**收益**：消除"base 无版本号"特例，所有规则统一靠版本号判定，reconcile 逻辑无分支特例。

### 3.3 过时判定（逐文件二维判定）

版本（installed vs server）和"用户是否动过"（磁盘 hash vs manifest 安装时 hash）是**两个独立维度**，逐文件做笛卡尔积判定，**不级联**：

| installed版本 vs server版本 | 磁盘 hash vs manifest 安装时 hash | 分类 | `update` 行为 |
|---|---|---|---|
| 过时 | 未动过 | **纯版本升级** | 覆盖 ✓ |
| 过时 | 动过 | **版本过时 + 本地修改** | **保留 + 警告** |
| 同 | 未动过 | **最新** | 不动 |
| 同 | 动过 | **本地修改** | 保留 + 报告 |

- `check`：对所有文件算分类，只报告，不动任何文件
- `update`：仅覆盖"纯版本升级"类；"版本过时+本地修改"类**保留并警告**（避免吞用户修改）；"本地修改"类保留报告
- `overwrite`：不管分类，全覆盖

**为什么二维而非级联**：级联式（先比版本，版本不同就归"版本过时"不看 hash）会让 `update` 在"版本过时期间用户也改过"的文件上无差别覆盖，**吞掉用户修改且无警告**。版本与"是否动过"正交，必须笛卡尔积判定。

### 3.4 参数：`rules_mode` 枚举

新增 `rules_mode: "check" | "update" | "overwrite"`（默认 `check`）：

| mode | 文件已存在时的行为 |
|------|------------------|
| `check`（默认） | 只检测报告，**不覆盖任何文件** |
| `update` | 覆盖"纯版本升级"文件（版本过时且用户未动过）；**保留用户动过的文件（含"版本过时+本地修改"）并警告** |
| `overwrite` | **全覆盖**（含本地修改），需用户明确知晓风险 |

**关键边界**：
- `rules_mode` 只影响"文件已存在时"的更新策略。
- **文件不存在时（全新项目）**：任何 `rules_mode` 都先创建规则文件（创建不算覆盖），再写 manifest。
- **adopt 隐式**：无 manifest 时自动 adopt（与 `rules_mode` 无关，见 3.6）。

**为什么不复用 `force`**：
- 现有 `force` 参数保持原义（管 hooks/CLAUDE.md），规则文件**不再受 `force` 影响**。
- 避免 `force` 从"空操作"改为"强制覆盖"的语义变更包袱。
- `rules_mode` 是独立维度，与 `force` 正交。

**为什么不用两个布尔**（`update_rules` + `force`）：
- 叠加产生废组合（`update_rules=false, force=true` 语义不通）。
- 枚举正交、无废组合、未来加 `dry_run` 等模式自然。

### 3.5 CRLF 归一化

- **仅用于计算 hash**：算 hash 前把内容换行符统一为 LF。
- **写入磁盘的内容不归一化**：保留文件原有的换行符风格，不偷偷改用户文件。
- 规避 Windows CRLF vs 模板 LF 导致的 hash 误报。

### 3.6 reconcile 流程

```
setup_project_rules(project_path=X, rules_mode=check|update|overwrite)
│
├─ 文件不存在（全新项目）
│   └─ 创建规则文件（任意 mode）→ 写 manifest（记当前版本 + 新文件 hash）
│
├─ 文件存在 但 无 manifest（老项目）
│   └─ adopt：计算现有文件 hash + 当前 server 版本 → 写 manifest（不覆盖任何文件，无论 rules_mode）
│       报告"已采纳 N 个文件"；若 M 个文件与当前模板不符 → 告知
│       "如需对齐历史偏离，再调 rules_mode=overwrite"
│
└─ 文件存在 且 有 manifest
    └─ 按二维判定表（3.3）逐文件分类
        ├─ rules_mode=check     → 只报告分类
        ├─ rules_mode=update    → 仅覆盖"纯版本升级"类；保留"版本过时+本地修改"和"本地修改"类并警告；更新 manifest
        └─ rules_mode=overwrite → 全覆盖（不管分类）；更新 manifest
```

## 4. 关键不变式（方案命脉）

> **规则模板内容变更必须伴随 `package.json` 版本 bump。**

**违反后果**：版本号相同但模板 hash 变 → 该文件被误判为"本地修改"而非"待升级" → `rules_mode=update` 时静默跳过 → **漏更新**。

**CI 强制守护**（新增 `.github/workflows/ci.yml` 检查）：
- 比对 `rule-templates.ts` 中模板内容的 hash 变更
- 若 hash 变而 `package.json` version 未变 → **CI 失败**
- 防止开发者改了规则文案却忘记发版

**baseline 有效性约束（原则，脚本实现留 plan）**：
- baseline 必须取自 **git 历史**（上个 commit 的 `rule-templates.ts` 模板源文件 hash），**不能是工作区里的清单文件**。否则开发者改模板时连清单一起改，CI 比对"清单 vs 模板"永远一致，检查直接失效。
- 比对的是**插值前的模板源文件** hash，不是 `{{MCP_VERSION}}` 插值后内容。否则每次版本 bump 都让插值结果变，hash 语义混乱，失去检测"改模板没 bump"的能力。

这两条是命脉有效性的前提，非纯实现细节。

## 5. 向后兼容（adopt 语义明确）

- 老项目无 manifest → 首次调用自动 adopt（**无论 `rules_mode`，adopt 优先于更新**）
- **adopt 语义**：把当前磁盘状态固化为新基线 —— `rules_installed_at_version` 记当前 server 版本，每个文件 `hash` 记当前磁盘内容 hash（CRLF 归一化后）
- **adopt 不自动追踪历史偏离**：若某文件内容 ≠ 当前模板（老版本残留或本地修改，adopt 时无法区分），manifest 仍记当前版本 + 磁盘 hash，但报告**诚实告知**："M 个文件与当前模板不符（历史遗留或本地修改无法区分），如需对齐调 `rules_mode=overwrite`"
- **刻意设计**：adopt 后这些偏离文件在二维判定中落在"同版本 + 未动过 = 最新"格（刚记的 hash == 磁盘 hash），**不会自动提示更新**。历史遗留交给用户一次性决策（YAGNI），而非每次 reconcile 报警
- `manifest_version` 字段留作未来清单格式迁移

## 6. 错误处理

- **manifest 损坏**（JSON parse 失败）→ 当"无 manifest"处理 → 重新 adopt，**不覆盖任何规则文件**。与 `settings.json` parse 失败策略一致（`project.ts:311-314` 不碰坏文件）。
- **写 manifest** 复用 `writeAtomic`（`project.ts:342` 等多处已在用），并发安全 + 原子性已有保障。
- **读 server 版本** 复用现有逻辑（`project.ts:439-441` 从 `package.json` 读）。

## 7. 文件改动清单

| 文件 | 改动 |
|------|------|
| `src/tools/project.ts` | `setup_project_rules` 加 `rules_mode` 参数 + manifest 读写 + reconcile 分发 |
| `src/tools/rule-templates.ts` | `GODOT_MCP_RULES` 加 `{{MCP_VERSION}}` 占位符；更新 `:4-5` 双副本注释（说明 manifest 缓解了分发副本问题） |
| 新增 `src/tools/rules-manifest.ts` | manifest 读写 / adopt / reconcile / hash 计算的纯函数（隔离可测） |
| 新增 `test/tools/rules-manifest.test.ts` | 单元测试 |
| `.github/workflows/ci.yml` | 新增"模板 hash 变更必伴随版本 bump"检查 |

## 8. 测试方案

| 用例 | 验证点 |
|------|--------|
| manifest 读写往返 | 序列化/反序列化正确 |
| adopt 老项目 | 无 manifest → 自动生成，不覆盖现有文件 |
| 版本过时 vs 本地修改 | 两者互不混淆，报告准确 |
| `rules_mode=update` | 仅覆盖"纯版本升级"类文件 |
| 版本过时 + 用户本地修改并存 | update **保留该文件并警告，不覆盖** |
| `rules_mode=overwrite` | 覆盖含本地修改的全部文件 |
| adopt 历史偏离文件 | adopt 后判"最新"不提示，报告如实告知偏离 |
| adopt 后 `overwrite` 对齐 | 全覆盖偏离文件 |
| 全新项目 | 文件不存在 → 创建 + 写 manifest |
| CRLF 归一化 | Windows CRLF 文件 hash 与 LF 模板可比对 |
| 幂等 | 连续两次 check，第二次报告"已最新" |
| manifest 损坏 | parse 失败 → adopt，不覆盖规则文件 |
| CI 不变式检查 | 模板 hash 变未 bump 版本 → 检查脚本判定失败 |

## 9. 开放问题（留待 plan 阶段细化）

- CI 检查脚本的具体实现形式（pre-commit hook vs CI job）—— baseline 原则已定（§4：git 历史 + 插值前源文件），仅脚本形态待定
- `rules-manifest.ts` 的模块边界（是否也接管 base/detail 模板的版本插值，进一步消除 project.ts 里的特例）
