# 第三方审查报告:小白一条龙批 4b(Web 试玩闭环)

- **日期**:2026-08-20
- **分支**:`feat/xiaobai-batch4b-web-play`(PR #51,4+处置 commits)
- **审查者**:code-reviewer 子代理(独立会话,45 次工具调用;防穿越逐攻击面人工推演 + zip64/续传语义核析)
- **spec/plan**:spec §3 批 4b(B-2 处置);plan `docs/superpowers/plans/2026-08-20-xiaobai-batch4b-web-play.md`
- **原始判定**:**SHIPPED WITH NITS**(0 Blocking + 8 Nit)→ 全处置(1 项实测驳回)→ **SHIPPED**
- **终验**:CI 三绿(check 含平台自适应修复)/ lint+build 0 错 / 受影响四测试文件 67/67 / 真机端到端 EXPORT OK + serve 200×3 + 403×2

## 逐维度结论(审查者实测)

| 维度 | 结论 | 关键证据 |
|---|---|---|
| 安全(防穿越) | ✅ | 13 个攻击面逐项推演全拒(双斜杠/%00/短名/大小写盘符/UNC/双重编码/词法越界);仅 127.0.0.1 硬编码;MIME 表外一律 octet-stream 不猜执行;**symlink 跟随为设计边界**(威胁模型内可接受,N-7 记录) |
| 下载续传 | ✅(N-3) | 206/200 分流正确;SHA512 全文件兜底;失败删半成品 |
| zip64 补丁 | ✅ | locator 紧邻假设符合 ZIP 规范固定布局;u64 精度 2^53 覆盖;批 4a/2 既有用例零回归 |
| templates 安装 | ✅ | 版本串双保险防注入;同盘 rename 原子;plan 中间层描述为**正确偏差**(Godot 实际无 templates/ 中间层) |
| web.ts 编排 | ✅ | 非 TTY 默认拒(设计意图);SIGINT 幂等;参数双形式 |
| 模板结构变更 | ✅(N-1/N-6) | 运行时 .tres 路径未变零影响;注册表/测试/GDD/init 同步 |
| 仓库级约束 | ✅ | rule-templates/matrix 零触碰;版本未 bump 合规 |

## Nits 与处置

| # | 内容 | 处置 |
|---|---|---|
| N-5(合并前必查) | npm pack glob 可能不收 dotfile(.gdignore 缺包→模板 init 硬失败) | **实测驳回**:`npm pack --dry-run \| grep gdignore` 3 个 .gdignore 全在包内(packlist 对 `**` 收 dotfile)——无需改 files |
| N-1/N-6 | 4 处注释旧路径 | ✅ 已改 tuning-src |
| N-2 | createReadStream 无 error 监听,文件被删会崩常驻 serve | ✅ `stream.on('error', () => res.destroy())` |
| N-3 | 续传起点用内存计数领先未 flush 缓冲 | ✅ 重试前 `statSync(destPath).size` 校正 |
| N-4 | 续传零单测/helper require 冗余/zip64 usize 分支无覆盖 | ✅ 补 2 个续传单测(**真断连 mock**:ReadableStream 中途 error;覆盖 206 续传与 200 全量重下两分支——N-3 竞态在 mock 中显形并按双分支语义断言最终产物);删 require 冗余;usize 分支留(官方 tpz 现实不命中) |
| N-7 | symlink 跟随设计边界 | 记录:未来 serve 不受信目录需 realpathSync |
| N-8 | CHANGELOG 笔误/plan 中间层未回写 | ✅ 笔误已修;plan 保留原样(偏差已在 CHANGELOG 与本报告实录) |

## 工程教训(登 memory)

1. **规范 URL 客户端会消掉 %2e%2e 段**——穿越负向测试必须用 {path} 形态 raw 直发(本批已固化为惯例)。
2. **资产 <4GB ≠ 非 zip64**(打包器可保守写 EOCD64)——zip 支持子集按实际资产字节复核,不按体积推断。
3. **dotfile 进 npm 包要实证**(packlist glob 行为实现细节)——`npm pack --dry-run` 为门禁。
4. **内存计数 ≠ 磁盘事实**——流式下载续传起点以 statSync 为准,并保留全文件哈希兜底。
