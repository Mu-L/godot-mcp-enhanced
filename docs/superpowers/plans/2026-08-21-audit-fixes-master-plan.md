# 2026-08-20 审查发现修复方案（master plan，四批）

> **For agentic workers:** 本方案是跨四批的总纲。执行时每批开独立会话,按本方案对应批次段落实施;批内任务粒度已到「文件 + 修法代码 + 测试 + 核查命令」级。步骤用 checkbox(`- [ ]`)跟踪。

**Goal:** 处置 2026-08-20 六个专项审查轮次登记的全部待修发现(1 P1 + 6 P2 + 10 P3/Nit)加 1 条批次挂账,恢复门禁余量、封掉 qa 假阳性/CLI 静默失效/披露误导三类可信度缺口。

**Architecture:** 按同文件/同验证方式聚类切四批——批 1 测试基建(纯 test/CI)、批 2 GD bridge 对称性(全在 mcp_bridge.gd,共用 check:gdscript + bridge 实测)、批 3 CLI 参数一致性(共享 helper 重构)、批 4 安全+隐私+杂项(小修集合清挂账)。四批互相独立,可任意顺序/并行推进;建议顺序 1→2→3→4(P1 止血优先)。

**Tech Stack:** TypeScript(ES2022/strict)、GDScript(Godot 4.5-4.7)、Vitest、GitHub Actions workflow。

## Global Constraints

- 提交前必跑:`npm run lint` + `npm run build` + `npm test` 全绿(AGENTS.md 完成前强制检查)。
- 改 `addons/**/*.gd` 或 `src/scripts/*.gd` 后必须跑 `npm run check:gdscript`(项目级完整编译,需 GODOT_PATH)——`validate_scripts` 有盲区不算数。
- **默认不发版**:不 bump 版本号、不加 README 版本行、变更进 CHANGELOG `[Unreleased]` 段。例外:若批次改动触发 `check-rules-version-bump.mjs` 硬门禁,按 AGENTS.md 2026-08-20 N-C 例外条款照常走 bump+version-sync+定版段(npm publish/tag 仍待用户)。
- 每批完成必须:第三方审查文档落 `docs/reviews/2026-08-21-<批名>.md`(code-reviewer 子代理)+ 登 memory + Obsidian 待办打勾(`D:\workspace\Obsidian\GodotMCP\项目待办.md` 对应条目)。
- 本方案所有行号已于 2026-08-21 用 grep/sed 实测;执行时若漂移以 grep 重定位为准。
- master 分支不开 commit,每批先开 `fix/audit-<批号>-<主题>` 分支。

## 背景:昨天审查产出全貌(2026-08-20)

**A. `docs/reviews/` 下 8 份批次审查报告——全部 SHIPPED,批内发现零遗留。**
仅 1 条明确挂账(并入本方案批 4):

- batch1 B-1 挂账:`src/tools/claudemd-builder.ts:95` 分发规则文本残留旧工具名 `capture_screenshot`(src/ 改动超批 1「近零代码」范围)。已 grep 实测仍在。

**B. Obsidian 待办登记的 6 个专项审查轮次——17 条未修发现**(本方案主体):

| 轮次 | 未修项 |
|---|---|
| 专项4 测试覆盖 | G-1 P1 弱断言门禁顶格 860/860、G-2 P2 e2e 无非空守门、G-3 P2 gif 命令层零测试、G-4 P3 mock 工厂无锚定、G-5 P3(验证类 defer)、S-1 可疑(defer)、S-2 记录不修 |
| 专项3 addons GD | 审查G-1 P2 数值分支漏类型防护、审查G-2 P3 深预检不对称、审查G-3 P3 可疑、G-Nit F-4/F-5 |
| 专项5 隐私第8轮 | 隐私P2 代理披露错误、隐私P3 CLI 下载链零披露、隐私Nit 行号漂移+笔误 |
| 专项1 安全第9轮 | 安全P3-1 NTFS ADS、安全P3-2 SVG 无 CSP、安全P3-3 realpath 缺失 |
| 通用版全维度 | 审查F-1 P2 init --template 空格形式、审查F-2 P3 参数解析四实现并存、审查F-3 P3 死赋值 |
| 专项2 可靠性 | P2 freeze 无 pending 守卫、P2可疑 端口竞态(验证类)、P3 in-flight 恒误报、P3可疑 keepalive 无熔断(验证类) |

---

## 批 1:测试基建批(P1 止血)

**分支**:`fix/audit-1-test-infra` | **预估**:0.5-1 天 | **文件面**:纯 `test/` + `.github/workflows/`,零 src 改动,不触发 matrix/rules 门禁。

