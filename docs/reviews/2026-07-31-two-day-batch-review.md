# 第三方审查报告：2026-07-28 → 2026-07-30 两天批次（130 commits）

> **审查日期**：2026-07-31
> **审查范围**：commit `7f9c1a5`(7-27 最后) → `915b13c`(7-30 HEAD)，共 130 commits，跨 A0/A-telemetry/B/C/D/E 六个批次
> **审查方法**：主审（净 diff 逐行）+ 3 个独立 `code-reviewer` 子 agent（addons / cli-clients / B-C-韧性，隔离视角，所有声明 grep/read 实测）
> **仓库级约束核查**：独立 grep `rule-templates.ts` / `build/` / `capability-matrix` / `.claude/rules/`，确认本批改动未触及独立副本同步边界（纯产品代码 + 测试 + docs/reviews，无规则分发产物改动）

---

## 总体判定：**SHIPPED**（附带 1 个已修复的 nit）

两天改动主体质量高，安全批次纵深防御设计扎实，门禁全绿。审查发现 1 处真实 bug（nav:196 freed 对象守卫遗漏），已在本次审查中修复并复跑门禁。无 BLOCKING issue。

### 门禁状态（已亲自跑）

| 门禁 | 结果 | 验证命令 |
|------|------|---------|
| ESLint | ✅ 通过（src/ 零警告） | `npm run lint` |
| TypeScript 编译 | ✅ 通过（strict 零错误） | `npm run build` |
| Vitest | ✅ **290 文件 / 4279 用例 passed**（24 skipped） | `npm test` |
| GDScript validate_scripts | ✅ 基线一致（nav 改动前后输出相同，"load null" 是 editor 依赖既有行为） | `validate_scripts` |

---

## 本次审查修复（1 nit → 已修）

### N1-fix：`nav_commands.gd:196` bake_mesh_async 末行缺 freed 守卫

**根因**：N1 修复（freed 对象守卫）在同一函数循环内（:188）和循环后 disconnect（:192）都加了 `is_instance_valid(nav)`，但漏了末行属性访问。与同文件 `:144`（create_region_async 末行 `is_instance_valid(nav) and ...`）不一致。

**触发路径**：bake_mesh 兜底窗口 110s，期间若另一 peer/操作删除该 NavigationRegion3D（MAX_PEERS=5 并发合理），deadline 耗尽退出时 `nav` 已 freed，:196 访问 freed 对象属性 → GDScript SCRIPT ERROR，破坏 :195 注释承诺的「退化乐观」语义。

**修复**（与 :144 对齐）：
```gdscript
# 修前
var success: bool = nav.navigation_mesh != null and nav.navigation_mesh.get_vertices().size() > 0
# 修后
var success: bool = is_instance_valid(nav) and nav.navigation_mesh != null and nav.navigation_mesh.get_vertices().size() > 0
```

**验证**：`validate_scripts` 改前改后输出基线一致；lint/build/test 全绿（4279 passed，零回归）。diff：`nav_commands.gd | 4 +++-`（+3 -1，含注释）。

置信度 ~85（不一致确定；触发需并发删除+慢 bake，窄窗口但现实存在）。

---

## 各批次逐项结论

### 1. 安全批次（A-RCE / S1-S3 / T1-T2 遥测 PII）— ✅ SHIPPED

子 agent + 主审一致确认。纵深防御设计扎实：

- **`GODOT_MCP_ALLOWED_GODOT_PATHS`**（`src/core/godot-finder.ts:69-93`）：签名校验之上的硬隔离，realpath 归一化堵 symlink 绕过，空 env back-compat 放行，**缓存命中仍过白名单**（防 stale cache 绕过新策略）。
- **`updateAddon` 原子替换**（`src/core/addon-version.ts:37-89`）：staging + 校验 + 备份 + 平台 rename + 回滚；dest/safeRealPath 双重白名单校验堵符号链接越界写。POSIX 原子覆盖、Windows 分支诚实标注「非纯原子但有备份」。
- **`execute_bpy` 危险 API 扫描**（`src/core/bpy-sandbox.ts`）：对齐 `scanGdscriptSandbox`，negative lookbehind 精准匹配裸 `open(` 排除方法调用。
- **`instantiate_class` 白名单**（`src/scripts/godot_operations.gd:188-241`）：移除裸 `Node` 堵 `extends Node` 恶意脚本 `_ready` RCE，ClassDB 分支与 script 分支对称用白名单。
- **profile 硬隔离**（`src/core/ToolDispatcher.ts:227`）：`isToolAllowed` 从广告层补到 `executeToolCall` 主路径。

### 2. 遥测批次（A-telemetry）— ✅ SHIPPED，亮点

- opt-in 默认零外传（endpoint 空 → `record` 立即 return 零开销），`CI=true` 强制 false。
- 加盐 sha256 防字典反推，version 白名单正则防注入。
- **关键 T2**（`ToolDispatcher.ts:478`）：opt-out 前置守卫在 `recordTelemetry` **参数求值前**早 return——否则 `hashProject()` 触发 `getInstallUUID()` mint 写文件，违反「disabled 零副作用」。注释标注根因 `feature-gate-inside-callee-defeated-by-arg-eval`，坑抓得细。
- **关键 T1**：`error_category` 固定枚举 `TOOL_ERROR`，原 `safeErrorCategory` 会把原始错误文本（含路径/项目名 PII）外传。

