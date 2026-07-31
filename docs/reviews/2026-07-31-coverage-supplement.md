# 第三方审查：补覆盖批次（scene-instance detach + tscn-editor-shared）

> 审查者：code-reviewer 子 agent（隔离视角，所有声明 grep/read 实测）
> 审查日期：2026-07-31
> 审查对象：`2389587 test(scene): 补 handleDetachInstance 分支覆盖` + `d2c4096 test(tscn): 补 tscn-editor-shared 纯函数覆盖`
> 落盘说明：审查者无 Write 权限，由主 agent 代为落盘，内容为审查者完整报告原样

## 总体判定

**SHIPPED**

两 commit 的核心声明经 grep/read 实测均成立：用例数与声明一致（7 + 20），断言均对准真实代码路径而非恒真，fixture 真能触发各声明分支。无 Blocking / Nit 阻塞项。

---

## 逐维度结论（带 file:line 证据）

### 1. scene-instance handleDetachInstance 测试质量（2389587）— 通过

逐条核对 `src/tools/scene/scene-instance.ts:209-279` 与 `test/scene-instance-detach.test.ts`：

| 用例 | 声明分支 | 实测验证 |
|------|---------|---------|
| 缺 project_path (:56) | MISSING_PARAM :210 | ✓ `!args.project_path` 短路，断言 `toContain('project_path')` |
| 缺 scene_path (:61) | MISSING_PARAM :211 | ✓ 同上 |
| 缺 node_path (:66) | MISSING_PARAM :212 | ✓ 同上 |
| 场景不存在 (:71) | "not found" :217-219 | ✓ `existsSync` false → `textResult(... not found)` |
| 节点非实例 (:80) | NOT_AN_INSTANCE :239-241 | ✓ **见下专门核验** |
| 源场景不存在 (:90) | "Source scene not found" :250-252 | ✓ TARGET_TSCN 有 `path="res://scenes/player.tscn"` 但故意不写文件 → `existsSync(sourceAbsPath)` false |
| happy path (:101) | "Detached instance" :278 + 文件真改 | ✓ **见下专门核验** |

**"节点非实例" 用例关键核验**（声明为最易自证的陷阱点）：
- `nodePathToNameAndParent('Main')` → `p='Main'`，不以 `/` 开头、非 'root'、非 'root/' 前缀 → `parts=['Main']`，`nodeName='Main'`，`parent='.'`（`tscn-editor-detach.ts:66-77`，无 throw）
- `findInstanceNode(NO_INSTANCE_TSCN, 'Main', '.')`：`[node name="Main" type="Node2D"]` name 匹配；`parentMatch=null` → `lineParent='.'`；`tscnParent=parentToTscnParent('.')='.'`（`tscn-editor-detach.ts:49-50`）→ 匹配；但 `instanceMatch` 为 null（无 `instance=ExtResource`）→ continue → 返回 null（`tscn-editor-detach.ts:106-107, 128`）
- `info=null` → `opsErrorResult('NOT_AN_INSTANCE', ...)`（scene-instance.ts:240）→ 断言 `toContain('NOT_AN_INSTANCE')` 命中
- 确实真打到 :239-241 分支，非误命中更早分支。

**happy path 行为核验**（声明为非 mock 自证）：
- 断言 `updated.not.toContain('instance=ExtResource')` + `toContain('position = Vector2(100, 200)')` 是对实际文件内容的 readFileSync 检查（test:112-114）
- `detachInstance`（`tscn-editor-detach.ts:377`）真删 `instance=ExtResource("N")`；源 Player 无 position/visible → 两 override 被 push（:432-434）；写回文件（scene-instance.ts:270-271 经 tmp+rename）
- 这是真行为断言，非 mock 自证。