### Task 1.1:弱断言还债,门禁 860→≤780(测试G-1 P1)

**问题**:`scripts/check-test-quality.mjs:211` 的 `WEAK_RE = /(\.toBeTruthy\(\)|\.toBeDefined\(\)|\.not\.toBeNull\(\))/g`,当前实测 **860 ≤ 上限 860 顶格零余量**(2026-08-21 实跑输出)。下一个含弱断言的 PR 必红线——已两次复发(2b4bc8c / f5e3a8e 各修一次),持续摩擦会诱发「临时调上限」失去防恶化语义。

**Files:**
- Modify: `test/` 下含弱断言的测试文件(执行时 grep 枚举)
- Modify(兜底,仅当还债后仍 >780): `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\scripts\check-test-quality.mjs`

**修法(还债为主,范式=f5e3a8e)**:

```ts
// 前(弱断言+依赖非空的后续访问)
expect(fm).toBeTruthy();
expect(fm![1]).toMatch(/^name: game-wizard$/m);

// 后(守卫式 throw——访问性前置显式失败,断言强度不降)
if (!fm) throw new Error('SKILL.md frontmatter 缺失(测试前置失败,非断言失败)');
expect(fm[1]).toMatch(/^name: game-wizard$/m);
```

**步骤**:
- [ ] `grep -rn "\.toBeTruthy()\|\.toBeDefined()\|\.not\.toBeNull()" test/ --include="*.ts" --include="*.js" | wc -l` 枚举基线(应 ≈860,与门禁计数口径核对)
- [ ] 逐文件分类:①后随 `x![...]`/`x!.xxx` 依赖非空访问的 → 改守卫式 throw(主还债面);②纯存在性语义且无后续访问的 → 评估改 `toBe(...)` 具体值/`toHaveLength`/`toContain` 等强断言;③语义上确属「存在即可」的少数保留
- [ ] 目标:`node scripts/check-test-quality.mjs` 输出 count ≤ 780(留 ≥80 预算)
- [ ] 若分类后仍 >780:实现豁免通道——WEAK_RE 命中行的**上一行**含 `// weak-ok` 注释则不计入(检测器逐行扫描时回看一行),并把保留的③类全加注;豁免通道实现本身须提交负向测试(带注释不计/不带计)
- [ ] `npm test` 全绿(改断言不许弄红任何测试——守卫 throw 只在原本就 fail 的场景触发)

**核查**:`node scripts/check-test-quality.mjs`(count 与 860 差值 ≥80)

> **执行偏移记录(2026-08-21 批 1 实况)**:实际走②类布尔表达式强化为主(113 处机械替换 + error-analyzer 15 处 hasErrors),①类守卫式 throw 未动——②类比①改动面更小(一行改写 vs 三行重构)、零访问前置风险,128 预算超 80 目标即止。分类快照(替换前 A120/B83/C657)与实际消除集合(128)的 8 处差值为 hasErrors 表达式在两类判定中的归属交叉,门禁口径以实测 732 为准。

### Task 1.2:e2e workflow 非空执行守门(测试G-2 P2)

**问题**:`editor-e2e.yml:75-105` 5 个 vitest 步骤与 `ci.yml:198-216` matrix e2e 步骤仅依赖 exit code;vitest 全 skip 返 exit 0 → fixture 供给链断掉时 daily 假绿数月无人察(C5 家族)。

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\.github\workflows\editor-e2e.yml`
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\.github\workflows\ci.yml`

**修法**(对齐 ci.yml:197 gdscript gate 范式,两 workflow 末尾各加):

```yaml
  # 测试G-2(审查):e2e 非空执行守门——vitest 全 skip 返 exit 0,fixture 断供时假绿数月;
  # 断言每份 JSON 报告 numTotalTests>0 且 skipped<total,否则本 job 红
  e2e-nonempty-gate:
    needs: [e2e]   # 按实际 job id 调整;ci.yml 侧挂在 matrix e2e 之后
    if: always()
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4   # json 报告以 artifact 上传的现状先核对;若已在本 job 内落盘则直接读
        with: { pattern: '*json-report*' , merge-multiple: true, path: reports}
      - name: gate
        run: |
          node -e "
            const fs=require('fs');
            const files=fs.readdirSync('reports').filter(f=>f.endsWith('.json'));
            if(files.length===0){console.error('no json reports found');process.exit(1);}
            for(const f of files){
              const r=JSON.parse(fs.readFileSync('reports/'+f,'utf8'));
              if(!(r.numTotalTests>0&&r.skipped<r.numTotalTests)){
                console.error('FAIL '+f+': tests='+r.numTotalTests+' skipped='+r.skipped);
                process.exit(1);
              }
            }
            console.log('all '+files.length+' reports non-empty');
          "
```

