---
date: 2026-06-28
status: design（待用户审）
topic: Android Deploy 工具（ROADMAP #7）
related:
  - ROADMAP.md M4 #7（💤→实施）
  - 竞品 godot-mcp-pro `addons/godot_mcp/commands/android_commands.gd`（193 行,3 命令）
  - src/tools/spawn-helper.ts:19（spawnGodot,buildSafeEnv+forceKillTree+stderr 分离）
  - src/tools/validation.ts:1054（export_build,通用导出,同 spawnGodot 原语）
---

# Android Deploy 工具 — 设计文档

## 1. 背景与目标

ROADMAP #7（💤→实施）。社区痛点「能装不能跑」:用户能导出 APK 装机但跑不起来(配置/签名/权限)。对齐竞品 godot-mcp-pro `android_commands`(3 命令),提供 **deploy 闭环**(export→install→launch),降低摩擦。

**目标**:3 个 action(`list_devices` / `get_preset_info` / `deploy`),TS child_process 实现,复用 `spawnGodot` 导出原语。

## 2. 架构

- 新 `src/tools/android.ts`(单文件),合并 tool `android` + 3 action(与 `game`/`recording` 合并模式一致)
- 注册 tool registry + `GUARDED.android`
- **adb**:Node `execFileSync`(`child_process`)——同 `game-bridge.ts:101` icacls 模式(系统命令,透传 env,需 `ANDROID_SDK_ROOT`)
- **godot 导出**:复用 `spawnGodot`(见 §4.2),不裸 spawn
- **adb 路径解析**:`process.env.ANDROID_ADB` → PATH `'adb'` fallback。**存在性校验即可**(`which`/`where`——adb 是系统工具无伪造风险,不需 `findGodot` 的 `--version` 探测);找不到报 `ADB_NOT_FOUND` + suggestion 装 platform-tools

## 3. 安全(审查 Gap 1,必修)

### 3.1 adb shell package 注入防护(Gap 1①)

deploy launch 步 `adb shell monkey -p <package> 1`——**adb shell 协议层把 args join 后传设备端 `sh -c` 执行**。package 来自 preset 解析(`package/name`),若被篡改/误配成 `com.x;rm -rf /data` 或 `$(cmd)`,设备 shell 会执行。

> `execFileSync` 的 args 数组只防 **Node shell 注入**,不防 **adb 协议层注入**(adb 客户端 join 后传设备 sh)——所以白名单是必须的独立校验。