### 3. nav async-dispatch（C4）+ nav 韧性（B）— ✅ SHIPPED

B/C 子 agent 重点核查并通过：
- **B-T5 心跳降级分流**（`GodotServer.ts:466-520`）：`_lastPingErrCode` 时序可靠（Node 单线程，pingFn.catch 同步写值 → setState 同步触发 listener → listener 读值在同一 tick）。`REQUEST_TIMEOUT`（TCP 半开）→ 降级；`refused/下线` → 不抢占 EditorConnection 自动重连 + `addOnReconnectHandler` 复位 hm + `reconnectExhausted` 兜底，闭环完整。
- **B-T3 半开 HOL 预检**（`GodotServer.ts:473`）：hm 注入 EditorToolExecutor 构造前复用，rebuild 时取同一单例无 stale 引用。
- **B-T4 孤儿清理**（`gdscript-executor.ts:1198-1261` + `GodotServer.ts:586`）：register/unregister 在 exit/error/timeout/pipe溢出四路径对称，close 兜底 best-effort。
- **nav bake 信号方案一致**：editor（nav_commands.gd 110s + get_vertices().size()>0）与 headless（navigation.ts:59 同款）判据对齐。

### 4. addons undo/OOM（D-P2/D-ADV）— ✅ SHIPPED，亮点多

addons 子 agent 确认：
- **undo_manager `_add_method` 用 `callv` spread**：精准规避 `add_do_method(Callable)` 静默不注册陷阱。
- **nav/ui set_params 补 undo**：`command_helpers._record_prop`（:220 static）聚合进 `create_action_mixed`。
- **custom_meshes clampi 上限**：各参数独立 clamp，torus 128×128≈9.8 万顶点 < 20 万，注释推算自洽。
- **animtree F5 守卫**：`cond is Dictionary` 跳过非字典元素，与 TS 侧 filter 语义对齐。

### 5. cli 客户端（ZCodeAdapter + F3 + C1）— ✅ SHIPPED

cli 子 agent 确认：
- **F3 mode 保持**：statSync → tmp write → rename，tmp 与目标同目录保证原子，Windows 诚实标注 no-op。
- **C1 env 白名单合并**：精确收窄运行时配置子命名空间，安全开关一律剔除。
- **ZCodeAdapter**：嵌套键 + sibling/plugins/hooks 保留，测试覆盖充分。

### 6. 测试质量门禁（E 系列）— ✅ 机械但有价值

三检测器（死文件 + mock drift + 弱断言）首次抓到死文件 + mock drift；弱断言 includes→toContain 机械转换（576+45 处）+ 门禁上限 1400→810；pretest 钩子强制 test 先 build 防跑旧码。

---

## 未修复的低危 Nits（非阻断，记录备查）

1. **`particle_commands.gd:19` 本地 `_record_prop` 与 `command_helpers:220` 共享版重复**：功能等价，跨文件重构，建议后续统一迁移。
2. **`path_generator.gd` spacing 模式无下限**：`spacing=1e-4` + 长路径会 CPU 冻结（非 OOM，BATCH_LIMIT=64 已兜住节点落地）。
3. **`gdscript-executor.ts:1269` close handler 未调 unregisterSpawn**：exit 已覆盖，Set 幂等，有 lazy 清理兜底。
4. **`update-checker.ts` S2 `writeFileSync` mode `& ~umask`**：对 `0o600` 无影响（umask 通常 022），更稳健可用 chmodSync。

---

## 值得注意的亮点

1. **遥测 T2 前置守卫**（feature-gate-inside-callee-defeated-by-arg-eval）：抓住了 JS 参数求值先于函数入口的隐蔽坑。
2. **nav bake 信号方案**：editor/headless 双路径判据统一 + lambda by-value → dict holder 修复（GDScript 4 实测）。
3. **B-T5 分流闭环**：err.code 区分 + reconnect 复位 + exhausted 兜底，注释把链路完整性讲清楚。
4. **updateAddon 原子替换**：POSIX/Windows 平台行为诚实标注，不假装跨平台一致。

---

## 验证方式声明

- 门禁：`npm run lint`（通过）+ `npm run build`（通过）+ `npm test`（290 文件/4279 用例全绿）。
- 净 diff：`git diff 7f9c1a5 915b13c`（基准为 7-28 前最后 commit）。
- nav:196 bug：`Read nav_commands.gd:185-199` 亲自核实，`git stash` 基线对照 `validate_scripts` 输出一致。
- 独立审查：3 个 `code-reviewer` 子 agent（addons / cli-clients / B-C-韧性），隔离视角，所有声明 grep/read 实测。
- 仓库级约束：独立 grep `rule-templates.ts`/`build/`/`capability-matrix`/`.claude/rules/`，确认未触及独立副本同步边界。