**注意**:执行时先读两 workflow 现状——若 JSON 报告未上传 artifact,在对应 vitest 步骤补 `if: always()` 上传,或把 gate 写成同 job 内步骤直接读工作区文件(更简,优先)。报告文件名/路径从 workflow 现有 `--reporter=json --outputFile=...` 参数实取,不猜。

- [ ] 读两 workflow,确定 json 报告落盘位置与 job 结构
- [ ] 加 gate(优先同 job 内步骤直读文件方案)
- [ ] 本地模拟验证:造一份 `{"numTotalTests":0}` 的 json 用同段 node -e 跑,断言 exit 1;`{"numTotalTests":5,"skipped":0}` 断言 exit 0

**核查**:`grep -n "numTotalTests" .github/workflows/editor-e2e.yml .github/workflows/ci.yml`(修后各 ≥1)

### Task 1.3:mock-results 工厂编译期锚定(测试G-4 P3,顺手)

**问题**:`test/helpers/mock-results.js:1` 仅 JSDoc 引用 `ExecuteGdscriptResult`,接口加/改字段时 22 个消费文件静默测旧契约无门禁。

**Files:**
- Rename/Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\helpers\mock-results.js` → `mock-results.ts`
- Modify: 22 个消费文件的 import 路径(执行时 grep 枚举)

**修法**:工厂返回值加 `satisfies ExecuteGdscriptResult`:

```ts
import type { ExecuteGdscriptResult } from '../../build/gdscript-executor.js';  // 路径按现有 JSDoc 指向实取

export function makeExecResult(overrides: Partial<ExecuteGdscriptResult> = {}): ExecuteGdscriptResult {
  return { success: true, output: '', ...overrides } satisfies ExecuteGdscriptResult;
}
```

- [ ] 改 .ts + satisfies;grep 枚举消费文件改 import(ESM 带扩展名,`.js`→`.ts` 按 vitest 解析实测)
- [ ] `npm run build` + `npm test` 全绿
- [ ] 反向验证锚定真生效:临时给工厂加接口外字段(如 `_probe: 1`)→ `npx tsc --noEmit -p tsconfig.json`(或跑 build)应红 → 撤销

**核查**:工厂故意加接口外字段 → tsc 红(执行时实测一次留证据)

### 批 1 defer 项(显式声明,不丢)

- **测试G-5**(bridge 游戏进程崩溃注入 e2e)与 **S-1**(非 PERSISTENT_SECRET editor 重生链):验证类,下批评估;S-2 已裁决记录不修。
- 端口竞态/keepalive 熔断两个「可疑」项归批 2/批 3 尾部验证任务。

---

## 批 2:GD bridge 对称性批

**分支**:`fix/audit-2-gd-symmetry` | **预估**:1-1.5 天 | **文件面**:`src/scripts/mcp_bridge.gd` 为主(注意:build/scripts/ 是产物,改源后 `npm run build` 同步)+ GD 测试套件。GD 侧 .gd 改动跑 `npm run check:gdscript` + bridge 真机。

### Task 2.1:_compare_values 数值分支类型白名单(审查G-1 P2)

**问题**(实测 `mcp_bridge.gd:2588-2590`):数值分支 `var t: float = float(target)` 裸转,而同函数 Vector 分支(:2606-2618)的 N-1 修复已加白名单。触发:`step_until {property:"position:x", op:">", value:"abc"}` → `float("abc")=0` → x>0 恒真 → 帧未到即 `predicate_met:true`,**qa 假阳性 PASSED**(比 N-1 修的假阴性更隐蔽)。

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\scripts\mcp_bridge.gd:2588-2590`
- Test: GD 套件(`test/fixtures/` 下 bridge GD 测试,执行时按现有 G1 套件文件落位)

**修法**:

```gdscript
	if actual is float or actual is int:
		# 审查G-1:数值分支对齐 Vector 分支的 N-1 白名单——target 非数值时 return false,
		# 防 String 条件值经 float() 静默按 0 比较(step_until 假阳性 predicate_met)
		if not (target is int or target is float):
			return false
		var a: float = float(actual)
		var t: float = float(target)
```

- [ ] 加白名单;`npm run build` 同步 build/scripts
- [ ] GD 负向用例:`value:"abc"` 断言 `predicate_met=false` + 正向回归(`value:5` 数值路径不受影响)
- [ ] `npm run check:gdscript` errors=0

