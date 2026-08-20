# 第三方审查报告:小白一条龙批 4a(demo GIF)

- **日期**:2026-08-20
- **分支**:`feat/xiaobai-batch4a-demo-gif`(3 commits + 处置 commit)
- **审查者**:code-reviewer 子代理(独立会话,33 次工具调用;LZW 逐时序手工推导 + GIF89a 逐字节手验 + 轴排序/中位切分核对)
- **spec/plan**:spec §3 批 4a;plan `docs/superpowers/plans/2026-08-20-xiaobai-batch4a-demo-gif.md`
- **原始判定**:**BLOCKING ISSUES**(1 B + 1 Important + 7 Nit)→ 全处置 → **SHIPPED**
- **终验**:lint/build 0 错;`npm test` 全绿(6062+9 新用例;首轮 2 个 ui e2e 超时为环境 flake——单独重跑 78/78 绿);B-1 修复真机复验:breakout `--seconds 5 --fps 3 --keys left,right` 空格形式全部生效(15 帧=3×5,14/14 相邻变化=挡板在动)

## 逐维度结论(审查者实测)

| 维度 | 结论 | 关键证据 |
|---|---|---|
| LZW 编码正确性 | ✅ PASS | 位宽增长时机编码/解码端逐 k 推导严格相等;CLEAR 重置/EOI/4096 边界/32 位安全全对 |
| 量化正确性 | ✅ PASS | 轴排序公式三轴全对(rgbKey 位序核验);中位切分不产空盒防死循环;直通零误差 |
| CLI 编排 | ⚠️→✅ | B-1(参数形式)/I-1(exit 旁路)已修;setup 链文案匹配实测存在 |
| 测试锚定 | ✅(带洞已补) | 测试不 import 生产解码器 ✓;同构拷贝≠独立锚定(审查者指出,已补外部可开+矩阵) |
| 仓库级约束 | ✅ | 零 GD 改动(「game is frozen; unfreeze before stepping」守卫确系 G1 批既有代码,mcp_bridge.gd:2405);npm files 覆盖;版本未动 |
| CHANGELOG/README 快照 | ✅ | 数字全一致;roadmap 双版已移 GIF |
| GIF89a 规范符合性 | ✅ PASS | 头部/LSD/GCT/Netscape/GCE/disposal/子块/Trailer 逐字节手验;delay≥10cs 避浏览器钳制 |

## Blocking/Important 与处置

### B-1:参数解析只认等号形式,README 空格示例静默失效(已修,置信 100)

- **事实**:README 双版示例 `gif . --seconds 8 --fps 4` 与 `--keys left,right` 均空格形式,而 `opt()` 只识别 `--name=value` → 参数静默回落默认值。`--seconds 8`/`--fps 4` 恰与默认相同掩盖 bug;**breakout 的 `--keys left,right` 失效 → 默认方向键注入 → 挡板不动 → GIF 内容实质错误**;`--out` 空格形式静默写默认路径且跳过确认门。
- **处置**(`src/cli/gif.ts`):opt() 支持双形式(`--name value` 相邻消费 + 等号);数值参数 `num()` 加 `Number.isFinite` 校验(非法值 exit 2 报真因,不再 NaN 传播)。真机复验:空格形式 fps/seconds/keys 全生效。

### I-1:try 内 process.exit 旁路 finally,游戏进程残留(已修)

- **事实**:有效帧不足路径 `process.exit(1)` 在 try 内,Node 立即终止 **finally 的 stop_project 不执行** → Godot 进程残留(实测复现:bridge auth 超时后需手动杀进程);NaN 参数传播放大此路径。
- **处置**:改 `throw`(异常冒泡前 finally 执行清理);配合 num() 校验 NaN 在源头拦截。

## Nits 与处置

| # | 内容 | 处置 |
|---|---|---|
| N-1 | 帮助口径 `--fps 2-5` vs 实现 1-10 三处不一 | ✅ 统一 1-10 |
| N-2 | user:// 截图残留不清理(每录 32 张数十 MB) | ✅ finally unlink capturedPngPaths(真机验证:本轮 0-14 全删,残留 17 个系**修复前代码**上轮遗留,已手动清) |
| N-3 | 数值参数无 NaN 校验 | ✅ num() Number.isFinite + exit 2 |
| N-4 | 项目内判断裸 startsWith(兄弟目录前缀混淆) | ✅ `startsWith(projectAbs + sep)` |
| N-5 | 测试矩阵洞(直通 5-128 色/空输入/4096 只抽样) | ✅ 补空输入用例 + 5/64/128 色直通 + 4096 全量比对(7→9 用例) |
| N-6 | 未 freeze 却调 unfreeze(旧设计残留) | ✅ 删 |
| N-7 | 帧率漂移未注明 | ✅ 代码注释(实际帧率略低于 --fps,demo 可接受) |

## 工程教训(登 memory)

1. **示例值与默认值相同会掩盖参数解析 bug**——验证命令必须至少用一个非默认值参数;CLI 参数形式契约(等号 vs 空格)与 README 逐字对齐。
2. **process.exit 在 try/finally 内 = finally 旁路**——凡起子进程的 CLI,失败路径走 throw 让 finally 清理。
3. **同构拷贝不是独立锚定**——测试内解码器逐字复刻生产实现只防回归不防共同误解;兜底是「外部工具打开产物」真第三方锚定。