**ALLOWED_PROJECT_PATHS 放行核验**：
- beforeEach 设 `process.env.ALLOWED_PROJECT_PATHS = projectDir`（test:45），afterEach 还原 `origAllowed`（test:52）无泄漏
- `getAllowedProjectPaths()`（path-utils.ts:234-238）读 env 并 split(';')；`isPathInAllowedRoots(projectDir)`（path-utils.ts:258-）对新建 tmpdir realpath 后精确匹配 allowlist 条目 → 通过；`requireProjectPath`（helpers.ts:110-116）不 throw
- `resolveWithinRoot(projectDir, 'scenes/main.tscn')`（path-utils.ts:154-188）相对根无 `..` 段 → 通过，返回 `<projectDir>/scenes/main.tscn`

### 2. tscn-editor-shared 纯函数测试质量（d2c4096）— 通过

`test/tscn-editor-shared.test.ts` 末尾追加 7 个 describe 共 20 个 `it`，与 `src/tscn/tscn-editor-shared.ts` 实现逐条核对：

| describe | it 数 | 抽查核对 |
|----------|------|---------|
| escapeTscnValue (:85) | 3 | ✓ `:64` 实现 `\`→`\\`、`"`→`\"`、`]`→`\]`、`[`→`\[`；换行 throw（:63）— 与断言一致 |
| escapeRegExp (:101) | 2 | ✓ `escapeRegExp('a.b*c')` 对 `/[.*+?^${}()\|[\]\\]/g`（:69）：`.` 和 `*` 命中 → `a\.b\*c`；`escapeRegExp('a(b)c')` → `a\(b\)c` — 精确匹配 |
| normalizeLines (:111) | 3 | ✓ `:15` `replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n')` — CRLF/CR/LF 三分支真覆盖 |
| findSectionEnd (:123) | 2 | ✓ `:19-25` 从 startLine+1 找首字符 `[` 的行；末段返 `lines.length`。fixture `[A,prop1,B,prop2]`：从 0→2，从 2→4 — 精确 |
| leafName/parentPath (:134) | 2 | ✓ `:81-90`；`leafName('Root/Player/Sprite2D')='Sprite2D'`；`parentPath('Alone')=''`（parts.length===1）— 精确 |
| getBracketAttr (:145) | 3 | ✓ `:73-78`；属性不存在 → `m=null` → 返 null（:77），断言 `toBeNull()` 命中 |
| findNodeSectionLine (:157) | 5 | ✓ **见下专门核验** |

**findNodeSectionLine 5 用例逐条核验**（fixture 见 test:158-164，lines[0]=Main 无 parent / lines[2]=Player parent="." / lines[4]=Sprite parent="Player"）：
- `'Main'`：`targetName='Main'`, `targetParent=''`（parentPath 单段返空）。lines[0] name 匹配，targetParent 空 → `getBracketAttr('parent')=null` → `p===null` 返 0（`tscn-editor-shared.ts:109-111`）。✓ 预期 0
- `'./Player'`：`leafName('./Player')='Player'`（split '/' 末段），`parentPath('./Player')='.'`（两段 slice(0,-1).join='.'）。lines[2] name 匹配，`inlineParent='.'===targetParent='.'` → 返 2（:116-117）。✓ 预期 2
- `'Player/Sprite'`：targetParent='Player'。lines[4] name='Sprite', inlineParent='Player' → 返 4。✓
- `'Nonexistent'`：全循环不命中 → 返 -1（:129）。✓
- `'Wrong/Player'`：targetName='Player', targetParent='Wrong'。lines[2] name='Player' 匹配但 inlineParent='.' ≠ 'Wrong'；下方 :120-127 扫属性行无 `parent = ` 开头 → continue → 返 -1。✓

断言全部具体（非恒真），fixture 结构与各分支对应。

### 3. 仓库级约束 + 验证完整性 — 通过（部分未实测）

