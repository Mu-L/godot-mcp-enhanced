# 第三方审查报告:小白一条龙批 3(可玩模板库第一期)

- **日期**:2026-08-20
- **分支**:`feat/xiaobai-batch3-game-templates`(6 commits:9899c7a..68b802a + 处置 commit)
- **审查者**:code-reviewer 子代理(独立会话,50 次工具调用;GDScript 全文精读 + 四件套逐条手验 + CSV↔tres 手验)
- **spec/plan**:spec §3 批 3 + 未决项 3;plan `docs/superpowers/plans/2026-08-20-xiaobai-batch3-game-templates.md`
- **原始判定**:**SHIPPED WITH NITS**(1 Blocking + 6 Nit)→ 全处置 → **SHIPPED**
- **终验**:`npm run lint/build/test` 全绿(**6055 passed**,新增 16 用例);三模板真机 qa 复验全绿(2048 6/6、snake 7/7、breakout 6/6,Godot 4.7.2 零编辑器预打开)

## 逐维度结论(审查者实测)

| 维度 | 结论 | 关键证据 |
|---|---|---|
| spec 四件套标准 | ✅ | 21 资产文件零外部资源引用(grep preload/texture/OS./FileAccess 等);三 GDD 8 段与 GDD_REQUIRED_SECTIONS 逐字吻合;三 qa 均含 freeze+seed+时间线;三组 CSV↔tres 手验全等值 |
| GDScript 逻辑 | ✅ 无功能 bug | 2048 合并语义手推([2,2,2]→[4,2] 防双并 ✓);snake 尾格让位经典正确实现+180° 防护 ✓;breakout AABB 穿透最小轴/挡板偏移角/单帧一砖 ✓;隧穿手验(6px/帧 vs 24px 砖厚)安全 |
| 确定性主张 | ✅ | grep `RandomNumberGenerator\|randomize` 零命中;全部 randi_range/randf/randf_range 全局 RNG |
| 测试质量 | ⚠️→✅ | 15 用例静态清点属实;**「未知模板报错」测错层**(B-1);init 测试 cwd 处理正确 |
| 仓库级约束 | ✅ | reflog 6 commits 核对;src/tools 零触碰三重间接证据(mtime 反推/版本未 bump 反证 rule-templates 未动/架构不需要);files 字段与拷贝目标一致 |
| CHANGELOG/README 快照 | ✅ | 数字全吻合;roadmap「内置可玩模板库」确已移出(ROADMAP.md grep 证实) |
| 跨平台风险 | ✅ | 模板 .gd 零平台敏感 API;冷启动竞态已文档化;snake/breakout 起播漂移鲁棒性独立轨迹推演成立 |

## Blocking Issues 与处置

### B-1:init 对未知模板静默降级为空骨架,测试测错层(已修)

- **事实**:plan Task 2 验收点「未知模板报错列出可用项」——实现中 `GAME_TEMPLATES[template]` falsy 直接落空骨架分支无报错;测试用例名义覆盖该验收点,实际测的是底层 `readGameTemplateFiles` 的 throw,init 入口的真实路径未被测——「测试标题 ≈ plan 验收点」≠「测试测的就是那层」。
- **处置**(`src/cli/init.ts:36-40`):`template !== 'empty' && !GAME_TEMPLATES[template]` → console.error 列出可用项 + exit 1;补 init 层测试(spy process.exit/console.error,断言报错含可用清单 + 不建目录)。

## Nits 与处置(全修)

| # | 内容 | 处置 |
|---|---|---|
| N-1 | `four_probability` 字段名反语义(实为出 2 概率) | ✅ 四件套全链改名 `two_probability`(gd×2/csv/tres/GDD),复验 qa 绿 |
| N-2 | GDD 钳制描述与实现不符 ×2 | ✅ GDD 文字对齐实现;snake `initial_length` 钳上限改 `_n/2`(防初始身体负坐标) |
| N-3 | breakout GDD AC-3(碎砖断言)与 qa 不符;AC-2 绝对确定性主张过强 | ✅ AC-3 改为与 qa 一致(lives/game_over);AC-2 加「输入驱动型状态」限定 |
| N-4 | breakout `or true` 调试残留;GAP_BORDER 函数不符风格 | ✅ 删残留;改 `const` |
| N-5 | breakout GDD「AreaRect」笔误(Godot 无此节点) | ✅ 改 ColorRect |
| N-6 | `readGameTemplateFiles` incomplete throw 分支零直测;init 测试 sandbox 失败残留 | throw 分支由资产实存测试间接锁住(审查确认效果等价),标注不补;sandbox 残留无害(已在 B-1 用例内处理 chdir) |

## 工程教训(登 memory)

1. **测试标题 ≈ plan 验收点 ≠ 测试测的就是那层**——CLI 行为必须 CLI 层测,底层函数 throw 的覆盖会制造名义覆盖假象。
2. **freeze 锁「现在」不锁「过去」**——自由飞行型状态(球轨迹)的绝对终态断言 flaky,输入驱动型状态天然免疫;qa 断言按此分类选 tolerance 策略。
3. **GDD 的钳制/防御描述会随实现漂移**——GDD 是「AI 拿着它继续迭代」的真源,Edge Cases 段合入前应逐条对照实现 clamp 代码复核。
