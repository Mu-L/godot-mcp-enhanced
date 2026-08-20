# 批 4b:Web 试玩闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。

**Goal:** `npx godot-mcp-enhanced web <project> [--port N] [--serve-only]` 一条命令:检测/安装 export templates(复用批 2 下载信任链)→ 生成 Web preset → headless 导出 → 127.0.0.1 静态服务器 → 打开 URL 浏览器可玩。

**Architecture:** `src/cli/web-exporter.ts`(templates 检测/下载/校验/解压安装 + presets 生成 + `godot --headless --export-release` spawn);`src/cli/web-server.ts`(零依赖 http 静态服务器:127.0.0.1 绑定/路径穿越防护/MIME);`src/cli/web.ts` 编排。复用批 2 `buildReleaseUrls/downloadWithProgress/verifyDownloadedAsset`(资产名参数化已就位)+ 批 4a zip reader(`extractZip` 直接吃 tpz——tpz 即 zip)+ `detectGodotVersion`。

**Global Constraints(spec §3 批 4b + §6)**
- headless 直调 `godot --headless --export-release "<preset>"`(官方路径,**不修 editor 侧 export_commands.gd stub**——超范围)。
- templates 下载复用批 2 信任链(GitHub releases 域名白名单/SHA512 同源/失败即删/机器审计);安装位置 `%APPDATA%/Godot/export_templates/<ver>.stable/templates/`(版本与所用 Godot 严格匹配,`detectGodotVersion` 推导)。
- 静态服务器:**仅绑定 127.0.0.1**;路径穿越防护(绝对路径/`..`/盘符/反斜杠全拒,recording.ts sanitize 同款语义);起服务走 y/N 确认门;MIME 至少 html/wasm/pck/js/json/png/ico/svg。
- 不新增 MCP 工具、零 GD 改动;每 Task commit;全批 lint/build/test 全绿。
- 参数双形式(`--name=value` 与 `--name value`,批 4a B-1 教训)。

### Task 1:templates 检测/下载/安装(TDD)
- `detectTemplatesDir(version)`:APPDATA(或平台等价)/Godot/export_templates/<ver>/;`isWebTemplatesInstalled(version)` 检 `templates/web_release.wasm`。
- `installExportTemplates(version, {confirm, onProgress})`:tpz 资产名 `Godot_v{v}-stable_export_templates.tpz` → buildReleaseUrls → 下载/SHA512 → extractZip 到临时 → 移入 export_templates/<ver>.stable/ → 审计(appendMachineAuditLine action=install_export_templates)→ 清理。
- 测试:目录推导(FAKE_HOME)/已装检测(mock 文件)/tpz 资产名构造;下载链不重复测(批 2 已锚)。

### Task 2:presets 生成 + headless 导出
- `ensureWebPreset(project)`:无 export_presets.cfg 则写最小 Web preset(name="Web", platform="Web", HTML 含载入 index.pck 的标准壳——直接生成 Godot 4 官方默认 export_presets.cfg 形态)。
- `exportWeb(project, godotPath)`:execFile(godot, ['--headless','--export-release','Web','--path',project]) 超时 300s;退出码非 0 → 抛错带 stderr 尾部;成功返回 build/web 目录(检测 index.html)。
- 测试:preset cfg 内容断言(含 name="Web"/platform="Web");spawn mock(成功/失败路径)。

### Task 3:静态服务器(TDD)
- `createWebServer(rootDir: string, port: number): Promise<{server, url}>`:http.createServer;sanitizeRequestPath(export,负向全拒);MIME 表;目录拒绝(仅文件);404;`listening` 后 resolve(url=`http://127.0.0.1:<port>/`)。
- 测试:200(html MIME)/404/穿越负向(`../`、`..\`、绝对、盘符、URL 编码 `%2e%2e`)返回 403;服务器测后 close。

### Task 4:CLI web 编排 + 真机端到端
- `runWeb(args)`(router + 'web'):findGodot → detectGodotVersion → templates 未装则确认+安装 → ensureWebPreset → exportWeb → 确认起服 → serve + 打印 URL(Ctrl+C 退出时 server.close);`--serve-only <dir>` 直接起服(已导出重玩)。
- **真机端到端**:2048 模板项目 → `web <proj> --port 8123` → curl `http://127.0.0.1:8123/index.html` 200 + pck/wasm 可取 → 负向穿越 403。(templates 4.7.2 ~1GB 首次下载,机器级留存)

### Task 5:文档 + 全量三连
- README/README.en 小白叙事(roadmap「浏览器试玩链接」转已支持)+ CHANGELOG + plan 落盘;lint/build/test 全绿。
