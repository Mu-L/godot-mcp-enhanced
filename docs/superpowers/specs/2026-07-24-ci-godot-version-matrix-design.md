# CI Godot 版本矩阵设计

> 2026-07-24 | Godot AI 工程化追赶 · 子项目 1/3（CI 基础设施）
> brainstorming 闭环 → eng-review（r1，3 处修订：CRITICAL-1 blocking 真伪 + IMPORTANT-1 R1 风险面 + IMPORTANT-2 版本一致性）→ writing-plans → 实现
> 关联：[[项目待办]] Godot AI 工程化追赶；记忆 [[enhanced-editor-plugin-4.7-incompatible]]（super() 4.7 回归教训）

## 背景

Godot AI（`hi-godot/godot-ai`）工程化领先（CI 版本矩阵 / 分发 / 测试规模 2128）。enhanced 的 CI 当前只跑 **Godot 4.6.3 单版本**，且 `check:gdscript` 步骤标 `continue-on-error: true`。

历史教训：`654b162` 的 `super()` 回归是 4.7 编译问题（原生类虚函数禁 super()），本地发现迟、2026-07-04 才修。若有多版本编译门禁，本可在 CI 阶段拦住。

## 目标

1. CI 多版本 Godot 编译门禁（4.6 + 4.7），防版本特定回归
2. E2E 多版本覆盖（真跑 Godot 的集成测试 ×2 版本）
3. 多版本编译失败 → CI 红（真 blocking，非 continue-on-error 假象）

## 非目标（YAGNI）

- **不加 4.8**：2026-07 仍 dev 阶段（首个 dev snapshot 2026-07-06，stable 预估 Q4 2026）；加 dev 版矩阵 flaky。4.8 stable 后再加（matrix 结构预留）。
- **不 matrix Node 步骤**：lint/tsc/build/vitest 与 Godot 版本无关，保持单版本（避免 vitest 全量 90s × N）。
- **不加分版本 coverage 上传**：codecov 单 lcov 足够。
- **不改 check job 的 Node 侧逻辑 / score 6 维聚合**（lint/tsc/diff-matrix/budget/rules-bump/version-sync/vitest/score 全保留）。

## 现状

`D:\GitHub\godot-mcp-enhanced\.github\workflows\ci.yml` 两 job：

- **check**（ubuntu, node 24）：lint → tsc → build → diff-matrix → budget → rules-bump → version-sync → vitest（排除 game-bridge.test.ts，issue #15）→ Install Godot 4.6.3 → check:gdscript（`continue-on-error: true`）→ audit → score 系列（含 `score:gate`）
- **e2e-godot**（ubuntu, node 24）：Install Godot 4.6.3 → vitest E2E（e2e-full + e2e-p1-p5 + data-import-integration，批次 E P0-4 扩的白名单）

单 Godot 版本（4.6.3）。

## ⚠️ 反直觉事实（eng-review CRITICAL-1 核实，决定本设计）

**`check:gdscript` 本身 exit 0，即使编译 errors>0**：
- `check-gdscript.ts:124-126` 正常产出路径 `writeReport()` 后 main() return，**无 exit(1)**；errors 归入 report.json 但进程 exit 0。
- 唯一 `process.exit(1)` 在 `:133`，只在脚本**崩溃**时（spawn 抛错未 catch 等）。
- 所以 `ci.yml:57 continue-on-error: true` 是**冗余**的——加不加 check:gdscript 都 exit 0。

**现状 check job 的 gdscript blocking 真正来自下游 `score:gate`**：
- `collectors/gdscript.ts:47`：`errors >= 1 → score=0`
- `dimensions.ts:17`：gdscript 维度 gate 阈值 60，score<60 硬否决
- 即 check job 的"编译失败 CI 红"靠 score:gate 消费 `coverage/gdscript-report.json`，**不靠 check:gdscript 的退出码**。

**推论**：`godot-matrix` job 不能搬 `score:gate`（score 是 6 维，依赖 lcov/audit，矩阵 job 不跑 coverage）。godot-matrix 需独立的 gdscript-only gate。

## 设计

### 架构（2 job → 2 job，结构调整）