**核查**:`grep -n "float(target)" src/scripts/mcp_bridge.gd`(修后数值分支应带守卫或无裸转)

### Task 2.2:freeze 入口 pending 守卫(可靠性 P2)

**问题**(实测 `mcp_bridge.gd:2424-2436`):`_cmd_control_freeze` 只查 owner 独占不查 pending 数组;对照 step 的 D-6 frozen 守卫与 unfreeze 的 D-1 清 pending,freeze 是三条 control 路径唯一无守卫的。开窗期间并发 freeze → paused=true 但 bridge PROCESS_MODE_ALWAYS 使 frame_counter 照走、事件照注入(游戏不消费)→ `success:true + applied 全 ok` **假成功**,qa 自动判定误判 PASSED。

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\scripts\mcp_bridge.gd:2424-2436`
- Test: G1 control GD 套件

**修法**(D-6 范式一行):

```gdscript
func _cmd_control_freeze(params: Dictionary, pid: int) -> Dictionary:
	# owner 独占:已有其他 owner 持有 → 拒(防多 peer 冲突)
	if _control_owner_pid != -1 and _control_owner_pid != pid:
		return {"error": {"code": -1, "message": "control layer held by another session (owner_pid=%d)" % _control_owner_pid}}
	# 可靠性审查:开窗期间 freeze 拒——PROCESS_MODE_ALWAYS 下 frame_counter 照走、事件照注入
	# (游戏不消费)→ 时间线假成功;对齐 step 的 D-6 frozen 守卫范式
	if not _control_input_seq_pending.is_empty() or not _control_step_until_pending.is_empty():
		return {"error": {"code": -1, "message": "control layer busy: input sequence / step_until in flight; finish or unfreeze-clear before freeze"}}
```

- [ ] 加守卫;GD 用例:开窗中 freeze 断言 error + 开窗外 freeze 断言 success(回归)
- [ ] 同步核查 H1 契约测试(`test/g1-playtest-control-contract*` 等)是否有 freeze 相关计数断言需更新——若「freeze 恰 N 处守卫」类契约存在,同步改

**核查**:`grep -n "in flight" src/scripts/mcp_bridge.gd`(修后 ≥1 新增)

### Task 2.3:send_input_sequence 深预检扩展 + 底层 button 语义(审查G-2 P3,与既有 open 项合并)

**问题**(实测 `mcp_bridge.gd:2538-2542`):深预检只盖 key/action;mouse_click 复用 `_cmd_send_mouse_click:1599` 的 `int(params.get("button",1))` 裸转——timeline 事件 `button:"left"` → int=0=MOUSE_BUTTON_NONE → 注入无效事件但返 `success:true`,`applied[].ok=true` 谎报。与 key 误传登记前拒形成 all-or-nothing 不对称。

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\scripts\mcp_bridge.gd`(深预检段 + `_cmd_send_mouse_click` button 解析)

**修法**(两处一起修,直接调用路径同享):

```gdscript
# 新增 helper(mouse 按钮值解析:int 1-9 直通 / left/right/middle 字符串映射,非法返 -1)
func _mouse_button_from_value(v: Variant) -> int:
	if v is int or v is float:
		var i := int(v)
		return i if i >= 1 and i <= 9 else -1
	if v is String:
		var m := {"left": 1, "right": 2, "middle": 3}
		return m.get(v.to_lower(), -1)
	return -1
```

`_cmd_send_mouse_click` 的 `int(params.get("button", 1))` 改经 `_mouse_button_from_value`(-1 时返结构化 error);深预检段追加:

```gdscript
		if t == "mouse_click":
			if _mouse_button_from_value(e.get("button", 1)) == -1:
				return {"error": {"code": -1, "message": "Invalid button: %s (at_frame=%d); use 1-9 or left/right/middle" % [str(e.get("button", 1)), at_f]}}
		if t == "touch" or t == "drag":
			var idx = e.get("index", 0)
			if not (idx is int or idx is float) or float(idx) < 0.0 or float(idx) != float(int(idx)):
				return {"error": {"code": -1, "message": "Invalid index: %s (at_frame=%d); must be non-negative integer" % [str(idx), at_f]}}
```

- [ ] helper + 两处接线;GD 用例:timeline `button:"left"` 断言不再谎报(注入后 button==1 生效,或预检拒误型)、`button:"abc"` 预检拒、`index:-1` 拒
- [ ] 真机 bridge 实测一次 send_mouse_click button:"left" 路径

