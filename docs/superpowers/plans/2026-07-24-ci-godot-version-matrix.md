# CI Godot 版本矩阵实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> 注：本计划是 CI 配置改动（.github/workflows/ci.yml），非产品代码。无传统单元测试 TDD——验证靠"本地 yaml/gate 模拟 + CI 真 matrix 跑 + 验收#2 注入测试"。Task 3/4 涉及 CI 异步执行，需 controller push/PR 后等待。

**Goal:** CI 新增 godot-matrix job 跑 Godot 4.6.3 + 4.7.1 双版本编译门禁（gdscript-only gate 真 blocking）+ E2E，防版本特定回归。

**Architecture:** ci.yml 从 2 job（check + e2e-godot）重构为 2 job（check + godot-matrix）。check job 保留 check:gdscript 给 score:gate 供数（仅去 continue-on-error 冗余）；godot-matrix job 新增（matrix 双版本 check:gdscript + gdscript-only gate + E2E）；e2e-godot job 删除（E2E 移入 godot-matrix）。

**Tech Stack:** GitHub Actions（actions/checkout@v4, setup-node@v4, upload-artifact@v4），Godot 4.6.3/4.7.1 stable linux.x86_64，vitest E2E，node 24。

## Global Constraints

- **Godot 版本**：仅 4.6.3 + 4.7.1（linux.x86_64 stable），**不加 4.8**（dev 阶段）
- **check job 保留 check:gdscript**（给 score:gate 供 gdscript 维度，不搬走——搬走会破坏 score 6 维）；仅去 `continue-on-error: true` 冗余
- **godot-matrix 的 gdscript blocking** 靠 gdscript-only gate step（`errors>0 || incomplete → process.exit(1)`），**不**搬 score:gate（6 维依赖 lcov/audit，矩阵 job 无 coverage）
- **不 matrix Node 步骤**（lint/tsc/vitest 与 Godot 无关，单版本）
- **fail-fast: false**（一版本 fail 不取消另一，看全貌）
- 路径绝对引用（CLAUDE.md 规范）
- spec 权威：`D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-24-ci-godot-version-matrix-design.md`

---

### Task 1: 前置验证（zip URL + ci.yml 基线）

**Files:**
- Read: `D:\GitHub\godot-mcp-enhanced\.github\workflows\ci.yml`

**Interfaces:**
- Produces: 确认的 4.6.3/4.7.1 zip URL + ci.yml 当前 job 行号基线（Task 2 改动锚点）

- [ ] **Step 1: 验证 4.7.1 Linux zip URL（eng-review ADVISORY）**

Run:
```bash
curl -I -L "https://github.com/godotengine/godot/releases/download/4.7.1-stable/Godot_v4.7.1-stable_linux.x86_64.zip"
```
Expected: `HTTP/2 200`（最终 200，-L 跟随重定向）。

若非 200：到 `https://github.com/godotengine/godot/releases/tag/4.7.1-stable` 找正确 linux.x86_64 asset 名（可能 `Godot_v4.7.1-stable_linux.x86_64.zip` 或带后缀）。**注意**：首次 WebSearch 可能返"4.7.1 不存在"幻觉，4.7.1 release 2026-07-14 确实存在。

- [ ] **Step 2: 确认 4.6.3 Linux zip URL（ci.yml 现用）**

Run:
```bash
curl -I -L "https://github.com/godotengine/godot/releases/download/4.6.3-stable/Godot_v4.6.3-stable_linux.x86_64.zip"
```
Expected: `HTTP/2 200`。

- [ ] **Step 3: 记录 ci.yml 当前 job 基线**

Run:
```bash
grep -n "^  [a-z].*:\|^  check:\|^  e2e-godot:\|continue-on-error\|Install Godot\|Check gdscript\|Run E2E" D:/GitHub/godot-mcp-enhanced/.github/workflows/ci.yml
```
Expected: 输出 check job（:9）、e2e-godot job（:107）、check:gdscript continue-on-error（:57）、Install Godot 4.6.3（:46, :119）等行号。Task 2 按此基线改动。

