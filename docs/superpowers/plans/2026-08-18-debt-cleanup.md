# 债务清理小批实施计划(草稿——待 PR#37 merge 后转正到 docs/superpowers/plans/)

> 基线:PR#37 merge 后 master。分支:feat/debt-cleanup-20260818。SDD 惯例照 PR-1~4。
> 调研完成于 2026-08-18 本会话,所有根因/真值已实测(见各 task 引用数据)。

**Goal**:清偿跨批挂账——screenshot_capture.gd 采样退化(生产 bug 级)+ T3c gdEscape 字面量误用(含 PR-4 继承点)+ PR-4 五项 Minor + README 正文口径漂移 + spec §10.5 两决策输入落答;版本 0.32.5。

**Global Constraints**:
- 改 `src/scripts/screenshot_capture.gd` 后必须 `npm run check:gdscript`(项目级完整编译,fixture 副本自动同步,git-ignored)+ `npm run build`(build/scripts 拷贝)。
- 不动:双副本规则段(本批预期无规则变更)、`src/screenshot.ts`/TS 侧 F1 双条件拦截(语义不变,.gd 修复只是减少 stdout 假 BLANK hint 源头)。
- 门禁:lint/build/npm test/check:gdscript/check:tool-count/matrix/diff-matrix/budget/version-check 0.32.5。
- 发版(用户「1」)在本批 merge 后独立执行:verify_delivery → tag → npm publish(publish 留用户)。

---

### Task 1: screenshot_capture.gd `_detect_blank_image` 采样退化修复

**根因(已实测定位)**:`src/scripts/screenshot_capture.gd:178` `step := maxi(1, total_pixels / 100)`,线性索引 `i % w` 取 x。800×600 → step=4800=6×800(整除宽)→ x 恒 0,采样退化为最左单列;左列恰为均匀色(如黑边)时非空图误判 BLANK。1280×720 半退化(step=9216,9216%1280=256→仅 5 列)。

**修复**:10×10 网格分层采样(格中心),任意尺寸全覆盖,100 样本定值;`static func` 化(纯函数无实例态,便于 preload 直测)。

```gdscript
## 采样检测图片是否为均匀色（空白）。10x10 网格分层采样（每格中心），任意尺寸下
## 覆盖整幅；95% 以上采样与首个采样点颜色一致则判定为空白。
## 修复（2026-08-18，PR-3 终审挂账）：旧版线性 step=total/100 在 step 整除宽度时
## 退化为最左单列采样（800x600 实测 x 恒 0），左列均匀而非全图均匀时误报 BLANK。
static func _detect_blank_image(img: Image) -> bool:
	var w := img.get_width()
	var h := img.get_height()
	if w == 0 or h == 0:
		return true
	var first_color: Color = img.get_pixel(mini(w - 1, w / 20), mini(h - 1, h / 20))
	var uniform_count := 0
	var sample_count := 0
	for gy in 10:
		for gx in 10:
			var x := mini(w - 1, (gx * 2 + 1) * w / 20)
			var y := mini(h - 1, (gy * 2 + 1) * h / 20)
			var c := img.get_pixel(x, y)
			sample_count += 1
			if abs(c.r - first_color.r) < 0.01 and abs(c.g - first_color.g) < 0.01 and abs(c.b - first_color.b) < 0.01 and abs(c.a - first_color.a) < 0.01:
				uniform_count += 1
	return sample_count > 0 and float(uniform_count) / float(sample_count) > 0.95
```

调用点(:240 附近)`_detect_blank_image(img)` 不变(static 从同类实例方法调用合法)。

**测试**(新 `test/screenshot-blank-detect.test.ts`,沿 `test/gdscript-unit.test.ts` 的 CHECK_PROJECT+executeGdscript 模式;beforeAll `copyFileSync` 最新 src/scripts/screenshot_capture.gd 进 fixture,保证测当前源):
- GD 测试脚本:`const SC = preload("res://src/scripts/screenshot_capture.gd")` + 构造 Image:
  1. 800×600 全黑 → `SC._detect_blank_image(img)` = true;
  2. **回归铁证**:800×600 填黑后仅 x=0 列保持黑、其余 `seed(42)+randf` 噪声 → 新算法 false(旧算法 step=4800 只采 x=0 列 → 会 true——注释留档);
  3. 800×600 纯噪声 → false;
  4. 1×1 → true(退化尺寸)。
- 验证:`GODOT_PATH=... npx vitest run test/screenshot-blank-detect.test.ts` 绿 + `npm run check:gdscript` 0/0 + `npm run build`。

### Task 2: gdEscape→escapeForGdLiteral(纯字面量内插点,按根因全仓修)

**根因**:`gdEscape` 为 % 格式化场景设计(`%`→`%%`、`'`→`\'`,value-serializer.ts:46-48);sp/np 只内嵌进纯字符串字面量(不参与 % 格式化),含 `%` 的路径被静默双写成 `%%` → 加载失败(PR-2 I-1 同类;T3c 挂账 + PR-4 模板继承点)。共享转义序列(引号/反斜杠/换行/Tab)两入口相同,切换零损失(escapeGdStringCore:29-42 已核实)。

