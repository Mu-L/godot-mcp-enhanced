# 分发提交材料(ROADMAP #13)

> 本目录含向各 MCP 目录提交 `godot-mcp-enhanced` 所需的材料草稿。
> **所有提交需你本人账号操作**(GitHub PR / npm / mcp-publisher 登录),AI 无法代登录代发。
> 数据截至 2026-07-02;提交前请核对各目录最新规范。
>
> **当前状态(2026-07-02)**:
> - 渠道 1(awesome-mcp-servers):✅ **PR [#9067](https://github.com/punkpeye/awesome-mcp-servers/pull/9067) 已发**(commit `fcaa22f`,📇 🏠 条目在 Coding-Solo 旁),等维护者审核
> - 渠道 2(MCP Registry):⏸ **待下次正式发版**(npm 包需带 `mcpName`,当前 0.20.0 旧版无 —— 见"渠道 2 前置条件")
> - 渠道 3(mcp.directory / PulseMCP):依赖渠道 2,一并推迟

---

## 渠道 1:awesome-mcp-servers(GitHub PR,曝光最高)✅ 已发

`punkpeye/awesome-mcp-servers` 是 MCP 赛道最广为引用的 awesome 列表(对标 Coding-Solo 当年靠它拿星)。

**✅ 已执行**:PR [#9067](https://github.com/punkpeye/awesome-mcp-servers/pull/9067),Gaming 小节 `Coding-Solo/godot-mcp` 行后新增条目(commit `fcaa22f`,diff 1 file +1 line):

```
- [wgt19861219/godot-mcp-enhanced](https://github.com/wgt19861219/godot-mcp-enhanced) 📇 🏠 - A free, open-source MCP server for the Godot game engine with 40 merged tools (scenes, scripts, UI, animation, physics, particles, navigation, audio, testing, export), a 3-layer architecture (headless CLI + editor WebSocket + game bridge), and systematic security guards (path allowlist, GDScript injection defense, sandbox, confirmation tokens). Godot 4.5–4.7 compatibility matrix.
```

badge 图例(README 顶部核实):📇 TypeScript codebase + 🏠 Local service(与 Coding-Solo 一致)。意外发现该小节还有 `buildepicshit/Wick`(C# Godot MCP,53 工具),本项目是第三个 Godot 方案。等维护者 Frank Fiegel 审核(通常数日)。

<details>
<summary>条目文案草稿(参考,实际 PR 用上面的英文版)</summary>

中文版:
```markdown
- **Godot 引擎(增强版)**:[wgt19861219/godot-mcp-enhanced](https://github.com/wgt19861219/godot-mcp-enhanced) — 免费开源的 Godot MCP 服务器,40 个工具覆盖场景/脚本/UI/动画/物理/粒子/导航/音频/测试/导出,三层架构 + 系统化安全防护。Godot 4.5–4.7 兼容矩阵。
```
英文版:
```markdown
- **Godot (Enhanced)**: [wgt19861219/godot-mcp-enhanced](https://github.com/wgt19861219/godot-mcp-enhanced) — Free, open-source MCP server for the Godot engine. 40 tools (...), 3-layer architecture (...), systematic security guards (...), Godot 4.5–4.7 compat matrix.
```
</details>

---

## 渠道 2:官方 MCP Registry(mcp-publisher,一劳永逸)⏸ 待下次发版

官方 Registry([modelcontextprotocol/registry](https://github.com/modelcontextprotocol/registry),2025-09 推出)是上游数据源,**发布一次可被 mcp.directory / PulseMCP 等下游同步**。

### 材料

[`server.json`](./server.json) 已按官方 `2025-12-11` schema 起草,`mcp-publisher validate` ✅ 通过。字段:
- `name`: `io.github.wgt19861219/godot-mcp-enhanced`(GitHub auth 要求 `io.github.{用户名}/` 前缀)
- `description`: 84 字符(Registry 100 上限,见前置 3)
- `repository.url`: 本项目 GitHub
- `packages[0]`: npm 包 `godot-mcp-enhanced@0.20.0`,stdio 传输
- `environmentVariables`: `ALLOWED_PROJECT_PATHS`(必需)+ `GODOT_PATH`(可选)

### 前置条件(必做,缺一不可)

1. **`package.json` 加 `mcpName`** ✅(已加,commit `07990dd`) —— Registry 验证 npm 包归属的硬性要求。⚠️ `mcpName` 必须与 server.json 的 `name` **完全一致**。

2. **npm 包必须带 `mcpName`** ⏸ **当前阻塞项** —— Registry 验证的是 **npm 包本身**的 `package.json` 里的 `mcpName`,不是本地。当前 npm 上的 `0.20.0` 是**旧版(发布时还没加 mcpName)**,所以 `mcp-publisher publish` 归属验证失败(实测 422,count=0)。**必须 `npm publish` 一个带 mcpName 的新版本**(如 0.21.0),version 三方一致(package.json / npm / server.json)。→ 决定推迟到下次正式发版顺便做,不为上目录空 bump。

3. **`description` ≤ 100 字符** ✅(已修,84 字符) —— server.json 的 `description` 有 100 字符硬上限,超长 validate 报 422(`body.description` `expected length <= 100`)。当前值:`"Free open-source Godot MCP server — 28 tools, 3-layer architecture, security guards."`

4. **先 `validate` 再 `publish`** —— `mcp-publisher.exe validate` 本地验证 schema(过了再 publish),避免 422 往返。本次靠这步前置抓到了 description 超长。

### 发布步骤(下次发版后执行)

```powershell
# Windows 装 mcp-publisher(官方 CLI)
$arch = if ([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -eq "Arm64") { "arm64" } else { "amd64" }
Invoke-WebRequest -Uri "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_windows_$arch.tar.gz" -OutFile "mcp-publisher.tar.gz"
tar xf mcp-publisher.tar.gz mcp-publisher.exe

# 1. 把本目录 server.json 复制到项目根(改 version 与新 npm 版本一致)
# 2. validate(前置 4)
./mcp-publisher.exe validate
# 3. GitHub 登录(走 device code 流程,一次性)
./mcp-publisher.exe login github
# 4. 发布
./mcp-publisher.exe publish
# 5. 验证
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.wgt19861219/godot-mcp-enhanced"
```

发布后也可配 GitHub Actions([官方 OIDC 流程](https://github.com/modelcontextprotocol/registry/blob/master/docs/modelcontextprotocol-io/github-actions.mdx))自动化后续版本发布。

---

## 渠道 3:mcp.directory / PulseMCP(从 Registry 同步)⏸

这两个目录主要从官方 Registry 拉数据,渠道 2 发布后通常自动收录。若想主动加速:

- **mcp.directory**:网站导航栏「Submit」按钮提交 → [mcp.directory](https://mcp.directory/)
- **PulseMCP**:REST API 提交 → [pulsemcp.com/api](https://www.pulsemcp.com/api),或其 [GitHub 仓库](https://github.com/pulsemcp/mcp-servers) 提 issue

---

## 提交 checklist

- [x] 渠道 1:awesome-mcp-servers **PR [#9067](https://github.com/punkpeye/awesome-mcp-servers/pull/9067) 已发**,📇 🏠 条目在 Coding-Solo 旁,等审核
- [x] 渠道 2 前置 1:`package.json` 已加 `mcpName`(`07990dd`)
- [x] 渠道 2 前置 3:`description` 修到 84 字符(validate ✅)
- [ ] 渠道 2 前置 2:npm publish 带 `mcpName` 的新版本(**待下次正式发版**)
- [ ] 渠道 2:`mcp-publisher publish` 成功,API 可搜到(依赖前置 2)
- [ ] 渠道 3:mcp.directory / PulseMCP 已收录(渠道 2 发布后自动)

渠道 2/3 完成后回填 `ROADMAP.md` #13 状态 + 待办文件勾掉。
