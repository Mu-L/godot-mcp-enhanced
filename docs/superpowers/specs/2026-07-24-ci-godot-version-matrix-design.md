# CI Godot 版本矩阵设计

> 2026-07-24 | Godot AI 工程化追赶 · 子项目 1/3（CI 基础设施）
> brainstorming 闭环 → writing-plans → 实现
> 关联：[[项目待办]] Godot AI 工程化追赶；记忆 [[enhanced-editor-plugin-4.7-incompatible]]（super() 4.7 回归教训）

## 背景

Godot AI（`hi-godot/godot-ai`）工程化领先（CI 版本矩阵 / 分发 / 测试规模 2128）。enhanced 的 CI 当前只跑 **Godot 4.6.3 单版本**，且 `check:gdscript` 是 **non-blocking**（`continue-on-error: true`，GDScript 编译失败 CI 也不红）。

历史教训：`654b162` 的 `super()` 回归是 4.7 编译问题（原生类虚函数禁 super()），本地发现迟、2026-07-04 才修。若有多版本编译门禁，本可在 CI 阶段拦住。

## 目标

1. CI 多版本 Godot 编译门禁（4.6 + 4.7），防版本特定回归
2. E2E 多版本覆盖（真跑 Godot 的集成测试 ×2 版本）
3. `check:gdscript` 改 blocking，消除 non-blocking 假绿

## 非目标（YAGNI）

- **不加 4.8**：2026-07 仍 dev 阶段（首个 dev snapshot 2026-07-06，stable 预估 Q4 2026）；加 dev 版矩阵 flaky。4.8 stable 后再加（matrix 结构预留）。
- **不 matrix Node 步骤**：lint/tsc/build/vitest 与 Godot 版本无关，保持单版本（避免 vitest 全量 90s × N）。
- **不加分版本 coverage 上传**：codecov 单 lcov 足够，分版本复杂度低收益。
- **不改 check job 的 Node 侧逻辑**（lint/tsc/diff-matrix/budget/rules-bump/version-sync/score 全保留）。

## 现状

`D:\GitHub\godot-mcp-enhanced\.github\workflows\ci.yml` 两 job：

- **check**（ubuntu, node 24）：lint → tsc → build → diff-matrix → budget → rules-bump → version-sync → vitest（排除 game-bridge.test.ts，issue #15）→ **Install Godot 4.6.3** → **check:gdscript（continue-on-error 假绿）** → audit → score 系列
- **e2e-godot**（ubuntu, node 24）：Install Godot 4.6.3 → vitest E2E（e2e-full + e2e-p1-p5 + data-import-integration，批次 E P0-4 刚扩白名单）

单 Godot 版本（4.6.3）。check:gdscript non-blocking。

## 设计

### 架构（2 job 重构，仍 2 job）

| job | 变更 |
|---|---|
| `check` | **去掉** Godot 步骤（Install Godot 4.6.3 + check:gdscript 移出），保留 Node 侧 + score |
| `godot-matrix`（**新增**） | matrix `4.6.3 + 4.7.1`，跑 check:gdscript（blocking）+ E2E |
| `e2e-godot` | **删除**（E2E 移入 godot-matrix）|

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
      - name: Check gdscript (blocking，多版本编译门禁)
        run: npm run check:gdscript
        env: { GODOT_PATH: ${{ env.GODOT_PATH }} }
      - name: E2E (real Godot ${{ matrix.name }})
        run: npx vitest run test/e2e-full-tool-verification.test.ts test/e2e-p1-p5.test.ts test/tools/data-import-integration.test.ts --reporter=json --outputFile=coverage/e2e-report-${{ matrix.name }}.json
        env: { GODOT_PATH: ${{ env.GODOT_PATH }} }
      - name: Upload e2e-report
        if: always()
        uses: actions/upload-artifact@v4
        with: { name: e2e-report-${{ matrix.name }}, path: coverage/e2e-report-${{ matrix.name }}.json, if-no-files-found: warn }