**核查**:`grep -n "_mouse_button_from_value" src/scripts/mcp_bridge.gd`(修后 ≥3 处:定义+两消费)

### Task 2.4:isq_result 补 all_applied 字段(G-Nit F-4,顺手)

**问题**(`mcp_bridge.gd` isq_result 段 ≈:393):部分事件 ok:false 整体仍 `success:true`,调用方无法一眼区分全量/部分注入。

**修法**:响应追加字段(不动 success 语义,向后兼容):

```gdscript
	var all_applied: bool = true
	for r in applied:
		if not r.get("ok", false):
			all_applied = false
			break
	# 并入响应字典:"all_applied": all_applied
```

- [ ] 加字段;TS 侧 `src/tools/game-bridge.ts` 的 isq result 类型/qa runner 判定处按需消费(qa 已显式查 `success===false`,all_applied 供人工诊断,不改为硬判定)
- [ ] e2e/GD 用例:全 ok 断言 all_applied=true;含 fail 断言 false

### Task 2.5(验证后定):两个「可疑」项验证

- **审查G-3 可疑**(`_coerce_bridge_single:1500-1509` String 裸转 int/float):修法=String 走 `to_int()/to_float()`+回读校验(`str(v)==s` 或 `str(v)+".0"==s`)否则报错。低概率(依赖客户端违反签名类型)——**顺手修**(几行),不修则文档标注现状。
- **端口竞态可疑**(`_bind_available_port:491-533` 探测→listen 非原子):**先实测再定**——双项目同瞬 spawn ×100 统计双占率;>0 才修(如 listen 失败重试下一端口),=0 则记录数据关闭项。验证脚本不留库,证据进审查文档。

### 批 2 收尾

- [ ] `npm run lint` + `npm run build` + `npm test` + `npm run check:gdscript` 全绿
- [ ] bridge 真机:G1 control 套件 + input_sequence 套件复跑(参考 H1 批的 e2e 命令)
- [ ] 审查文档 + memory + Obsidian 待办打勾

---

## 批 3:CLI 参数一致性批

**分支**:`fix/audit-3-cli-args` | **预估**:1 天 | **文件面**:`src/cli/`(args.ts 新建 + gif/init/skills/qa/web 改造)+ `test/cli-args.test.ts` 新建。**注意**:cli 不在 TOOL_GROUPS,不触发 matrix;但 README 中 CLI 用法示例若涉及需同步(本批修的是解析层,示例语义不变则不动)。

### Task 3.1:共享双形式 helper(审查F-2 P3 根治 + F-1 P2 + 测试G-3 P2 随之闭环)

**问题**(实测):init.ts:9 只认 `--template=` 等号 → `init mygame --template 2048` 空格形式静默落默认 'empty'(合法值,B-1 报错守卫不触发,**静默产出空骨架零报错**);skills.ts:90 `indexOf('--target')` 不中 → 静默装用户级目录;qa.ts:72 parseFlag 空格-only;web/gif 已双形式(各自内嵌)。四种实现并存,批 4a 教训只修了 gif 自身未回扫。

**Files:**
- Create: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\cli\args.ts`
- Modify: `src/cli/gif.ts`(删内嵌 opt/num 改 import)、`src/cli/init.ts:6-13`、`src/cli/skills.ts:89-97`、`src/cli/qa.ts:72` 附近、`src/cli/web.ts`(若有内嵌同款)
- Create: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\cli-args.test.ts`

**修法**:

```ts
/** CLI 参数解析共享 helper — 双形式(--name=value 与 --name value)统一。
 *  源起审查F-2:四种实现并存,单形式解析致参数静默回落默认值(批 4a B-1 同族)。 */

export function opt(args: string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === `--${name}`) return args[i + 1];
    if (a.startsWith(`--${name}=`)) return a.split('=').slice(1).join('=');
  }
  return undefined;
}

export function hasFlag(args: string[], name: string): boolean {
  return args.some(a => a === `--${name}` || a.startsWith(`--${name}=`));
}

/** 数值参数:非数字 exit 2;range 给定时钳制。 */
export function num(args: string[], name: string, fallback: number, range?: [number, number]): number {
  const v = opt(args, name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    console.error(`--${name} 需要数字,收到 "${v}"`);
    process.exit(2);
  }
  return range ? Math.max(range[0], Math.min(range[1], n)) : n;
}
```