- **两 commit 纯测试加固**：审查对象两文件均在 `test/` 目录，`src/` 下读取的 `scene-instance.ts` / `tscn-editor-detach.ts` / `tscn-editor-shared.ts` / `path-utils.ts` / `helpers.ts` 均为既有实现，未发现本次 commit 改动痕迹。**但未能实测 git diff**（环境无 Bash），此点为 read-based 推断，标注未实测。
- **数学一致性**：7 + 20 = 27 = 新增 `it` 数（实测两文件 it 块计数确认）；4326 + 27 = 4353 与 commit message 声明一致。✓
- **vitest include 覆盖**：`vitest.config.ts:8` `include: ['test/**/*.test.{js,ts}']`，两文件均匹配，会被实际执行。✓
- **capability-matrix / rule-templates 同步**：`docs/capability-matrix.{md,json}` 与 `src/tools/rule-templates.ts` 是工具能力级产物，纯测试补覆盖不改任何工具签名/行为，**不应触发同步**。✓
- **"npm test 296 文件 4353 passed"**：无法实测，标注未实测。

---

## Blocking Issues

无。

---

## Nits

无达到报告阈值的项。以下为低于阈值的观察（confidence < 80，仅供参考）：

- happy path 断言未校验 success message 中的 override 计数（`Detached instance "Player" — inlined from res://scenes/player.tscn (2 property override(s) preserved)`）。当前 TARGET_TSCN 真值是 2，可加 `toContain('2 property override')` 强化数字断言，但非必要（confidence ~40）。
- `scene-instance-detach.test.ts` 注释（:11）原称"复用 test/tscn-editor.test.js 的 fixture"，实际是就地重声明常量，措辞略误导。**已由主 agent 在审查后修正**为"结构对齐...就地重声明避免跨文件 import"（confidence ~30）。
- handleDetachInstance 的 `INVALID_PARAM` 分支（:227-229，nodePathToNameAndParent throw 'Cannot detach the root node'）与写入失败分支（:272-276）未单独覆盖，但 commit 范围声明为"补各错误分支 + happy path"，未声称穷尽，不算漏报（confidence ~25）。

---

## 值得进 memory 的工程教训

**"fixture 路径-分支对应表"是审查 tscn 解析类测试的有效手段**。`findNodeSectionLine` 的 5 用例之所以可信，在于 fixture（lines[0/2/4] 三种 parent 形态：无/`.`/具名）与实现分支（`:109-111` 空 parent / `:116-117` inline parent / `:120-127` 属性行 parent）一一对应，且第 5 用例专门构造"name 匹配但 parent 不匹配"的负向用例锁死 continue 分支。审查此类纯函数测试时，先读 fixture 结构、再逆推它能命中的分支集合，比逐条读断言更高效。

---

## 相关文件（绝对路径）

- `D:\GitHub\godot-mcp-enhanced\test\scene-instance-detach.test.ts`
- `D:\GitHub\godot-mcp-enhanced\test\tscn-editor-shared.test.ts`
- `D:\GitHub\godot-mcp-enhanced\src\tools\scene\scene-instance.ts`（:209-279）
- `D:\GitHub\godot-mcp-enhanced\src\tscn\tscn-editor-shared.ts`
- `D:\GitHub\godot-mcp-enhanced\src\tscn\tscn-editor-detach.ts`（findInstanceNode / detachInstance / parentToTscnParent）

## 诚实声明

审查者无 Bash 环境，**未能实测**：`git show`/`git diff` 确认两 commit 实际 diff scope（"纯测试无 src/ 改动"为 read 推断）；`npm test` 实际跑测结果（4353 passed 为数学推断）。已实测：所有源码与测试文件内容、分支可达性、fixture↔实现映射、数学一致性、vitest include 覆盖。

---

## 主 agent 门禁复跑确认（2026-07-31）

主 agent（有 Bash）已实测复跑三件套，补充审查者未能实测维度：

| 门禁 | 结果 | 验证命令 |
|------|------|---------|
| ESLint | ✅ 通过（src/ 零警告） | `npm run lint` |
| TypeScript 编译 | ✅ 通过（strict 零错误） | `npm run build` |
| Vitest | ✅ **296 文件 / 4353 用例 passed**（24 skipped，+27 用例 = 7 detach + 20 shared） | `npm test` |

审查者所有静态推断与主 agent 实测结果一致，无出入。
