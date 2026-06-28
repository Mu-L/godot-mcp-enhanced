---
date: 2026-06-28
status: design+plan（已批准,待实施）
topic: logcat + release（#7 follow-up batch 2）
related: ROADMAP #7 follow-up;android.ts（logcat action + deploy release）;2026-06-28-android-deploy-design.md §8
---

# logcat + release 设计 + 实施计划（#7 follow-up batch 2）

## 设计

### logcat action(新,read-only 不进 GUARDED)
- `adb logcat -d -t <lines> [+ filter] [+ device_serial]` —— 一次性快照(dump 最近 N 行)
- 输入:`lines`(默认 100)+ `filter`(可选,*:E / GDScript:*)+ `device_serial`(可选,SERIAL_RE 校验)
- 输出:`{ lines, output, device? }`
- 错误码:`ADB_NOT_FOUND` / `LOGCAT_FAILED`(android.ts ERROR_CODES 扩展)
- read-only(不进 GUARDED,同 check_template)

### release(deploy 扩展,最小)
- deploy 现有 `debug` 参数(inputSchema 已有)控制:`debug=true`(默认)→ `--export-debug`;`debug=false` → `--export-release`
- **keystore 由用户 preset 配**(Godot Editor 配 keystore/release_keystore + user/password);deploy 只换 export flag,export 失败指引配 keystore
- `parsePresetsCfg` 不改(YAGNI——keystore 是 Godot preset 字段,导出时 Godot 自己读)

### YAGNI
- logcat 不做持续流/clear(MVP 快照)
- release 不主动配 keystore(用户 preset 负责)

## 实施(TDD)

### Task 1: logcat action
- ERROR_CODES 加 `LOGCAT_FAILED`
- inputSchema: action enum 加 `logcat`;加参数 `lines`(number,default 100)/`filter`(string)/`device_serial`(string,复用)
- handleTool 加 `case 'logcat'`:`runAdb(adb, [...serialArgs, 'logcat', '-d', '-t', String(lines), ...(filter?[filter]:[])])`;notFound→ADB_NOT_FOUND;exit≠0→LOGCAT_FAILED;成功→textResult({lines, output, device})
- 测试(android.test.ts):mock runAdb(mockExec)返回 logcat 输出;filter 透传;device_serial 校验(SERIAL_RE)

### Task 2: release(deploy debug 参数)
- deploy case:`const debug = args.debug !== false; const exportFlag = debug ? '--export-debug' : '--export-release';`;spawnGodot args 用 exportFlag
- 测试:deploy `debug:false` → spawnGodot args 含 `--export-release`(断言)

### Task 3: 验证 + capability-matrix
- tsc + eslint + 全量 vitest
- build-matrix(logcat action enum 变 → android description 变)

## 验收
1. logcat action read-only + ADB_NOT_FOUND/LOGCAT_FAILED + filter/device_serial
2. release:deploy debug=false → --export-release(spawnGodot args)
3. 测试全绿 + tsc/eslint 净 + capability-matrix 同步