| job | 变更 |
|---|---|
| `check` | **保留** Install Godot 4.6.3 + check:gdscript（给 score:gate 供 gdscript 维度，不动 score 6 维语义）；**仅去** `continue-on-error: true`（冗余清理，无行为变化——check:gdscript 本就 exit 0）。其余 Node 侧 + score 全保留 |
| `godot-matrix`（**新增**） | matrix `4.6.3 + 4.7.1`，跑 check:gdscript + **gdscript-only gate**（真 blocking）+ E2E |
| `e2e-godot` | **删除**（E2E 移入 godot-matrix）|

> 注：check job 保留 check:gdscript（4.6.3）+ godot-matrix 也跑 check:gdscript（4.6.3/4.7.1），4.6.3 会跑两次。这是有意的——check job 的 check:gdscript 给 score:gate 供数（gdscript 维度 blocking），godot-matrix 的 check:gdscript 给多版本 gdscript-only gate。语义不同，重复可接受（编译快 ~30s）。

### `godot-matrix` job 骨架

```yaml
  godot-matrix:
    name: Godot ${{ matrix.name }}
    runs-on: ubuntu-latest
    timeout-minutes: 20
    strategy:
      fail-fast: false   # 一版本 fail 不取消另一版本，看全貌
      matrix:
        include:
          - name: "4.6.3"
            url: "https://github.com/godotengine/godot/releases/download/4.6.3-stable/Godot_v4.6.3-stable_linux.x86_64.zip"
            bin: "Godot_v4.6.3-stable_linux.x86_64"
          - name: "4.7.1"
            url: "https://github.com/godotengine/godot/releases/download/4.7.1-stable/Godot_v4.7.1-stable_linux.x86_64.zip"
            bin: "Godot_v4.7.1-stable_linux.x86_64"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: 'npm' }
      - run: npm ci --ignore-scripts
      - run: npm run build
      - name: Install Godot ${{ matrix.name }}
        run: |
          set -e
          curl -L --fail -o /tmp/godot.zip ${{ matrix.url }}
          mkdir -p /tmp/godot-bin
          unzip -o /tmp/godot.zip -d /tmp/godot-bin
          chmod +x /tmp/godot-bin/${{ matrix.bin }}
          echo "GODOT_PATH=/tmp/godot-bin/${{ matrix.bin }}" >> "$GITHUB_ENV"
      - name: Check gdscript（产出 report；正常路径 exit 0 即使 errors>0）
        run: npm run check:gdscript
        env: { GODOT_PATH: ${{ env.GODOT_PATH }} }
      - name: Gate gdscript（errors/incomplete → fail；check-gdscript.ts 不按退出码 gate，真 blocking 在此）
        run: node -e "const r=require('./coverage/gdscript-report.json'); if(r.incomplete||r.errors>0){console.error('gdscript gate FAIL',JSON.stringify(r));process.exit(1)}"
      - name: E2E (real Godot ${{ matrix.name }})
        run: npx vitest run test/e2e-full-tool-verification.test.ts test/e2e-p1-p5.test.ts test/tools/data-import-integration.test.ts --reporter=json --outputFile=coverage/e2e-report-${{ matrix.name }}.json
        env: { GODOT_PATH: ${{ env.GODOT_PATH }} }
      - name: Upload e2e-report
        if: always()
        uses: actions/upload-artifact@v4
        with: { name: e2e-report-${{ matrix.name }}, path: coverage/e2e-report-${{ matrix.name }}.json, if-no-files-found: warn }
```

### `check` job 变更（最小）

仅一处：`Check gdscript (M3c, non-blocking)` 步骤（ci.yml:55-59）去 `continue-on-error: true`。**不删该步骤**（保留给 score:gate 供 gdscript 维度）。注释更新为反映"blocking 经 score:gate，非退出码"。

其余 check job 步骤（lint/tsc/build/diff-matrix/budget/rules-bump/version-sync/vitest/Install Godot 4.6.3/check:gdscript/audit/score）全保留不变。

### gdscript blocking 机制（两 job 各司其职）

- **check job**：gdscript blocking 经 `score:gate`（现状，consume check job 的 gdscript-report.json，errors>=1→gdscript score=0<60→gate fail）。去 continue-on-error 是冗余清理，不改变此机制。
- **godot-matrix job**：gdscript blocking 经独立的 **gdscript-only gate** step（方案 C，零源码改动）。读 `coverage/gdscript-report.json`，`incomplete || errors>0` → `process.exit(1)`。incomplete 一并兜住（双保险，虽 Install 步骤 set -e + curl --fail 保证 GODOT_PATH 必设）。