- **package 白名单**:`/^[a-zA-Z][a-zA-Z0-9_.]*$/`(Android package 严格格式)。校验失败 → 拒绝 launch,返回 `LAUNCH_FAILED` + suggestion「package/name 格式非法,检查 export preset」
- **apk 路径校验**:preset 的 `export_path` 经路径字符校验(禁 `;` `&` `|` `$()` `` ` `` 等 shell 元字符 + `..` 穿越),仅允许合法路径字符
- **deviceSerial 白名单**(安全完整性):`/^[a-zA-Z0-9_-]+$/`(匹配 `emulator-5554` / `ABCDEF123456`)。`-s` 是 adb 客户端选项不经设备 shell(注入风险低于 shell),但与 package 校验对称
- **GUARDED(确认 token)不防注入**——package/deviceSerial 校验独立于 GUARDED,两者叠加(审查 (c) 补充)

### 3.2 godot spawn 必须 buildSafeEnv(Gap 1② + Gap 2)

deploy 导出步**必须用 `spawnGodot`**(`spawn-helper.ts:19`),它内部已 `env = buildSafeEnv()`(`:34`)+ `forceKillTree` + stderr 分离。**禁止裸 `spawn(godot, args)`**——否则复发 `spawn-without-buildsafeenv` defect(已 fixed)。

adb 的 `execFileSync('adb', ...)` 同 icacls 模式(系统命令不跑用户代码,透传 env OK),**不强求 buildSafeEnv**。

## 4. 三个 action

| action | 实现 | 失败 code |
|---|---|---|
| `list_devices` | `execFileSync(adb, ['devices','-l'])` 解析设备列表(serial/state/model) | `ADB_NOT_FOUND` / `NO_DEVICES` |
| `get_preset_info` | 读 `export_presets.cfg`(§5 INI 解析)找 Android preset,返回 name/runnable/export_path/package_name | `NO_ANDROID_PRESET` |
| `deploy` | 3 步(§4.1):export → install → launch(launch 可选) | `EXPORT_FAILED` / `INSTALL_FAILED` / `LAUNCH_FAILED` |

每步失败带 `suggestion`(装 platform-tools / 配 preset / 装导出模板)。

### 4.1 deploy 三步

1. **export**(除非 `skip_export=true`):`spawnGodot(godotPath, ['--headless','--path',projectDir,'--export-debug',presetName,apkAbsPath], { timeoutMs: 300_000 })`。**timeoutMs=300s**(Android 导出首次编译 android_debug.apk 模板 + 打包实测 2-5 分钟,默认 60s 必超时误报 EXPORT_FAILED + suggestion 误导装模板)。`apkAbsPath` 由 preset `export_path`(`res://...`)拼接 `projectDir` 转绝对路径。检查 `exitCode===0` + apk 文件存在
2. **install**:`execFileSync(adb, ['-s',deviceSerial,'install','-r',apkAbsPath])`(deviceSerial 可选)。检查 exit 0
3. **launch**(可选,`launch=true` 默认):package 白名单校验(§3.1)通过后 `execFileSync(adb, ['-s',deviceSerial,'shell','monkey','-p',package,'-c','android.intent.category.LAUNCHER','1'])`

### 4.2 复用 spawnGodot(DRY,Gap 2 + Gap 4)

deploy 导出步用 `spawnGodot`(`spawn-helper.ts:19`),与 `export_build`(`validation.ts:1054`)同原语。**不在 android.ts 重复导出逻辑**。`spawnGodot` 返回 `SpawnResult`(stdout/stderr/output/exitCode/timedOut),deploy 据 `exitCode` + apk 存在判断成功。

## 5. INI 解析(审查 Gap 3,应明确)

`export_presets.cfg` 是 Godot ConfigFile 格式,两级 section:

```ini
[preset.0]
name="Android"
platform="Android"              ← 判断 Android preset 的字段
runnable=true
export_path="res://export/android.apk"

[preset.0.options]
custom_template/debug=""
package/name="com.example.game"  ← 在 .options 子 section
```

**解析规则**(手写轻量 INI,无 npm 依赖,避免供应链):
1. **两级 section 识别**:`[preset.N]`(name/platform/runnable/export_path)与 `[preset.N.options]`(package/name 等)分开
2. **value 去引号**:`package/name="com.example.game"` → `com.example.game`(去掉首尾双引号,处理转义 `\"`)
3. **遍历多 preset**:按 `[preset.N]` 的 `platform="Android"` 过滤;支持 `preset_name` 或 `preset_index` 精确匹配,无过滤取第一个 Android preset
4. **简单 `split('=')` 的陷阱**:会保留引号、取错 section 字段——必须按上述规则解析
5. **key 含 `/`**:`package/name` 是单个完整 key(非 section 分隔),在 `[preset.N.options]` 下整体读取

> 无 `export_presets.cfg` → `NO_ANDROID_PRESET` + suggestion「Project > Export 配 Android preset」。

## 6. 错误处理

`opsErrorResult` + android 专属 code(局部 `ERROR_CODES`):

| code | 触发 | suggestion 核心 |
|---|---|---|
| `ADB_NOT_FOUND` | adb 不在 PATH/env | 装 Android platform-tools / 设 ANDROID_ADB |
| `NO_DEVICES` | adb devices 无设备 | 连设备 / 开 USB 调试 |
| `NO_ANDROID_PRESET` | 无 export_presets.cfg 或无 Android preset | Project > Export 配 Android preset |
| `EXPORT_FAILED` | spawnGodot exit≠0 | 装 Android 导出模板 / 查 stderr |
| `INSTALL_FAILED` | adb install exit≠0 | 设备空间 / 签名 / 查 adb 输出 |
| `LAUNCH_FAILED` | adb shell monkey exit≠0 或 package 格式非法 | 查 package/name 格式 / activity |

不走 Bridge 子类(android 独立 child_process,不经 sendToBridge)。

## 7. 测试

- mock `child_process`(`execFileSync`/`spawn`),同 `game-bridge` mock `net` / `recording` mock game-bridge 模式
- `list_devices`:fixture adb 输出(多设备/无设备/adb 缺失)
- `get_preset_info`:fixture export_presets.cfg(两级 section/引号/多 preset)
- `deploy`:各步失败(export exit≠0 / install 失败 / 无 preset)+ **package 注入测试**(package=`com.x;rm` 被白名单拒绝)
- `spawnGodot` 本身已有测试(spawn-helper),deploy 只测调用 + 结果判断

## 8. YAGNI 边界 + follow-up

- **不做 logcat**(MVP 选 A,不含)
- **不做导出模板校验**(deploy 假设模板就绪,export 失败报错指引装模板;template-check 列 follow-up)
- **不做 release 签名**(debug 导出 `--export-debug` 为主;release keystore 可扩展 `--export-release`)
- **(a) deploy 假设导出环境就绪**——不内置 template-check(YAGNI,follow-up)

## 9. 验收标准

1. `src/tools/android.ts` 实现 3 action + 局部 `ERROR_CODES`,注册 tool registry + `GUARDED.android`(deploy 守,list/get 读不守)
2. §3 安全:package 白名单 `^[a-zA-Z][a-zA-Z0-9_.]*$` + apk 路径校验;导出用 `spawnGodot`(buildSafeEnv),禁裸 spawn
3. §5 INI 解析:两级 section + 去引号 + platform 过滤
4. §4.2 DRY:deploy 复用 spawnGodot,不重写导出
5. §7 测试全绿(含 package 注入拒绝测试);tsc + eslint 净;全量 vitest 无回归
6. ROADMAP M4 #7 状态 💤→✅
