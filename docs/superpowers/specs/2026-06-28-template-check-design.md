---
date: 2026-06-28
status: design（待用户审）
topic: template-check（#7 follow-up）
related:
  - ROADMAP #7 follow-up（android-deploy spec §8）
  - src/tools/android.ts（check_template action）
  - src/core/godot-finder.ts:59/69（isGodotVersionSignature / validateGodotBinary）
  - src/tools/runtime.ts:331（get_godot_version,内联 --version,不可复用）
---

# template-check — 设计文档

## 1. 背景与目标

#7 Android Deploy 的 follow-up（android-deploy spec §8）。deploy 现假设导出模板就绪、失败才指引。check_template 作 **read-only 前置诊断**,deploy 前检查默认 Android 导出模板安装,明确定位「能装不能跑」最常见原因(模板缺失)。

**目标**:android tool 新增 `check_template` action + 抽 `detectGodotVersion` 共享原语。

## 2. detectGodotVersion 原语(Gap 1,DRY)

**现状**:`get_godot_version`(runtime.ts:331)内联 findGodot+spawn --version+buildSafeEnv+10s 返回版本串(但 action 内联,不可复用);`validateGodotBinary`(godot-finder.ts:69)跑 --version 返回 **boolean**(不返回串)。两份 --version 执行逻辑。

**抽 `detectGodotVersion(godotPath): Promise<string>`**(src/core/godot-finder.ts),复用 `isGodotVersionSignature` 校验,返回完整版本串:

```ts
export async function detectGodotVersion(godotPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(godotPath, ['--version'], { stdio: ['pipe','pipe','pipe'], env: buildSafeEnv() });
    let out = '';
    proc.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { out += d.toString(); });
    const timer = setTimeout(() => { forceKillTree(proc); reject(new Error('godot --version timed out after 10s')); }, 10000);
    proc.on('close', () => {
      clearTimeout(timer);
      const v = out.trim();
      if (!isGodotVersionSignature(v)) reject(new Error(`Invalid Godot version signature: ${v}`));
      else resolve(v);  // 完整串,如 "4.6.2.stable"
    });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}
```

- spawn + `buildSafeEnv()` + 10s timeout + `forceKillTree`(与 get_godot_version 同安全模式,非 spawnGodot——后者 60s 默认为长任务设计)
- `isGodotVersionSignature` 校验(复用现有,防伪造打印 "4.6" 的二进制)
- 消费方:check_template + get_godot_version(optional refactor,标 §7 避免扩大范围)

## 3. 模板目录名 major.minor(Gap 2,关键技术)

**Godot 4 export_templates 目录名是 `<major>.<minor>`(如 4.6),非完整版本(4.6.2.stable)**。正确路径 `.../export_templates/4.6/android_debug.apk`。

项目口径佐证:`code-templates.ts` verifiedGodotVersion="4.6"、`godot-finder.ts:47` 注释「打印 4.6 的二进制」。

check_template 从 detectGodotVersion 完整串提取 major.minor:
```ts
const full = await detectGodotVersion(godot);  // "4.6.2.stable"
const majorMinor = full.match(/^(\d+\.\d+)/)?.[1];  // "4.6"
```
模板目录 `<config>/export_templates/<majorMinor>/`。

> 这是核心技术决策(非"实施微调"):用完整版本拼目录必错(实际目录是 4.6),check_template 会对所有项目误报 TEMPLATE_MISSING。

## 4. check_template action(read-only,不进 GUARDED)

1. `findGodot` → godot
2. `detectGodotVersion(godot)` → 完整版本 → 提取 major.minor
3. config 根路径(OS):
   - Win: `%APPDATA%\Godot`(`process.env.APPDATA`)
   - Linux: `~/.local/share/godot`(`os.homedir() + '.local/share/godot'`;best-effort,不读 XDG_DATA_HOME)
   - Mac: `~/Library/Application Support/Godot`(`os.homedir() + 'Library/Application Support/Godot'`)
4. 模板目录 `<config>/export_templates/<majorMinor>/`
5. `existsSync` android_debug.apk + android_release.apk
6. 返回 `{ godot_version, major_minor, template_dir, android_debug:{path,exists}, android_release:{path,exists}, status, suggestion? }`
   - status: 两 apk 都在=`ok`;缺=`missing`

GUARDED.android 不变(deploy 守,list_devices/get_preset_info/check_template 读不守)。

## 5. 错误码(android.ts ERROR_CODES 扩展)

- `GODOT_NOT_FOUND`(findGodot 失败;复用现有 findGodot 错误传播)
- `VERSION_DETECT_FAILED`(detectGodotVersion 抛:超时 / 非 Godot 签名)
- `TEMPLATE_MISSING`(apk 缺失,附 path + suggestion「Godot Editor > Manage Export Templates 下载 <majorMinor> 模板」)

## 6. 测试(test/android.test.ts)

mock `../src/core/godot-finder.js`(detectGodotVersion + findGodot)+ mock `fs`(existsSync)。场景:
- 模板齐全(debug+release 都在)→ status=ok
- debug 缺 / release 缺 → status=missing + 对应 suggestion
- 版本检测失败(detectGodotVersion reject)→ VERSION_DETECT_FAILED
- major.minor 提取(detectGodotVersion 返回 "4.6.2.stable" → 模板目录含 "4.6")

## 7. YAGNI + 已知限制

- **不处理 editor settings `_export_templates_directory` 自定义覆盖**(best-effort 默认路径,覆盖大多数;自定义覆盖是少数场景,标已知限制)
- **Linux 不读 XDG_DATA_HOME**(自定义 XDG 用户路径可能错;与上一条同类 best-effort 限制)
- **不校验 preset custom_template**(MVP 选默认模板源)
- **get_godot_version refactor 调 detectGodotVersion 标 optional**(DRY 收益,但避免改 runtime.ts 扩大本 follow-up 范围;留独立 refactor)

## 8. 验收

1. `detectGodotVersion`(src/core/godot-finder.ts),check_template 用它(复用 isGodotVersionSignature + buildSafeEnv)
2. 模板目录名 major.minor(`4.6.2.stable`→`4.6` 提取)
3. check_template action read-only + 3 错误码 + GUARDED.android 不变(check_template 读不守)
4. android tool inputSchema action enum 加 `check_template`
5. 测试全绿 + tsc/eslint 净 + 全量无回归
6. capability-matrix 同步(action enum 变,build-matrix 重生成)