**改动点**(grep 逐点判定,仅换纯字面量上下文,% 格式化上下文维持 gdEscape):
- `src/tools/ui/ui-measure.ts:32-33`(sp/np:load 调用/np 查找/错误信息)
- `src/tools/ui/ui-import-single.ts:28-29`(sp/np:reload load/npLookup/错误信息)
- `src/tools/ui/ui-layout.ts`(全部 gdEscape(scenePath)/gdEscape(parentPath) 字面量内插:_mcp_load_scene/_mcp_get_scene_node/Parent not found/persist _full/layout_built 输出)

**测试**(就近 ui-generators.test.ts 或新用例):三个生成器各一——`genUiMeasureScript('res://a%b.tscn', ...)`/`genUiImportSingleScript('res://a%b.tscn', ...)`/`genUiBuildLayoutScript('res://a%b.tscn', ...)` 产物 `toContain('a%b.tscn')` 且 `not.toContain('a%%b')`;既有单测零回归。

### Task 3: 文档/测试清账(M-1/M-2/M-4/M-5 + README 口径 + check-tool-count 扩)

- **M-1**:`test/ui-import-prototype.test.ts` 错误透传用例(错误值 'Parent not found: /root' 已含 'not found')追加 `expect(parsed.error_code).toBe('NODE_NOT_FOUND')`(锁 uiErrorMapper 谓词)。
- **M-2**:`buildOutputs()` 删死键 `layout_built`(真实合成脚本已不输出;grep 引用零残留)。
- **M-4**:不修(2935ms vs timeout 30s 余量 ~10x),决策注记进 CHANGELOG 0.32.5 段。
- **M-5**:CHANGELOG 0.32.4 段半角括号归一为全角(与同段上下文一致)。
- **README 正文口径**(三处漂移,check-tool-count 20 处校验不覆盖 README 正文——复发根因):
  - `:7`「共 235 个 action」→ 241;
  - `:142`「共 235 个 action」→ 241;
  - `:144`「顶层工具数:**36**」「action 总数:**205**(read 100+write 80+destructive 10+process 13)」→ 43 / 241(read 120+write 95+destructive 10+process 16)——同文件 :142 与 :144 当前自相矛盾(43 vs 36)一并消解。
  - 真值来源:当前 matrix riskDistribution 实测 {"read":120,"write":95,"destructive":10,"process":16} total 241(本会话 node 实测);历史版本行(0.31.4/0.32.0/0.32.1=240)**已核实无漂移,不动**。
- **防复发**:`scripts/check-tool-count.mjs` checks 数组补 README 正文 pattern(如 `/共\s*(\d+)\s*个 action/` 于 README、`/顶层工具数:\*\*(\d+)\*\*/`、`/action 总数:\*\*(\d+)\*\*/`),改后 `npm run check:tool-count` 全绿。

### Task 4: spec §10.5 落答 + 0.32.5 收尾

- **spec §10.5 两条标已答**(实验数据 2026-08-18,生产路径 genUiImportSingleScript 真跑 4.7.1):
  - flow FILL h=39 根因:Holder 外层 Panel 比例锚点 float32 残差(anchor_top=100/720=0.138888895511627)→ 容器实测 h=39.9999923706055;HBoxContainer 给 FILL 子的高度整数截断 → floor(39.9999924)=**39(精确整数,而位置保留浮点残差 y=100.0000076)**。dh=+7 为系统性 FILL 拉伸(32→39)非噪声;修正渠道=原型侧等高输入或后续翻译规则垂直 size_flags 映射(维持开放,非本层)。
  - flow 容差:**维持 2**——系统性偏差是 flow_verify 的价值(如实红),加宽容差只会隐藏;1px 锚点截断噪声成分已在 2px 内。
- 集成测试 `test/integration/ui-import-integration.test.ts:298-308` 注释升级(「根因未挖留 §10.5」→ 根因结论一句话+指针)。
- version 0.32.5(`npm version patch --no-git-tag-version && npm run version-sync && npm run build`)+ CHANGELOG [0.32.5] 段(screenshot BLANK 采样修复/gdEscape 字面量修正含继承点/M-1/M-2/M-5/README 口径三处+check 防复发/spec §10.5 落答/M-4 决策注记)+ README 版本行 v0.32.5。
- 全门禁(含 check:gdscript/check:tool-count)+ final review + memory + Obsidian + ledger 交接 + push/PR(merge 留用户)。

## Self-Review
- 覆盖:挂账清单全项有归属(screenshot 退化=T1;T3c+继承=T2;M-1/2/5=T3、M-3 已被 1be1179 消解记录于 CHANGELOG/审查文档、M-4=T4 注记;README 口径+防复发=T3;§10.5=T4)。发版为批后独立动作(用户「1」)。
- 风险:Image.create 在 4.6/4.7 的弃用形态(warning 非 error,check:gdscript 容忍 warning?若 0-warning 门禁则换 Image.create_empty——实现时按 check:gdscript 实测裁决);GD 480k 次 set_pixel 性能(测试 timeout 30s 兜底)。
