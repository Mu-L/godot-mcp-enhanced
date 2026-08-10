# 第三方审查:doctor 加 addons 同步检查(项目待办 :150)

**审查日期**:2026-08-10
**审查对象**:2 个文件改动(未提交)
**审查者**:code-reviewer 子 agent(所有声明 grep/read 实测)

## 总体判定:**SHIPPED WITH NITS**(0 Blocking + 5 Nit,其中 3 Nit 已当场修复)

核心功能正确,上游定位双场景成立,测试覆盖扎实。审查发现 5 个 Nit,当场修复了其中 2 个功能性问题(Nit #1 CRLF 误报 + Nit #2 视觉标记),并顺带修了 Nit #3(extra 展示)。

## 改动摘要

给 `godot-mcp-enhanced doctor` 加 "Addons sync" 检查区块:对比**上游包 addons/godot_mcp_server**(用 router.ts:6 的 `__rootDir` 模式定位)与**目标项目 cwd/addons/godot_mcp_server** 的文件清单和内容。不同步时 warn(不 fail)。帮用户发现"GD 改了但目标项目 addons stale 致改了没生效"。

## 逐维度核实

### 1. 设计正确性 — PASS
- `compareAddons`(:37-59)的 missing/differing/extra 分类逻辑正确(upstream set vs target set 对比)
- `inSync` 判定(:55)`missing.length===0 && differing.length===0`,extra 不影响(用户自定义脚本不算不同步)
- 内容对比 `readFileSync + ===` 对文本文件可靠(addons 35 文件全是 .gd/.cfg/.tscn)
- POSIX 路径归一(:38-39)`relative().replace(/\\/g,'/')` 跨平台正确
- differing 排序(:53)保证输出稳定

### 2. 上游 addons 定位 — PASS(双场景)
`doctor.ts:75-77` 用 `dirname(fileURLToPath(import.meta.url))` 从 build/cli/doctor.js 回溯包根,与 router.ts:5-6 一致。实测:
- 开发场景:回溯到仓库根 → addons 存在(Glob 实测 35 文件)
- 用户场景:`package.json:25` files 字段含 `"addons"`,npm 包带 addons

### 3. 边界处理 — PASS
- 目标项目无 addon → skip(Claude Desktop 不装 addon 是常态,集成测试覆盖)
- 上游不存在 → skip(防御性,Nit #4 留测试)
- warn 不 fail(符合待办 :150 "warn" 语义)
- symlink 跳过(listAddonFiles B6,对齐 check-gdscript.ts:42)

### 4. 测试质量 — PASS(修复后)
5 纯函数 + 1 CRLF(新增)+ 2 集成 = 8 新测试。覆盖:in sync / missing / differing / extra / symlink skip / CRLF 归一 / OUT OF SYNC 集成 / skip 集成。

### 5. 仓库级约束 — PASS
import 全用无未用;不破坏现有 5 个 doctor 区块;listAddonFiles vs check-gdscript listGd 语义不同(全文件 vs 仅 .gd),重写合理。

### 6. 验证完整性 — PASS(实测)
| 项 | 结果 |
|---|---|
| `npm run lint` | 0 error |
| `npm run build` | tsc strict 0 error |
| `npm test` | **4863 passed / 0 failed**(+8 新测试) |
| `node build/index.js doctor` | `✓ addons/godot_mcp_server in sync (35 files)`(35 文件实测正确) |

## Nits

### Nit #1 — CRLF false positive(已修复)
**问题**:仓库 `.gitattributes` 强制 LF,但目标项目不受管辖,Windows 用户 cp/编辑器写回可能 CRLF。字节级 `===` 会误报 differing。
**修复**:`doctor.ts:48-50` 内容比较前 `replace(/\r\n/g, '\n')` 归一。加测试 `treats CRLF vs LF as in sync`(:208-220)验证修复。

### Nit #2 — ✗ 视觉标记与 warn 语义不一致(已修复)
**问题**:`status(false, ...)` 用 `✗` 标记,但 OUT OF SYNC 时 hasError 不置 true(exit 0),✗ 暗示 error 误导用户。
**修复**:新加 `warn(msg)` 函数用 `!` 标记,OUT OF SYNC 输出改用 `warn` + 注明 `non-blocking`。

### Nit #3 — extra 收集了但不展示(已修复)
**修复**:OUT OF SYNC 摘要行加 `extra` 计数:`(N missing, N modified, N extra)`。

### Nit #4 — 上游不可达 skip 分支无测试(留 follow-up)
`doctor.ts:129-130` 的 `!existsSync(UPSTREAM_ADDON)` 分支无测试覆盖。需 mock fs,优先级低。

### Nit #5 — listAddonFiles vs listGd 结构重复(不处理)
两函数骨架相同仅 filter 不同,跨子系统(cli/ vs scoring/)提取公共 helper 收益有限。按简约至上不处理。

## memory 教训
1. **行尾归一是跨项目内容比较的隐式前提**:仓库 `.gitattributes eol=lf` 只约束本仓库,跨项目字节级比较(`===`)需先归一 `\r\n`→`\n`,否则 Windows 用户场景 false positive。
2. **warn 语义与视觉标记须一致**:布尔驱动的 ✓/✗ 标记在"warn 不 fail"场景会视觉误导(✗ 暗示 error 但 exit 0)。warn 应用独立标记(`!`)或注明 non-blocking。

## 验证
- lint 0 / build 0 / test 4863 passed(+8 新) / 手动 doctor 输出 `in sync (35 files)`