各命令改造要点:
- **init.ts**:`parseInitArgs` 改用 `opt(args,'template')`——空格/等号双形式都落到 template 变量,未知模板仍走批 3 B-1 显式报错守卫
- **skills.ts**:`const explicitTarget = hasFlag(args,'target') ? opt(args,'target') : undefined;` 保留「flag 传了但值缺失」的显式报错(opt 返回 undefined 而 hasFlag 为 true 时 exit 1,语义同现状)
- **gif.ts**:内嵌 opt/num 删除改 import(行为等价,`num` 的钳制调用点改为传 range 参数 `num(args,'fps',4,[1,10])`)
- **qa.ts / web.ts**:parseFlag/内嵌同款逐一对齐

**测试**(test/cli-args.test.ts,同时闭环测试G-3「gif 命令层零测试」):

```ts
// 双形式矩阵:opt(['--fps','5'],'fps')==='5' 且 opt(['--fps=5'],'fps')==='5'
// 相邻消费:opt(['--out','a','--fps'],'out')==='a'(无值 flag 不吞后续)
// num 钳制:num(['--fps','0'],'fps',4,[1,10])===1;num(['--fps','11'],...)===10
// num 非法:num(['--fps','abc'],...) → process.exit 2(spy 断言,批 3 B-1 init 同款模式)
// init 集成:parseInitArgs(['x','--template','2048']).template==='2048'(F-1 主张)
// skills 集成:--target=/path 与 --target /path 两形式都取到显式目录(不再静默回落用户级)
// gif keys:opt('keys') 逗号 split/trim/lowercase 逻辑(留在 gif 层测或提取到 args.ts)
```

- [ ] 建 args.ts + 五命令改造 + 测试矩阵
- [ ] 真机:`node build/cli/index.js init t1 --template 2048` 断言四件套落盘(非空骨架);`gif --keys left,right` 空格形式生效(批 4a B-1 回归场景)

**核查**:`grep -rn "parseGifArgs\|runGif\|cli/args" test/` ≥1 文件;`node scripts/check-test-quality.mjs` 仍绿(新测试用强断言)

### Task 3.2:in-flight 检测恒误报修复(可靠性 P3)

**问题**(实测 `game-bridge.ts:466`):`!(_sendLock === Promise.resolve())` 引用比较在首次请求后恒不等 → 每次 setBridgeProjectDir 都误报 warn,监控价值归零。

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\game-bridge.ts`(模块级计数器 + sendToBridge 入口/finally)

**修法**:

```ts
let _sendInflight = 0;
// sendToBridge 获取 _sendLock 后入口 _sendInflight++,finally 里 --
// setBridgeProjectDir 处:
const inflightDetected = _sendInflight > 0;
```

- [ ] 计数器接线;单测:模拟 in-flight 期间 setBridgeProjectDir 断言 warn 一次、静止时零 warn(现状是恒 warn)

**核查**:`grep -n "inflightDetected" src/tools/game-bridge.ts`(修后引用计数器非 Promise 比较)

### Task 3.3(验证后定):keepalive 熔断(可靠性 P3 可疑)

**验证**:模拟「A 项目游戏停 + B 项目占同端口」场景(或单测层 mock ping 恒失败),确认 30s×N 无限失败循环现状;**修法**(验证成立才做):keepalive catch 里连续失败计数,≥10 次 `_stopKeepalive()` + warn「bridge 疑似被其他项目占用,keepalive 已停;业务调用将触发重连」——业务路径 sendToBridge 重连不受影响(keepalive 仅探测)。

### 批 3 收尾

- [ ] `npm run lint` + `npm run build` + `npm test` 全绿 + 真机 init/gif 双形式冒烟
- [ ] 审查文档 + memory + Obsidian 待办打勾

---

## 批 4:安全 + 隐私 + 杂项清挂账批

**分支**:`fix/audit-4-security-privacy-misc` | **预估**:0.5-1 天 | **文件面**:`src/cli/zip-extract.ts`、`src/cli/web-server.ts`、`src/tools/qa/report.ts`、`docs/telemetry.md`、`README.md`/`README.en.md`、`src/tools/claudemd-builder.ts`。

### Task 4.1:zip-extract 拒 NTFS ADS(安全P3-1)

**问题**(实测 `zip-extract.ts:33-49`):`assertSafeEntryName` 的盘符正则只认 `^[a-zA-Z]:` 行首形态,`foo.txt:ads` 基名中冒号不拦——win32 `writeFileSync` 落 NTFS 交替数据流=经典恶意载荷藏匿位。可触发性边缘(两调用方 SHA512 前置),但纵深应对齐。

**修法**(WINDOWS_RESERVED 检查后追加):

```ts
  // 安全P3-1:NTFS 交替数据流形态(foo.txt:ads)——win32 合法文件名不含冒号,
  // 基名含 : 落盘即 ADS 隐藏流
  if (base.includes(':')) {
    throw new InternalError(`zip entry NTFS alternate data stream: ${name}`);
  }
