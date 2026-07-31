# E-101 e2e-scene/.godot 缓存清理（报告4 :101）

> 继承总 spec `docs/superpowers/specs/2026-07-29-审查修复批次设计.md` batch E :101（P2-10）。报告4 :101 独立子批。同 batch 已闭环：:93/:94/:96/:97a（E-P1）/ :98（E-P2）/ :95（E-95）/ :97b（E-97b）。

## Goal

给 `test/e2e-p1-p5.test.ts` 的 `beforeAll` 加 `rmSync(test/e2e-scene/.godot, recursive)`，让本地运行以 CI fresh-checkout 的干净状态起步，防过期导入缓存致假通过——无此清理时 P3-import 的 `.godot/imported` 存在断言会命中上次运行的残留目录而假绿（executeGdscript 即便没真跑 import warmup，目录也在、断言照样过）。

## brainstorming 核实（grep/实测，推翻待办部分假设）

### 待办三条策略逐条核实

项目待办（`项目待办.md:101`）原文给出三条策略：① e2e beforeAll 清理 ② 验证不入库+首跑生成 ③ CI 跑前 rm -rf。逐条实测（对齐 [[plan-baseline-verify-grep]]，不照待办自述）：

| 策略 | 实测 | 结论 |
|---|---|---|
| ② 不入库 | `git ls-files test/e2e-scene/.godot/` = 0；`.gitignore:36` = `test/e2e-scene/.godot/` | **已为真**（无需做） |
| ③ CI rm -rf | ci.yml `godot-matrix`（行 110）用 `actions/checkout@v4`（行 125），仅缓存 npm（行 23/129），**无 `.godot/` 缓存** | **无必要**（CI 本就 fresh 干净起步） |
| ① beforeAll 清理 | `test/e2e-p1-p5.test.ts:48-51` beforeAll 只快照/还原 `.tscn` + 删截图，**无 `.godot/` 清理** | **真缺口** |

→ 范围从三条收窄到一条（beforeAll 清理）。用户选定 Option 1：仅本地 beforeAll 清理（不动 CI、不动 NVIDIA Corporation 残留）。

### 用法核实

- 唯一用 `test/e2e-scene/` 的测试 = `test/e2e-p1-p5.test.ts`（`E2E_DIR` 行 23）。grep `e2e-scene|E2E_DIR` 全 `test/` 仅命中此文件（`e2e-resilience-headless` 仅注释提及，用专用 fixture）。`e2e-full-tool-verification` / `data-import-integration` 不用此 fixture。
- 本地 `.godot/` 残留实测：`imported/test_2d_screenshot.png-*.ctex`+`.md5`（6-8，旧）、`uid_cache.bin`、`global_script_class_cache.cfg`、`editor/`（filesystem_cache/project_metadata/folding）。
- P3-import（行 168-178）断言 `existsSync(.godot/imported)===true`（行 176-177）——**正是假绿入口**：无清理时该目录残留即过，与本次是否真 warmup 无关。
- P3-skip（行 180）同 describe 内顺序执行：beforeAll wipe 后 P3-import（needsImport=true）重新 warmup 生成 imported，P3-skip（needsImport=false）仍验证第二次跳过——断言不变，且"第一次 warmup / 第二次 skip"的对照更干净（无清理时若上次运行已留 imported，连 P3-import 都 skip，对照被污染）。
- P1（addNode 纯文本）/ P2（scene_commit 纯 TS）/ P4（captureScreenshot 起 Godot 自建缓存）/ P5（executeGdscript 重生成）均不依赖预存 `.godot/`，wipe 安全。

## 设计

### 改动（`test/e2e-p1-p5.test.ts:48`，现有 beforeAll 顶部插入）

```ts
beforeAll(() => {
  // :101（报告4 P2-10）: 清理上次运行的 .godot 缓存（imported/uid_cache/editor 状态），
  // 让本地运行以 CI fresh-checkout 的干净状态起步，防过期导入缓存致假通过。
  // 无此清理时 P3-import 的 `.godot/imported` 存在断言会命中残留目录而假绿。
  // .godot/ 已 gitignore（行 36），CI fresh checkout 本就无此目录——清理纯为本地一致性。
  rmSync(resolve(E2E_DIR, '.godot'), { recursive: true, force: true });
  _snap3d = readFileSync(SCENE_3D, "utf-8");
  _snap2d = readFileSync(SCENE_2D, "utf-8");
});
```

- `rmSync`/`resolve` 已 import（行 12 `from 'fs'` / 行 13 `from 'path'`），**无新依赖**。
- `force:true`：路径不存在不抛错（CI / 首跑无 `.godot/` 安全）；`recursive:true`：递归清整个 `.godot/`。
- afterAll（行 55-60，还原 `.tscn` + 删截图）不动。

### 不变项 / 出范围

- `.gitignore:36` 已正确（不动）；ci.yml 不加 rm-rf（CI 已 fresh）。
- 出范围（Option 1 选定）：`test/e2e-scene/NVIDIA Corporation/` 运行时残留、CI 防御性 rm-rf。
- 不进 `defects.ts`（测试工程治理，非代码缺陷，对齐项目「测试缺口不进 defect 库」惯例）。
- CHANGELOG 补一行（test-quality 段）。

## 验收标准

1. beforeAll 含该 wipe 行（grep 可见）。
2. `tsc` 0 错 + 全量 `npm test` 绿：**基线实测 4277 passed | 24 skipped（4301），290 test files passed | 3 skipped**（HEAD `a581b6d`，`GODOT_PATH=D:\godot\Godot_v4.7-stable_win64.exe`，112s）——改动后须 ≥ 此（无新增 fail/skip）。
3. P3-import 在「预先塞入过期 `.godot/imported` marker」场景下仍绿，且断言命中本次 warmup 生成（非残留）——手测验证。
4. `.gitignore` / ci.yml 无回归（diff 只动 `test/e2e-p1-p5.test.ts` + CHANGELOG）。

## 验证（plan 阶段细化）

- 全量 `npm test` 对比基线（4277/24）。
- 手测 RED-GREEN：在 `.godot/imported/` 放过期 marker 文件 → 跑 e2e-p1-p5 → 确认 (a) marker 在 P3-import 前已被 beforeAll 清掉；(b) P3-import 后 `.godot/imported/` 由本次 warmup 重新生成（含 `test_2d_screenshot.png` 导入产物）；(c) 全绿。

## 相关

- 项目待办：`D:\workspace\Obsidian\GodotMCP\项目待办.md:101`
- 同族已闭环：:93/:94/:96/:97a（E-P1）/ :98（E-P2）/ :95（E-95）/ :97b（E-97b）
- 教训对齐：[[plan-baseline-verify-grep]]（基线 grep/实测，不照待办自述）
