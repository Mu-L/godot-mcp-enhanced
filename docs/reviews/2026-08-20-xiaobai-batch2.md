# 第三方审查报告:小白一条龙批 2(Godot 自动安装 + 下载基建)

- **日期**:2026-08-20
- **分支**:`feat/xiaobai-batch2-godot-autoinstall`
- **审查者**:code-reviewer 子代理(独立会话,36 次工具调用;静态推演 + 真机落盘产物读取 + GitHub API 实测资产尺寸)
- **spec**:`docs/superpowers/specs/2026-08-20-xiaobai-onestop-roadmap-design.md` §3 批 2 / §2 B-3 / §5 未决项 1
- **plan**:`docs/superpowers/plans/2026-08-20-xiaobai-batch2-godot-autoinstall.md`(tar→自写 zip reader 为已声明偏差)
- **原始判定**:**SHIPPED WITH NITS**(2 Important + 5 Nit,无 Blocking)→ 全部处置 → **SHIPPED**
- **终验**:lint 0 error / build 0 error / `npm test` 全绿 / 真机 install 重测 18.5s(I-1 修复后含 validate 回读自检)/ `doctor` found 新装二进制

## 逐维度结论(审查者实测)

| 维度 | 结论 | 关键证据 |
|---|---|---|
| spec 符合性(B-3/域名白名单/SHA512 同源/落点/审计/setup 扩展/文档) | ✅ 全落位 | godot-finder.ts:112-118 优先级链;SHA512-SUMS.txt 经 GitHub API 实测存在(5,682B);THREAT_MODEL §2.1.1/README 双版/环境变量表四处口径一致 |
| 安全正确性 | ✅(含说明项) | URL 绕过推演(userinfo/大小写/路径遍历/端口)无逃逸;**config 写入口唯一**——全仓 grep `writeGodotPathsConfig` 唯一调用点 godot-installer.ts:203,MCP 工具层零引用,「不是 AI 可扩大的信任面」属实;TOCTOU 口径与 THREAT_MODEL §2.1 既有声明一致 |
| 测试质量 | ✅ 基本扎实 | mock fetch 3 用例无假绿(断言 fetchSpy 未调用);优先级链 5 用例真锁行为 |
| tar→zip reader 偏差 | ✅ 处置合理 | 偏差有真机失败证据(machine-audit.jsonl 行 6 "Cannot connect to C:");EOCD 扫描窗口覆盖规范全形态;zip64 不需要——**GitHub API 实测最大 asset 1.31GB < 4GB 阈值**,批 4b templates 同为 1GB 级安全余量充足 |
| 仓库级约束 | ✅ | src/tools 零引用 → 不触发 matrix/budget/rules-sync;改动面与声明一致 |
| 行为变化风险 | ✅ 披露充分 | 白名单收紧提示四处落位(install 输出/README 表/THREAT_MODEL) |
| CHANGELOG 快照 | ⚠️→✅ | 39 用例实测一致;15.1s 与审计行一致;**「60MB」失真(实测 86,013,866B ≈ 86MB)**已修正 |

## Important Issues 与处置

### I-1:linux/macOS 安装后二进制无执行位,虚假成功(已修,置信度 90)

- **机理**:自写 zip reader `writeFileSync` 落盘为 0644,POSIX 执行位丢失 → `validateGodotBinary` EACCES 恒 false → findGodot 跳过候选,而 install 照样报成功。Windows 不受影响(本批唯一实测平台),但 install 面向小白,mac/linux 小白拿到假成功。
- **处置**(`src/cli/godot-installer.ts:202-210`):非 Windows 平台 `chmod 0o755`;登记 config 前新增 `validateGodotBinary(godotPath)` **安装后自检**(失败即 throw + 审计 ok:false)——同时给 Windows 补上自检。真机重测 18.5s 通过。

### I-2:旧测试 `godot-finder.test.js:447` 环境依赖,跑过 install 的机器必红(**驳回 + 防御落地**)

- **审查者静态证明**:env 空 → 读真实 HOME 的 godot-paths.json → 本机非空 → back-compat 放行用例必红。
- **实现者运行时复核驳回**:该测试文件头部 `vi.mock('fs')`(readFileSync 被 mock 恒 undefined)→ `readGodotPathsConfig` 容错读 `[]` → 放行 → 实测 **35/35 全绿**(config 存在的机器上,`npx vitest run test/godot-finder.test.js` 两次复核)。审查者漏算 mock 层。
- **防御落地**(审查建议本身有价值):该 describe `beforeEach` 补 HOME/USERPROFILE 隔离到 tmpdir——防将来 fs mock 被移除时静默翻车(一行级成本)。

## Nits 与处置

| # | 内容 | 处置 |
|---|---|---|
| N-1 | CHANGELOG「60MB zip」失真(实测 86MB);「downloadAsset 通用函数」名不副实(实际 `buildReleaseUrls`+`downloadWithProgress`) | ✅ 已修正为实测数字与真实 API 名 |
| N-2 | 域名白名单只约束首跳,`redirect:'follow'` 重定向目标不校验;THREAT_MODEL 措辞暗示更宽保护面 | ✅ THREAT_MODEL §2.1.1 补明「白名单只约束首跳;内容防线是 SHA512 同源校验」 |
| N-3 | 穿越负向仅 `../evil.txt` 一形态 | ✅ 补 6 形态负向用例(反斜杠/盘符×2/绝对路径/嵌套/保留设备名),断言零解压产物 |
| N-4 | machine-audit 测试写真实 `~/.godot-mcp/`(已积累 11 条测试行) | ✅ FAKE_HOME 隔离(与 path-config.test.ts 同款) |
| N-5 | zip 保留设备名(CON/PRN/COM1)未拒 | ✅ `assertSafeEntryName` 补 `WINDOWS_RESERVED` 黑名单 |

## 值得进 memory 的工程教训(已登)

1. 新增机器级配置文件作为信任源时,该文件的全部消费测试必须同步隔离 HOME——否则既有测试可能静默变环境依赖(本例靠 fs mock 侥幸,已补显式隔离防御)。
2. 零依赖 zip 解压用 `writeFileSync` 落盘丢 POSIX 执行位——跨平台 installer 解压后必须 chmod 或 validate 回读,否则非 Windows 平台虚假成功(本例真机验证只覆盖了无权限位概念的 Windows)。
3. plan 技术选型被真机推翻时,落盘失败证据(审计行 + 注释)再换方案,跨会话可追溯。