```

注:盘符形态已被上游 `^[a-zA-Z]:` 拒且那是整路径级;base 是最后一段,含冒号在 win32 必非法、POSIX 上此形态也不该来自官方 zip——无条件拒。

- [ ] 加校验 + 负向用例(`foo.txt:ads`/`foo:bar` 断言 throw)+ 正向回归(现有 8 用例含 zip64 不红)

**核查**:`grep -n "alternate data stream" src/cli/zip-extract.ts`

### Task 4.2:web serve 的 SVG 响应加 CSP(安全P3-2,修正待办草案技术错误)

**⚠️ 修正声明**:待办原修法「响应头统一加 `default-src 'none'`(godot web 导出不需要脚本不影响试玩)」**技术上有误**——Godot Web 导出的 index.html 必须加载同源 .js/.wasm,统一 CSP 会直接弄坏试玩主路径。本方案修正为:**仅对 `image/svg+xml` 响应加 CSP**(SVG 是唯一内嵌脚本执行媒介;作为 `<img>` 加载时本就不执行脚本,CSP 只封「直接导航 SVG URL」的同源执行面)。

**问题**(实测 `web-server.ts:94-98`):MIME 表含 image/svg+xml(:21)且响应头无 Content-Security-Policy——直接导航 SVG URL,内嵌脚本在 127.0.0.1 origin 执行可同源 XHR 读 serve 目录;`--serve-only` 指向含不可信 SVG 目录时成面。

**修法**:

```ts
      const mime = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
      const headers: Record<string, string> = {
        'content-type': mime,
        'content-length': String(stat.size),
        'cache-control': 'no-store',
      };
      // 安全P3-2:仅 SVG 响应加 CSP,封「直接导航 SVG URL」的同源脚本执行面;
      // godot 导出产物(index.html/js/wasm)不加,统一 CSP 会断试玩脚本加载
      if (mime === 'image/svg+xml') {
        headers['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'";
      }
      res.writeHead(200, headers);
```

(style-src 'unsafe-inline' 保 SVG 内联样式渲染正常;无脚本许可。)

- [ ] 改造 + 真机:`web --serve-only` 指向含测试 SVG 的目录,断言 GET .svg 响应头含 CSP、GET index.html 无 CSP、试玩路径 200 正常
- [ ] 单测:headers 分支两形态

**核查**:`grep -n "content-security-policy" src/cli/web-server.ts`(≥1)

### Task 4.3:qa readReport 过 realpath(安全P3-3)

**问题**(实测 `report.ts:133-135`):`resolve(ref)` 仅字符串 startsWith 比对——qa-reports 内预置 symlink 指向外部文件可绕读任意 JSON。

**修法**:

```ts
  let full: string;
  if (isAbsolute(ref) || ref.includes('/') || ref.includes('\\')) {
    // 安全P3-3:前缀检查前先过 realpath(symlink 指向外部可绕读);dir 同步 realpath 对称
    const realDir = realpathSync(dir);
    let real: string;
    try {
      real = realpathSync(resolve(ref));
    } catch {
      throw new Error(`report_path 不存在或不可解析: ${ref}`);
    }
    if (!(real === realDir || real.startsWith(realDir + sep))) {
      throw new Error(`report_path 必须位于 ${dir} 内（拒绝任意路径读取）: ${ref}`);
    }
    full = real;
```

- [ ] 改造 + 负向用例(tmpdir 内建 symlink 指向外部 json,断言 throw;现有正路径回归)

**核查**:`grep -n "realpath" src/tools/qa/report.ts`(修前 0,修后 ≥2)

### Task 4.4:隐私披露修正(隐私P2 + P3 + Nit,纯文档)

**P2**(实测 `docs/telemetry.md:132-134` + `README.md:142` + `README.en.md:137`):声称「fetch 遵守 HTTP_PROXY/NO_PROXY(Node 默认 trustEnv)」——实测 Node v24.14.0 设 HTTP_PROXY 指向必拒端口后 fetch registry.npmjs.org 仍直连 200(undici 默认不读环境代理变量,≥24 需 NODE_USE_ENV_PROXY=1)。**方向是「声称有遮蔽手段实际没有」**:企业代理用户预期经代理实际直连静默失败;隐私敏感用户以为 NO_PROXY 可阻断。

修法(三处):telemetry.md「代理环境变量遵守」段改为实测口径——

```markdown
### 代理环境变量(实测:Node 原生 fetch 默认不读)

> **实测(v0.32.8,Node v24)**:Node 原生 fetch(undici)**默认不读** `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` 环境变量(Node ≥24 可设 `NODE_USE_ENV_PROXY=1` 启用)。因此:
> (1) 企业强制代理环境下更新检查**实际直连**(可能被防火墙静默拦截,表现为更新检查无响应);
> (2) **`NO_PROXY` 不能作为零外传手段**。严格零外传的有效手段:防火墙规则、`GODOT_MCP_UPDATE_CHECK=false`(self_update 的 check action 不受此门控,见上)、readOnly 模式拒整工具。
```

README.md:142/README.en.md:137 同步一句话口径。

**P3**:telemetry.md 增「非 telemetry 外传点:CLI 下载链」段——`godot-mcp-enhanced install`(godot-installer.ts:100/:102/:122,api.github.com + 自定义 UA `godot-mcp-enhanced-installer`)与 `web`(web-exporter.ts:69-80 复用同链);触发=用户主动执行(y/N 确认);域名白名单+SHA512 同源校验;审计仅本机;`GODOT_MCP_INSTALL_TAG` 可 pin。README 补一句指向。

**Nit**:telemetry.md:102/:105 的 `src/index.ts:125-133` 行号漂移(实际 :152-153,执行时 grep 重定位);`ToolDispatcher.ts:501` 注释 `~/.godot/mcp/` 笔误改 `~/.godot-mcp/`。

- [ ] 三文档改完;`grep -n "NO_PROXY" docs/telemetry.md README.md README.en.md` 复核口径统一;`grep -c "github\|GitHub" docs/telemetry.md`(修后 ≥1)

### Task 4.5:杂项三连(F-3 死赋值 + claudemd-builder 旧名 + CHANGELOG)

- **F-3**(实测 `zip-extract.ts:99` 尾部 `q += 8` 后即 return):删该赋值或改注释说明;`npm run lint` 恢复 0 warning。
- **claudemd-builder.ts:95**(实测):`- capture_screenshot 为实验性功能（headless 模式下渲染受限）` → `- screenshot（action capture）为实验性功能（headless 模式下渲染受限）`。改后必跑 `npm run build` + `STRICT=1 npm run check:rules-sync` + `node scripts/check-rules-version-bump.mjs` 确认不触发 bump(claudemd-builder 不在规则模板清单,预期不触发;若触发按 N-C 例外条款走)。
- **CHANGELOG**:四批共用一个 `[Unreleased]` 修复段或每批各记(执行时按当批实际改动写)。

### 批 4 收尾

- [ ] `npm run lint`(0 warning)+ `npm run build` + `npm test` + rules-sync/version-bump 门禁复核
- [ ] web serve 真机三断言(SVG CSP/index.html 无 CSP/试玩 200)
- [ ] 审查文档 + memory + Obsidian 待办打勾;反馈文件 `D:\workspace\Obsidian\GodotMCP\插件反馈与改进建议.md` 视门槛规则按需

---

## defer/不修清单(汇总,防丢)

| 项 | 处置 | 理由 |
|---|---|---|
| 测试G-5 bridge 崩溃注入 e2e | defer 下批 | 与 keepalive 熔断合并评估更划算 |
| 测试S-1 非 PERSISTENT_SECRET 重生链 | defer 验证 | 先验证 mock 层覆盖深度,浅则补 |
| 测试S-2 installGodot 编排零单测 | 记录不修 | 纯顺序调用,风险低(已裁决) |
| G-Nit F-5 snapshot /root/ 前缀启发式 | 不修 | 极窄诚实边界,注释已标注 |
| 端口竞态(可疑) | 批 2 验证任务 | 实测双占率>0 才修 |
| keepalive 熔断(可疑) | 批 3 验证任务 | 验证成立才修 |
| npm publish 0.32.8 / demo gif 录制 / C-3 赞助 | 待用户动作 | 非代码修复项 |
| 竞品触发器复查 | 定期观察 | 2026-08-20 已记观察条件 |

## 批次间依赖与并行性

四批文件面互不重叠(批 1:test/+workflows;批 2:mcp_bridge.gd+GD 套件;批 3:src/cli/+game-bridge.ts;批 4:zip/web/report/文档),可并行开四个会话推进;唯一软依赖:批 1 的 G-1 还债先做可避免后续三批新增测试触碰 860 红线(批 2/3 都要加测试)——**建议批 1 最先合入**。