---

### Task 2: ci.yml 重构（godot-matrix + check 调整 + 删 e2e-godot）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\.github\workflows\ci.yml`

**Interfaces:**
- Consumes: Task 1 确认的 zip URL + 行号基线
- Produces: 重构后的 ci.yml（godot-matrix job + check 去 continue-on-error + 无 e2e-godot）

- [ ] **Step 1: 删除 e2e-godot job**

删除 ci.yml 中整个 `e2e-godot` job（约 :106-136，从 `# 第3项-B: 用真实 Godot...` 注释到文件末尾 `if-no-files-found: warn`）。E2E 移入 godot-matrix（Step 3）。

- [ ] **Step 2: check job 去 continue-on-error + 注释更新**

定位 check job 的 `Check gdscript (M3c, non-blocking)` step（约 :55-59）：

旧：
```yaml
      - name: Check gdscript (M3c, non-blocking)
        run: npm run check:gdscript
        continue-on-error: true
        env:
          GODOT_PATH: ${{ env.GODOT_PATH }}
```

新（去 continue-on-error + 注释反映"blocking 经 score:gate"）：
```yaml
      - name: Check gdscript（产出 report；blocking 经下游 score:gate，本步 exit 0 即使 errors>0）
        run: npm run check:gdscript
        env:
          GODOT_PATH: ${{ env.GODOT_PATH }}
```

> 不删此步（保留给 score:gate 供 gdscript 维度）。

- [ ] **Step 3: 新增 godot-matrix job**

在 ci.yml 末尾（删 e2e-godot 后的位置）追加：

```yaml
  # Godot 多版本矩阵（4.6.3 + 4.7.1）：编译门禁（gdscript-only gate 真 blocking）+ E2E。
  # check job 的 gdscript blocking 经 score:gate（6 维）；本 job 不跑 score（无 lcov/audit），
  # 用独立 gdscript-only gate 消费 coverage/gdscript-report.json。
  godot-matrix:
    name: Godot ${{ matrix.name }}
    runs-on: ubuntu-latest
    timeout-minutes: 20
    strategy:
      fail-fast: false
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
        with:
          node-version: 24
          cache: 'npm'
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
        env:
          GODOT_PATH: ${{ env.GODOT_PATH }}
      - name: Gate gdscript（errors/incomplete → fail；真 blocking 在此，非 check:gdscript 退出码）
        run: node -e "const r=require('./coverage/gdscript-report.json'); if(r.incomplete||r.errors>0){console.error('gdscript gate FAIL',JSON.stringify(r));process.exit(1)}"
      - name: E2E (real Godot ${{ matrix.name }})
        run: npx vitest run test/e2e-full-tool-verification.test.ts test/e2e-p1-p5.test.ts test/tools/data-import-integration.test.ts --reporter=json --outputFile=coverage/e2e-report-${{ matrix.name }}.json
        env:
          GODOT_PATH: ${{ env.GODOT_PATH }}
      - name: Upload e2e-report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-report-${{ matrix.name }}
          path: coverage/e2e-report-${{ matrix.name }}.json
          if-no-files-found: warn
```

- [ ] **Step 4: 本地 gdscript-only gate 命令模拟（证 gate 逻辑）**

构造 errors:1 的 report → gate 应 exit 1：
```bash
mkdir -p D:/GitHub/godot-mcp-enhanced/coverage
echo '{"errors":1,"warnings":0,"files":25}' > D:/GitHub/godot-mcp-enhanced/coverage/gdscript-report.json
cd D:/GitHub/godot-mcp-enhanced && node -e "const r=require('./coverage/gdscript-report.json'); if(r.incomplete||r.errors>0){console.error('gdscript gate FAIL',JSON.stringify(r));process.exit(1)}"; echo "EXIT=$?"
```
Expected: 输出 `gdscript gate FAIL {"errors":1,...}` + `EXIT=1`。

