# 从 Coding-Solo/godot-mcp 升级到 enhanced

> 本项目 (`godot-mcp-enhanced`) 基于 [Coding-Solo/godot-mcp](https://github.com/Coding-Solo/godot-mcp) 二次开发(MIT,继承上游 Solomon Elias 版权)。如果你在用 Coding-Solo 版,这篇指南帮你**平滑升级**——核心能力零丢失,且获得三层架构 / 安全体系 / 验证门禁 / 跨版本矩阵等增强。

## 为什么升级

enhanced 是 Coding-Solo 的 fork,**核心能力(启动编辑器 / 运行项目 / 调试输出 / 场景节点操作)100% 继承**,在此之上扩展:

1. **系统化安全防护(Coding-Solo 完全没有)** —— 路径白名单(deny-by-default + junction 防御)/ GDScript 注入防御 / 危险操作确认令牌 / 输出标记防伪造。Godot MCP 赛道里少见提供系统化安全特性的方案。
2. **三层架构** —— Coding-Solo 是单一 headless CLI;enhanced 增加 **Editor WebSocket**(实时场景操作 + Undo)+ **Game Bridge**(运行时调试 / E2E 测试 / 输入模拟)。
3. **验证门禁** —— `verify_delivery`(端到端交付门禁)+ `validate_scripts`(触发 Godot 完整编译,捕获 headless 遗漏的 Parse Error)+ `dev_loop`(执行 → 验证 → 截图一体化)。
4. **跨版本兼容矩阵** —— Godot 4.5–4.7 实测兼容;Coding-Solo 未披露跨版本验证。
5. **中文工具描述** —— 服务中文 Godot 开发者社区;欢迎 i18n PR。

## 3 步平滑升级

> **能力零丢失**:enhanced 继承 Coding-Solo 全部核心能力。工具结构从 13 个独立工具进化为 43 个 grouped tool(每个含多 action),**AI 读 schema 自动适配新结构**——你无需手改工具调用。

**① 移除旧的 godot MCP server**

```bash
claude mcp remove godot
# 若 Coding-Solo 当初以其他名字注册,换成对应名(可用 claude mcp list 查看已注册 server)
```

**② 安装 enhanced**

```bash
# Claude Code(全局,所有 Godot 项目自动可用,推荐)
claude mcp add -s user godot -- npx -y godot-mcp-enhanced
```

Cursor / Cline / Windsurf / 其他(写入项目的 `.cursor/mcp.json` 或 MCP 配置):

```json
{
  "mcpServers": {
    "godot": { "command": "npx", "args": ["-y", "godot-mcp-enhanced"] }
  }
}
```

**③ 验证接入**

**新开一个 AI 会话**(让 AI 重新读取 enhanced 的工具 schema),然后让它执行一个简单操作验证,例如:

> "获取一下当前 Godot 引擎版本"

AI 会自动选用 enhanced 的对应工具完成。能返回版本号即接入成功。

## 工具对应(Coding-Solo → enhanced)

enhanced 继承 Coding-Solo 的全部核心能力,工具结构从 **13 个独立工具 → 43 个 grouped tool**(每个 tool 含多个 action):

| Coding-Solo 能力 | enhanced 位置(grouped tool) |
|---|---|
| 启动 / 运行 / 停止 / 调试输出 / 引擎版本 | `runtime`(action: `launch_editor` / `run_project` / `stop_project` / `get_debug_output` / `get_godot_version` 等) |
| 项目列出 / 项目信息 | `project`(action: `list_projects` / `get_project_info` 等) |
| 场景创建 / 节点增改 / 保存 / 加载精灵 | `scene`(action: `create_scene` / `add_node` / `save_scene` / `load_sprite` 等) |

> **你不用记 action 名** —— AI 读 enhanced 工具 schema 后自动选对 tool + action,你只需用自然语言描述需求。

**个别能力位置说明**:
- `export_mesh_library` / `get_uid` / `update_project_uids`:底层能力在 enhanced 的 GDScript 端(`src/scripts/godot_operations.gd`)保留,但**未作为独立 MCP 工具入口暴露**。需要时可用 `execute_gdscript` 直接调用对应 GDScript 函数。

## 升级后的新能力导览

| 能力 | 说明 | 详见 |
|---|---|---|
| 三层架构 | headless + editor + game bridge,按场景分工 | [README](../README.md)「核心能力」 |
| 安全体系 | 路径白名单 / 注入防御 / 确认令牌 / 输出防伪 | [README](../README.md)「安全体系」 |
| 验证门禁 | `verify_delivery` / `validate_scripts` / `dev_loop` | [README](../README.md)「AI 开发闭环」 |
| 跨版本矩阵 | Godot 4.5 / 4.6 / 4.7 实测兼容 | [README](../README.md) + 跨版本验证矩阵 |

## FAQ

**Q: 升级后我的 AI agent 会断吗?**
**新会话自适应**(AI 读 enhanced 新 schema 自动适配)。**旧会话**(AI 已记忆 Coding-Solo 的扁平工具名)调用可能失败 —— **建议升级后新开 AI 会话**,让 AI 重读工具 schema,这是最省事的方式。
> `GODOT_MCP_WARN_LEGACY` 环境变量只能映射 enhanced 自身的 9 个历史工具名(v0.18.0 合并遗留,如 `node_create_3d`/`scene_commit`),**不兼容 Coding-Solo 的工具名** —— 所以别指望它做 Coding-Solo 兼容,直接开新会话让 AI 适配新结构。

**Q: 能同时装 Coding-Solo 和 enhanced 吗?**
能。用不同 server 名注册(如 `godot` 和 `godot-enhanced`),两个 MCP server 并存。但不建议长期混用 —— 工具语义重叠易让 AI 困惑。

**Q: 工具名变了,我的旧 prompt / 脚本怎么办?**
AI agent 的自然语言 prompt 通常无需改(AI 自适应新工具)。若你有**硬编码工具名**的脚本,需改为 enhanced 的 grouped tool + action 调用方式。

**Q: 想回滚到 Coding-Solo?**
改回 `claude mcp add godot -- npx @coding-solo/godot-mcp` 即可。enhanced 不修改你的 Godot 项目文件,回滚无副作用。

## 关联

- 项目首页:[README](../README.md)(对比表 / 安全体系 / 核心能力)
- 路线图:[ROADMAP](../ROADMAP.md)(M1-M4 行动项)
- 竞品全景与 Coding-Solo 龙头归因:见项目竞品调研文档 §八