```

### `check` job 变更

删两步（移到 godot-matrix）：
- `Install Godot 4.6.3 (M3c, job-isolated)`（:46-54）
- `Check gdscript (M3c, non-blocking)`（:55-59）

其余 Node 侧步骤（lint/tsc/build/diff-matrix/budget/rules-bump/version-sync/vitest/audit/score）全保留不变。

### `check:gdscript` 改 blocking

去掉 `continue-on-error: true`。在 godot-matrix job 内 blocking（编译失败 CI 红）。

**前提满足**：addon（addons/godot_mcp_server）4.6.2 + 4.7.1 `--import` 本地实测干净（批次 C/D/E 双版本编译验证）。

**incomplete 保护**：`check-gdscript.ts` 在 GODOT_PATH 缺失时返 `incomplete`（非 fail）。但 Install Godot 步骤 `set -e` + `curl --fail` 保证 Godot 装不上则 job 在 check:gdscript 之前就 fail。所以 incomplete 路径在 CI 不触发（GODOT_PATH 必设）。

## 风险

### R1：4.7.1 CI Linux 首跑（核心风险）

本地 Windows 4.7-stable 编译干净 ≠ CI Linux 4.7.1 编译干净。批次 C/D/E 的 4.7 验证是**本地 Windows**，CI 此前**从未跑过 4.7**（CI 只 4.6.3）。

**影响**：首批含此 matrix 的 PR，4.7.1 可能编译或 E2E 红。

**缓解**：这正是矩阵的核心价值（发现版本特定问题，如 super() 回归类）。plan 实施：若 4.7.1 CI fail，定位是 addon 4.7 兼容问题（非 CI 配置问题）→ 修 addon → 绿。接受首个 PR 可能红，发现即修。

### R2：CI 时间增加

godot-matrix 两版本并行，每版本 Install(~30s) + check:gdscript(~30s) + E2E(~2-3min) ≈ 3-4 min，并行 wall-clock ~4 min。check job 去掉 Godot 步骤反而省 ~1 min。净增 ~3 min。可接受。

### R3：E2E 版本特定 flaky

E2E 真跑 Godot，版本特定行为差异可能导致 4.6/4.7 结果不同。`fail-fast: false` 保证看全貌。若某版本 E2E flaky，标记并单独治理（非阻塞矩阵落地）。

## 验收标准

1. push/PR 触发 `godot-matrix` job，4.6.3 + 4.7.1 两版本并行执行
2. `check:gdscript` 在 godot-matrix 内 **blocking**（编译失败 CI 红，不再 continue-on-error）
3. E2E（e2e-full + e2e-p1-p5 + data-import-integration）两版本各跑一次
4. `check` job 不再含 Godot 安装/check:gdscript 步骤（Node 侧不受影响，lint/tsc/vitest/score 绿）
5. `e2e-godot` job 删除
6. 两版本均绿 = 通过（若 4.7.1 首跑红，修 addon 4.7 兼容至绿亦算达成，附修复 commit）

## 验证方式

CI 本身即验证。push 含此改动的 PR，观察 godot-matrix 两版本结果。无单独测试代码（CI 配置改动）。

本地预演（可选）：Windows 本地已有 4.7-stable，可 `GODOT_PATH=<4.7> npm run check:gdscript` 确认 addon 4.7 编译干净（降低 R1 的本地侧把握）。

## 实施前置

- 确认 Godot 4.7.1 Linux binary URL 有效（`https://github.com/godotengine/godot/releases/download/4.7.1-stable/Godot_v4.7.1-stable_linux.x86_64.zip`）
- 确认 4.6.3 Linux URL（ci.yml 现用，已验证）

## 后续（其他子项目，独立 spec）

- **子项目 2**：测试覆盖缺口（不追数字——当前 3971 passed 已超 Godot AI 2128；聚焦批次 E 识别的运行时韧性/集成/假绿/静态守卫有效性缺口）
- **子项目 3**：self-update 机制（需先定义"更新什么"：npm 包 / addon / 两者 / 版本检查通知）