构造 errors:0 的 report → gate 应 exit 0：
```bash
echo '{"errors":0,"warnings":0,"files":25}' > D:/GitHub/godot-mcp-enhanced/coverage/gdscript-report.json
cd D:/GitHub/godot-mcp-enhanced && node -e "const r=require('./coverage/gdscript-report.json'); if(r.incomplete||r.errors>0){console.error('gdscript gate FAIL',JSON.stringify(r));process.exit(1)}"; echo "EXIT=$?"
```
Expected: 无 FAIL 输出 + `EXIT=0`。

清理：
```bash
rm D:/GitHub/godot-mcp-enhanced/coverage/gdscript-report.json
```

- [ ] **Step 5: 本地 yaml 语法验证**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('D:/GitHub/godot-mcp-enhanced/.github/workflows/ci.yml')); print('YAML OK')"
```
Expected: `YAML OK`。

若系统无 pyyaml，fallback：`node -e "const fs=require('fs'); const t=fs.readFileSync('D:/GitHub/godot-mcp-enhanced/.github/workflows/ci.yml','utf8'); console.log(t.includes('godot-matrix:') && t.includes('Gate gdscript') && !t.includes('e2e-godot:') ? 'STRUCTURE OK' : 'STRUCTURE WRONG')"` Expected: `STRUCTURE OK`（确认 godot-matrix 存在 + Gate step 存在 + e2e-godot 已删）。

- [ ] **Step 6: Commit**

```bash
git -C "D:/GitHub/godot-mcp-enhanced" add .github/workflows/ci.yml
git -C "D:/GitHub/godot-mcp-enhanced" commit -m "ci(matrix): Godot 4.6.3+4.7.1 多版本编译门禁 + E2E

新增 godot-matrix job（matrix 双版本，check:gdscript + gdscript-only gate 真 blocking + E2E），check job 去 continue-on-error 冗余（保留 check:gdscript 给 score:gate），删 e2e-godot job（E2E 移入 godot-matrix）。

gdscript-only gate：check-gdscript.ts 正常 exit 0 即使 errors>0，真 gate 在此 step（errors/incomplete→exit 1）。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: CI 验证（push/PR + matrix 两版本）

**Files:** 无（CI 异步验证）

**Interfaces:**
- Consumes: Task 2 的 ci.yml commit
- Produces: CI matrix 两版本绿（或 4.7.1 红→修至绿）

> ⚠️ 本 task 需 controller 协调：push 分支 + 开 PR + 等 CI（异步，~10-15 min）。subagent 无法等 CI。

- [ ] **Step 1: push 分支 + 开 PR**

```bash
git -C "D:/GitHub/godot-mcp-enhanced" checkout -b ci/godot-version-matrix
git -C "D:/GitHub/godot-mcp-enhanced" push -u origin ci/godot-version-matrix
gh pr create --title "ci: Godot 4.6.3+4.7.1 多版本编译门禁" --body "godot-matrix job 双版本编译+E2E，gdscript-only gate 真 blocking。spec: docs/superpowers/specs/2026-07-24-ci-godot-version-matrix-design.md"
```

- [ ] **Step 2: 等 CI，看 godot-matrix 两版本**

```bash
gh pr checks --watch
```
Expected: `Godot 4.6.3` + `Godot 4.7.1` 两个 matrix 实例 + `check` job。

- [ ] **Step 3: 看 check job score:gate 仍绿**

确认 check job 绿（lint/tsc/vitest/score:gate 不受影响——check:gdscript 保留给 score:gate）。

- [ ] **Step 4: 若 4.7.1 红，按 R1 分流**