## 风险

### R1：4.7.1 CI Linux 首跑（核心风险）

本地 Windows 4.7-stable 干净 ≠ CI Linux 4.7.1 干净。批次 C/D/E 的 4.7 验证是**本地 Windows**，CI 此前**从未跑过 4.7**（CI 只 4.6.3）。

**风险面（eng-review IMPORTANT-1 补充）**：不止编译/super() 类。`defects.md:1518-1527` 记 `windows-godot47-toolchain-failures`——Windows + Godot 4.7 下 verify_delivery / csv_to_resources / instance_scene 多工具失败。**该 defect 根因已隔离修复**（`:1527 update-2026-07-13`：A1 delivery 双盘符 `e0882c9` / A2 csv ctx.projectDir `4d5059f` / A3 scene-instance pack+save `e0882c9`，5 子项全修 FF-merge master），但**Windows 4.7 修复 ≠ Linux 4.7.1 CI 干净**。godot-matrix 的 E2E 含 data-import-integration（正是 csv 类），4.7.1 首跑红**更可能落在 E2E 而非编译**。

**缓解**：这正是矩阵核心价值（发现版本特定问题）。plan 实施：若 4.7.1 红，按"编译红→addon 4.7 兼容 / E2E 红→csv/instance_scene 类 4.7 运行时差异（关联 windows-godot47-toolchain-failures 排障路径）"分流。接受首个 PR 可能红，发现即修。

### R2：CI 时间增加

godot-matrix 两版本并行，每版本 Install(~30s) + check:gdscript(~30s) + E2E(~2-3min) ≈ 3-4 min，并行 wall-clock ~4 min。check job 去 continue-on-error 无时间影响。净增 ~4 min。可接受。

### R3：E2E 版本特定 flaky

E2E 真跑 Godot，版本特定行为差异可能导致 4.6/4.7 结果不同。`fail-fast: false` 保证看全貌。若某版本 E2E flaky，标记并单独治理（非阻塞矩阵落地）。

## 验收标准

1. push/PR 触发 `godot-matrix` job，4.6.3 + 4.7.1 两版本并行执行
2. **gdscript 真 blocking**：godot-matrix 的 gdscript-only gate 在 `errors>0 || incomplete` 时 `process.exit(1)` → job 红。**可验证条件**：故意注入一处 addon SCRIPT Error（如临时在 `addons/godot_mcp_server/` 某 .gd 加语法错），godot-matrix 红；撤掉即绿
3. E2E（e2e-full + e2e-p1-p5 + data-import-integration）两版本各跑一次
4. `check` job 保留 check:gdscript（给 score:gate），仅去 continue-on-error；Node 侧 + score 6 维不受影响（lint/tsc/vitest/score:gate 绿）
5. `e2e-godot` job 删除
6. 两版本均绿 = 通过（若 4.7.1 首跑红，按 R1 分流修至绿亦算达成，附修复 commit）

## 验证方式

CI 本身即验证。push 含此改动的 PR，观察 godot-matrix 两版本结果 + check job score:gate 仍绿。无单独测试代码（CI 配置改动）。

**验收#2 可验证条件**：本地或 CI 注入 addon SCRIPT Error，确认 godot-matrix 红（gate 生效），撤掉即绿。

## 实施前置（writing-plans 第一步）

- `curl -I` 验证 Godot 4.7.1 Linux binary URL 有效（`https://github.com/godotengine/godot/releases/download/4.7.1-stable/Godot_v4.7.1-stable_linux.x86_64.zip`）——eng-review ADVISORY：4.7.1 release 确认存在 2026-07-14，但 asset 精确命名未逐文件核（首次搜索"4.7.1 不存在"是幻觉，已交叉确认存在）
- 确认 4.6.3 Linux URL（ci.yml 现用，已验证）

## 后续（其他子项目，独立 spec）

- **子项目 2**：测试覆盖缺口（不追数字——当前 3971 passed 已超 Godot AI 2128；聚焦批次 E 识别的运行时韧性/集成/假绿/静态守卫有效性缺口）
- **子项目 3**：self-update 机制（需先定义"更新什么"：npm 包 / addon / 两者 / 版本检查通知）
