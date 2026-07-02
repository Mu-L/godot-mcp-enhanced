# 分发提交材料(ROADMAP #13)

> 本目录含向各 MCP 目录提交 `godot-mcp-enhanced` 所需的材料草稿。
> **所有提交需你本人账号操作**(GitHub PR / npm / mcp-publisher 登录),AI 无法代登录代发。
> 数据截至 2026-07-02;提交前请核对各目录最新规范。

---

## 渠道 1:awesome-mcp-servers(GitHub PR,曝光最高)

`punkpeye/awesome-mcp-servers` 是 MCP 赛道最广为引用的 awesome 列表(对标 Coding-Solo 当年靠它拿星)。

### 插入位置(战略点)

README.md「游戏引擎集成」小节(约 [L673](https://github.com/punkpeye/awesome-mcp-servers/blob/main/README.md#L673)),紧邻已有的 **Coding-Solo/godot-mcp** 条目 —— 让本项目直接出现在竞品旁,搜 Godot MCP 即见差异化。

现有上下文(zread 核实):
```
- **Unity 开发**:[IvanMurzak/Unity-MCP](https://github.com/IvanMurzak/Unity-MCP) ...
- **Godot 引擎**:[Coding-Solo/godot-mcp](https://github.com/Coding-Solo/godot-mcp) 提供用于编辑、运行、调试和管理 Godot 项目场景的工具
- **国际象棋分析**:[jiayao/mcp-chess](https://github.com/jiayao/mcp-chess) ...
```

### 条目文案(英文,直接复制到 PR)

在 Coding-Solo/godot-mcp 行**之后**新增一行:

```markdown
- **Godot 引擎(增强版)**:[wgt19861219/godot-mcp-enhanced](https://github.com/wgt19861219/godot-mcp-enhanced) — 免费开源的 Godot MCP 服务器,28 个工具覆盖场景/脚本/UI/动画/物理/粒子/导航/音频/测试/导出,三层架构(headless CLI + editor WebSocket + game bridge)+ 路径白名单 / GDScript 注入防御 / sandbox / 确认令牌系统化安全防护。Godot 4.5–4.7 兼容矩阵,中文工具描述。
```

> 若该仓库条目统一用英文,改用此版:
> ```markdown
> - **Godot (Enhanced)**: [wgt19861219/godot-mcp-enhanced](https://github.com/wgt19861219/godot-mcp-enhanced) — Free, open-source MCP server for the Godot engine. 28 tools (scenes, scripts, UI, animation, physics, particles, navigation, audio, testing, export), 3-layer architecture (headless CLI + editor WebSocket + game bridge), systematic security guards (path allowlist, GDScript injection defense, sandbox, confirmation tokens), Godot 4.5–4.7 compat matrix.
> ```

### PR 步骤

1. Fork `punkpeye/awesome-mcp-servers` → 本地 clone
2. 编辑 `README.md`,在「游戏引擎集成」Godot 行后加上面条目
3. 提交前核对仓库根的 `CONTRIBUTING.md`(若有格式/分类要求)
4. 推送到你的 fork → 发 PR,PR 描述简述本项目与 Coding-Solo 的差异化(免费+开源+安全防护)
5. 等维护者 Frank Fiegel 审核(社区反馈通常数日)

---

## 渠道 2:官方 MCP Registry(mcp-publisher,一劳永逸)

官方 Registry([modelcontextprotocol/registry](https://github.com/modelcontextprotocol/registry),2025-09 推出)是上游数据源,**发布一次可被 mcp.directory / PulseMCP 等下游同步**。

### 材料

[`server.json`](./server.json) 已按官方 `2025-12-11` schema 起草,字段:
- `name`: `io.github.wgt19861219/godot-mcp-enhanced`(GitHub auth 要求 `io.github.{用户名}/` 前缀)
- `repository.url`: 本项目 GitHub
- `packages[0]`: npm 包 `godot-mcp-enhanced@0.20.0`,stdio 传输
- `environmentVariables`: `ALLOWED_PROJECT_PATHS`(必需)+ `GODOT_PATH`(可选)

### 前置条件(必做,缺一不可)

1. **`package.json` 加 `mcpName`**(Registry 验证 npm 包归属的硬性要求):
   ```diff
      "name": "godot-mcp-enhanced",
      "version": "0.20.0",
   +  "mcpName": "io.github.wgt19861219/godot-mcp-enhanced",
      "description": "...",
   ```
   ⚠️ `mcpName` 必须与 server.json 的 `name` **完全一致**。

2. **npm 包已发布** ✅ —— `godot-mcp-enhanced@0.20.0` 已在 npm(version 与本地一致)。后续每次升版本需先 `npm publish` 再 mcp-publisher publish(version 必须三方一致:package.json / npm / server.json)。

### 发布步骤

```powershell
# Windows 装 mcp-publisher(官方 CLI)
$arch = if ([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -eq "Arm64") { "arm64" } else { "amd64" }
Invoke-WebRequest -Uri "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_windows_$arch.tar.gz" -OutFile "mcp-publisher.tar.gz"
tar xf mcp-publisher.tar.gz mcp-publisher.exe

# 1. 把本目录 server.json 复制到项目根(mcp-publisher 在项目根运行)
# 2. GitHub 登录(走 device code 流程)
./mcp-publisher.exe login github
# 3. 发布
./mcp-publisher.exe publish
# 4. 验证
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.wgt19861219/godot-mcp-enhanced"
```

发布后也可配 GitHub Actions([官方 OIDC 流程](https://github.com/modelcontextprotocol/registry/blob/master/docs/modelcontextprotocol-io/github-actions.mdx))自动化后续版本发布。

---

## 渠道 3:mcp.directory / PulseMCP(从 Registry 同步)

这两个目录主要从官方 Registry 拉数据,渠道 2 发布后通常自动收录。若想主动加速:

- **mcp.directory**:网站导航栏「Submit」按钮提交 → [mcp.directory](https://mcp.directory/)
- **PulseMCP**:REST API 提交 → [pulsemcp.com/api](https://www.pulsemcp.com/api),或其 [GitHub 仓库](https://github.com/pulsemcp/mcp-servers) 提 issue

---

## 提交 checklist

- [ ] 渠道 1:awesome-mcp-servers PR 已发(条目在 Coding-Solo 旁)
- [ ] 渠道 2 前置:`package.json` 已加 `mcpName`
- [ ] 渠道 2:`mcp-publisher publish` 成功,API 可搜到
- [ ] 渠道 3:mcp.directory / PulseMCP 已收录(自动或主动)

完成后回填 `ROADMAP.md` #13 状态 + 待办文件勾掉。