- **编译红**（gdscript-only gate FAIL）：addon 4.7 兼容问题。查 `coverage/gdscript-report.json` 的 details（download artifact `e2e-report-4.7.1` 或 godot-matrix 日志），定位 .gd 编译错，修 addon 4.7 兼容。
- **E2E 红**（csv/instance_scene 类）：关联 `defects.md` `windows-godot47-toolchain-failures`（:1518-1527，Windows 已修 A1/A2/A3 但 Linux 4.7.1 首跑可能新差异）。查 E2E 失败具体工具，定位 4.7 运行时差异，修。
- 修复后 push 同分支，重跑 CI 至绿。commit 修复。

---

### Task 4: 验收#2 gate CI 真验（注入 SCRIPT Error）

**Files:**
- Modify（临时）: `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\plugin.cfg` 或某 .gd（注入语法错）

**Interfaces:**
- Consumes: Task 3 绿的 PR
- Produces: 验证 gdscript-only gate 在 CI 真生效（errors>0 → 红）

> ⚠️ 本 task 在 CI 跑两轮（注入红 + 撤绿），~20-30 min。可选——Task 2 Step 4 本地 gate 模拟已证 gate 逻辑，本 task 是 CI 端真验。若 CI 时间敏感可跳过（本地模拟 + Task 3 两版本绿已足够）。

- [ ] **Step 1: 临时注入 addon SCRIPT Error**

在 `addons/godot_mcp_server/plugin.cfg` 末尾加一行无害错，或更直接——在某 .gd 临时加语法错（如 `addons/godot_mcp_server/command_handler.gd` 首行加 `func broken(:`）。建议用 .gd（check:gdscript 编译 .gd）：

```bash
# 临时破坏一个 .gd（记录原内容便于恢复）
cp D:/GitHub/godot-mcp-enhanced/addons/godot_mcp_server/command_handler.gd /tmp/command_handler.gd.bak
printf 'func broken(:\n' >> D:/GitHub/godot-mcp-enhanced/addons/godot_mcp_server/command_handler.gd
```

- [ ] **Step 2: push → godot-matrix 红（验 gate 生效）**

```bash
git -C "D:/GitHub/godot-mcp-enhanced" add addons/godot_mcp_server/command_handler.gd
git -C "D:/GitHub/godot-mcp-enhanced" commit -m "test(matrix): 临时注入 SCRIPT Error 验 gdscript-only gate（撤回）"
git -C "D:/GitHub/godot-mcp-enhanced" push
gh pr checks --watch
```
Expected: `Godot 4.6.3` + `Godot 4.7.1` 均 `Gate gdscript` step FAIL（`gdscript gate FAIL`，exit 1）。**这证明 gate 真 blocking**（若 gate 不生效，编译错但 CI 绿=验收#2 失败）。

- [ ] **Step 3: 撤 SCRIPT Error → push → 两版本绿**

```bash
cp /tmp/command_handler.gd.bak D:/GitHub/godot-mcp-enhanced/addons/godot_mcp_server/command_handler.gd
git -C "D:/GitHub/godot-mcp-enhanced" add addons/godot_mcp_server/command_handler.gd
git -C "D:/GitHub/godot-mcp-enhanced" commit -m "test(matrix): 撤临时 SCRIPT Error（gate 验证通过）"
git -C "D:/GitHub/godot-mcp-enhanced" push
gh pr checks --watch
```
Expected: 两版本均绿。

- [ ] **Step 4: 合 PR + 清理**

```bash
gh pr merge ci/godot-version-matrix --squash --delete-branch
rm /tmp/command_handler.gd.bak
```

---

## 验收对齐（spec 6 条）

1. ✅ Task 3 Step 2：godot-matrix 4.6.3+4.7.1 两版本并行
2. ✅ Task 2 Step 4（本地）+ Task 4（CI）：gdscript-only gate errors>0→红
3. ✅ Task 2 Step 3 + Task 3：E2E 两版本
4. ✅ Task 2 Step 2 + Task 3 Step 3：check job 保留 check:gdscript，score:gate 绿
5. ✅ Task 2 Step 1：e2e-godot job 删除
6. ✅ Task 3 Step 4：4.7.1 红则修至绿（R1 分流）
