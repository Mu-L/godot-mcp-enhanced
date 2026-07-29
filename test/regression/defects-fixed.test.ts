// test/regression/defects-fixed.test.ts — M2 Task 4
// FIXED_DEFECTS 117 条硬断言：detect() === 0（防复发）。
// 复发即红，失败消息指引按 spec §8 闭环（改 status=open + 加 baseline + 移组）。
// 不调 _setProjectRootForTest：detect-helpers DEFAULT_ROOT 已修（C1），detect 默认读对项目根真文件。
import { describe, it, expect } from 'vitest';
import { FIXED_DEFECTS } from './defects.js';

describe('DEFECT fixed 防复发（硬断言 detect() === 0）', () => {
  it.each(FIXED_DEFECTS)('[${severity}] ${key}', ({ key, severity, dimension, detect }) => {
    const hits = detect();
    // 硬断言：detect 必须为 0。非 0 = 复发或翻译错。
    expect(
      hits,
      `DEFECT [${severity}] ${key} (${dimension}) fixed 但 detect 命中 ${hits}（复发）— ` +
      `复核 src 真实状态：若真复发，按 spec §8 闭环改 status='open' + 加 baseline=实测 + 移到 OPEN_DEFECTS；` +
      `若 detect 翻译错则修闭包忠实 defects.md 谓词`
    ).toBe(0);
  });

  it('FIXED_DEFECTS 覆盖 80 条且无重名', () => {
    // 31 = 19（原 FIXED）+ 3（2026-06-27 probe 实测 detect=0 移 fixed：gdscript-gen-null-root-deref /
    //   launcher-no-error-listener / plugin-no-super-call；后者 2026-07-04 detect 反转——
    //   654b162 误加 super 触发 4.6.2+ parse error,移除 6 处 super 后 detect 计数"原生类虚函数有 super"=0 防回归）
    //   + 1（ts-args-as-cast-no-validation 2026-06-27 args-validator 接入,detect 改查 executeToolCall
    //   validateArgs 接入点,文件级 grep;detect===0 防去验证化回归）
    //   + 3（2026-06-27 收窄：version-hardcoded-drift / secret-cache-and-perm-weak / normalizeargs-depth-limit
    //   detect 改查真缺陷形态,剔除合理模式 verifiedGodotVersion 元数据 / icacls ACL 替代 / .MAX_NORMALIZE_DEPTH
    //   常量引用,实测 detect===0 移 FIXED 防复发）
    //   + 1（2026-06-27 recording-no-touch-events ScreenDrag 补全 feat/recording-screen-drag,
    //   ScreenTouch+ScreenDrag 两类齐备 detect=0 移 FIXED 防复发）。
    //   + 2（2026-06-29 r2 N1/N3 fix-forward：frame-sequence-quota-bypass(workflow copyScript 配额绕过) /
    //   sim-threshold-bare-as(裸 as 致 NaN 放行),detect=0 移 FIXED 防复发）。
    //   小计 19+3+1+3+1+2=29,另 +2 为历史小计外新增（未逐一条目化）,
    //   +2(2026-07-04 审查 F-1/F-2 PowerShell 写 secret 注入 + blocking 误用:
    //   secret-write-powershell-injection / os-execute-blocking-false-exit-code),合计 33。
    //   +4(2026-07-04 审查 F-5/F-6/F-7/F-8 数据导入子系统 + 2026-07-05 复审 P1 扩展:
    //   csv-import-float-no-isfinite-guard(F-8 抽 _safe_float 守 FLOAT/VECTOR2/COLOR)/
    //   csv-import-mkdir-return-ignored(F-6 _mcp_done 净化)/ csv-import-save-return-ignored(F-5)/
    //   csv-import-no-byte-limit(F-7 + csv_path statSync 预检 P1-2)),合计 37。
//   +1(2026-07-06 ipc 审查 P1-8: game-bridge-invalidate-race,_socket === sock 守卫防废弃 socket
//   异步 close/error invalidate 新 socket),合计 38。
//   +3(2026-07-06 综合审查 P1-1/P1-2/P1-3: editor-blind-routing-no-fallback(-32601 回退 headless)/
//   editor-guards-text-write-not-wired(TS 写脚本/场景接线 guard 回调)/
//   heartbeat-pause-timeout-disconnect(暂停超时改恢复 normal 检测)),合计 41。
//   +4(2026-07-10 三层架构审查 P1×3+P2×1: pkill-spawn-error-handler / nav-bake-in-undo-action /
//   asset-undo-stack-top-guard / install-plugin-realpath-guard),合计 45。
//   +1(2026-07-10 RCE/进程通信审查 P1: elicitation-apply-drops-empty-required,空值占位 required primitive
//   的 elicit 值被吞),合计 46。
//   +3(2026-07-11 editor-asset/auth 审查 P1: editor-asset-method-map-routing(asset 写操作扁平 method 映射)/
//   undo-manager-callv-editor-undo-redo(callv + EditorUndoRedoManager 形参)/
//   editor-auth-acl-not-readonly(secret ACL :R→:M 修降级 headless 死循环)),合计 49。
//   +2(2026-07-11 插件反馈·messenger-godot asset 子系统): asset-material-array-color-crash
//   (create_material 传 [r,g,b] 数组调不存在的 String(Array) 抛 SCRIPT ERROR → 材质静默丢失)/
//   asset-path-count-swallowed-by-spacing(path count 被 handle_path 默认 spacing=1.0 吞),合计 51。
//   +1(2026-07-11 插件反馈·CardGame2): mcp-bridge-ready-headless-skip(_ready 删 headless early return,
//   run_project headless 游戏需 Bridge; detect 计 mcp_bridge.gd 中 DisplayServer=="headless" 残留),合计 52。
//   +3(2026-07-12 CRITICAL RCE 复合链修复): rce-guard-search-replace-read-downgrade(guard 删 dynamicRiskOverride)/
//   rce-create-scene-root-node-type-no-validation(create_scene 补 ^[A-Za-z0-9_]+$)/
//   rce-script-branch-no-node-check(godot_operations.gd 脚本分支补 is_parent_class Node),合计 55。
//   +1(2026-07-12 进程通信 P0): health-monitor-no-control-loop(HealthMonitor 加 onStateChange 回调,
//   GodotServer 接线 handleEditorStall 降级),合计 56。
//   +1(2026-07-13 审查·addons 第三轮 P0): asset-path-align-vertices-infinite-loop(path_generator
//   _sample_continuous align_vertices 独立 if 分支缺 spacing<=0 守卫,spacing=0+count>=1 死循环),合计 57。
//   +3(2026-07-19 SDD scene coerce 闭环): resource-prop-coerce-helper(_set_property_with_coerce helper
//   + edit_node/add_node/batch 三处调用)/ instance-property-blocked-gd(BLOCKED_PROPERTIES 列 "instance"
//   双保险)/ batch-failed-quit-nonzero(batch 部分失败 quit(1) 非静默),合计 60。
//   +1(2026-07-19 SDD editor-version-tear §1): editor-coerce-property-value(command_helpers.gd 统一
//   coerce_property_value helper,只 coerce 不 set,与 headless _set_property_with_coerce 不对称),合计 61。
//   +1(2026-07-19 SDD editor-version-tear §2): editor-handle-edit-node(node_commands.gd 加 handle_edit_node,
//   per-property undo do=set new / undo=set old,经 create_action_mixed callv spread),合计 62。
//   +1(2026-07-19 SDD editor-version-tear §3): editor-handle-batch-add-nodes(node_commands.gd 加
//   handle_batch_add_nodes,预校验零内存改+批量 UndoRedo do=add_child+set_owner+set/undo=remove_child),合计 63。
//   +1(2026-07-19 SDD editor-version-tear §4): editor-add-node-properties(node_commands.gd 现有
//   handle_add_node 补 properties,coerce_property_value 经 helper 生成 prop_do_ops,原只取 3 字段 properties 丢弃),合计 64。
//   +1(2026-07-19 SDD editor-version-tear §5): editor-method-map-edit-batch(editor-method-map.ts scene
//   表登记 edit_node/batch_add_nodes,打通 editor 连接时 scene 工具 → command_handler 路由,不再
//   fallback headless spawnGodot 改盘致磁盘/内存版本撕裂),合计 65。
//   +1(2026-07-19 SDD editor-version-tear §6): editor-scene-save-guard-edit-batch(index.ts edit_node/batch
//   headless fallback 路径加 checkEditorSceneSave 守卫,editor 未连接时 fallback 改盘前防覆盖 editor 内存),
//   合计 66。
//   +1(2026-07-20 F1): add-node-editor-root-routing(handle_add_node parent 解析改用 CommandHelpers.find_node
//   识别 "root"/root_name/"root/" 前缀,对齐 handle_edit_node/handle_batch_add_nodes/headless
//   godot_operations.gd:316,原 root.get_node_or_null 不识别 "root" 致 editor 路由 add_node parent=root 失效),
//   合计 67。
//   +1(2026-07-21 P2-1): csv-import-timeout-no-atomic-write(data-import.ts ResourceSaver.save 直写目标
//   改 tmp+rename 原子提交,超时 kill 落在 save 中途只损 tmp,full_path 旧/完整 Godot 启动不 parse error),
//   合计 68。
//   +1(2026-07-22 orphan 隔离): orphan-scan-session-scoped(killOrphanGodotProcesses 默认基于
//   _spawnedGodotPids 会话集合,全系统扫须 GODOT_MCP_FULL_SYSTEM_SCAN opt-in 门控,签名 projectDir 改可选),
//   合计 69。
//   +2(2026-07-23 批次 A 安全修复): asset-factory-load-traversal(A5 asset_factory load 前 has_path_traversal) /
//   ui-scene-local-blocked-removed(A10 ui/scene 本地 blocked 删除,统一 BLOCKED_PROPERTIES),合计 71。
//   +9(2026-07-23 批次 B 可靠性修复 B1-B8/B10): health-monitor-error-type-misdegrade(B1 evaluateState 按
//   errorType 分流,仅 heartbeat 驱动 reconnecting) / editor-stall-no-zombie-clear(B2 handleEditorStall disconnect
//   清 zombie) / heartbeat-ping-reuses-request-timeout(B3 ping 独立 5s 超时) /
//   executor-do-not-retry-string-match(B4 CONN_ERROR_CODES Set 结构化判定) /
//   editor-connection-handler-no-try-catch(B5 fireDisconnect/fireReconnect try/catch) /
//   rebuild-no-setstate-connected(B6 重建 setState('connected') 即刻复位) /
//   resource-write-non-atomic(B7 17 处 ResourceSaver.save 改 _save_atomic/tmp+rename 三环境) /
//   is-connected-no-jsdoc(B8 isConnected 活性语义 JSDoc) / auth-timeout-hardcoded(B10 authTimeoutMs 参数化),
//   合计 80。
//   +1(2026-07-23 editor 多实例 key 误删): editor-secret-cross-instance-delete(websocket_server.gd
//   _delete_secret_file 删 key 前校验 on_disk == _secret,防多实例共享固定路径互删致存活实例 key 丢失),
//   合计 81。
//   +12(2026-07-23 批次 C 正确性): sync-commands-dead-get-plugin(C1) /
//   gdscript-executor-compile-error-includes(C2 \b 词边界) / websocket-params-null-passthrough(C3) /
//   path-generator-no-root-strip(C5) / csv-content-no-precheck-size(C6) / csv-tmp-clean-output-dir-only(C7) /
//   gdscript-executor-bare-rm-session-dir(C8) / test-assert-str-equality(C9 values_equal) /
//   animtree-state-transition-blend-no-undo(C10) / batch-add-nodes-commit-orphan-leak(C11) /
//   edit-node-readonly-undo-null-set(C12) / ui-set-params-no-key-check-load-null(C13),
//   合计 93。（C4 accurate bake_result deferred——架构阻塞 coroutine vs 同步 dispatch,见 nav-bake-in-undo-action 注释）
//   +1(2026-07-24 批次 D): asset-android-tool-orphan(D1 asset/android TOOL_GROUPS 补组,消除 isToolAllowed 恒 false 游离),合计 94。
//   +5(2026-07-24~28 批次 E/Bridge/scene-workflow traversal): D2 nodepath-traversal-category-error /
//   批次 E animation-track-destructive-confirmation / Bridge take_screenshot-null-crash-swallow /
//   2026-07-28 scene/workflow traversal detect×2,合计 99（见 defects.ts:2 顶部权威登记）。
//   +1(2026-07-29 A-telemetry T1): telemetry-error-category-pii-leak(error_category 固定 'TOOL_ERROR' 枚举,
//   不再 safeErrorCategory 派生泄漏 PII),合计 100。
//   +1(2026-07-29 A-telemetry T2): telemetry-afterhook-no-optout-guard(after-hook 第一行加 isTelemetryEnabled
//   前置守卫,堵 opt-out 下 hashProject 参数求值期创建 telemetry-uuid.txt),合计 101。
//   +1(2026-07-29 A-RCE S1): addon-update-dest-symlink-bypass(updateAddon/readAddonVersion 补 safeRealPath(dest)
//   +isPathInAllowedRoots 校验,堵 addons/ 子段符号链接越界读写),合计 102。
//   +1(2026-07-29 A-RCE T2): bpy-no-dangerous-scan(execute_bpy 补 scanBpySandbox 静态扫描,
//   对齐 execute_gdscript 纵深防御,堵 os/subprocess/eval/exec/__import__/ctypes/open),合计 103。
//   +1(2026-07-29 A-RCE T3): profile-executeToolCall-isToolAllowed-enforce(isToolAllowed 从
//   getFilteredTools 广告层补到 executeToolCall 主路径入口,堵被转发 MCP 客户端调过滤工具),合计 104。
//   +1(2026-07-29 A-RCE T4): godotpath-allowed-paths-unimplemented(GODOT_MCP_ALLOWED_GODOT_PATHS
//   env 白名单 isGodotPathAllowed 接入 validateGodotBinary/detectGodotVersion/findGodot 全出口,
//   堵 AI 可控 godot_path 参数指向任意二进制被 spawn),合计 105。
//   +1(2026-07-29 B-Reliability T3): editor-halfopen-no-precheck(EditorToolExecutor 构造器注入
//   healthMonitor,_executeInner 入口 reconnecting 时即时返 NOT_CONNECTED,跳过 30s conn.request
//   半开 HOL 等待,避免串行 executeChain ×30s 放大),合计 106。
//   +1(2026-07-29 B-Reliability T4): gdscript-spawn-not-registered(gdscript-executor spawn
//   后注册 _spawnedGodotPids,exit/error/三 forceKillTree 路径 unregister;GodotServer.close
//   遍历活跃 PID 调 killPidTree best-effort 清理,堵挂起脚本 + close → 孤儿无兜底),合计 107。
//   +1(2026-07-29 B-Reliability T5): heartbeat-blanket-catch-no-distinguish(pingFn catch 保留
//   err.code + onStateChange 分流 REQUEST_TIMEOUT(降级)vs NOT_CONNECTED/CONNECTION_LOST(让
//   EditorConnection 自动重连兜底,不 disconnect 抢占)+ addOnReconnectHandler 触发 hm.reset()
//   即刻复位 connected;堵编辑器重启/瞬时不可达也强制降级须手动 reconnect),合计 108。
//   +7(2026-07-29 C-Correctness detect 补全 T8: nav-freed-access-signal / nav-status-hardcoded /
//   doctor-no-stripbom / readcache-no-byte-limit / addon-update-nonatomic / adapter-no-mode-preserve /
//   adapter-env-field-overwrite;fixes 在 commits 35dd8b9..c04a6b0,detect 统一 T8 补),合计 117。
    expect(FIXED_DEFECTS.length).toBe(118);
    const keys = FIXED_DEFECTS.map(d => d.key);
    expect(new Set(keys).size, '存在重名 key').toBe(118);
    // 全部 status=fixed
    for (const d of FIXED_DEFECTS) {
      expect(d.status, `${d.key} status 应为 fixed`).toBe('fixed');
    }
  });
});
