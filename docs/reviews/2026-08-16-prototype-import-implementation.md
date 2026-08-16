# 实施审查:原型翻译层 + 视觉验收(2026-08-16)

- 分支:`feat/prototype-import`(4109757..bd54ba3,9 commits,版本 0.30.3→0.31.2)
- 流程:spec v2(第三方审查 BLOCKING 2+N 6 全消解)→ 5 任务 SDD(各双裁定)→ 整分支终审 With fixes(I-1/I-2/I-3+2 Minor)→ 修复波 bd54ba3(含负例验证)→ 复核 **Ready to merge: Yes**
- spec:`docs/superpowers/specs/2026-08-16-prototype-import-design.md`;spec 审查:`docs/reviews/2026-08-16-prototype-import-spec.md`;plan:`docs/superpowers/plans/2026-08-16-prototype-import.md`

## 交付面(v0.31.2)

| 能力 | 入口 | 要点 |
|------|------|------|
| 原型几何翻译器 | `src/tools/ui/prototype-import.ts`(纯函数,零 Godot 依赖) | proto-geometry JSON(扁平+视口 rect)→ 建树(交叉/等 rect 拒绝)→ 12+1 规则(类型推断/相对化/垂直居中/self_modulate 透明壳**仅推断 Panel**/flow Holder 壳/字号行高与 ProgressBar 27px 引擎下限预警/颜色归一/对齐)→ UiNodeSpec 目标树 + verify_coverage |
| `ui_import_prototype` | ui 工具族新 action | 一次调用=翻译→build(固定持久化)→measure→layout_verify;返回 tree/build_warnings/verify_coverage(_note)/layout_verify;geometry_path 白名单;parent_path 原点对齐契约(warning) |
| `screenshot(action=diff)` | screenshot 新 action | pngjs 像素对比(零新依赖):diff_pixels/ratio/bbox+红染差异图;threshold 0.12(严格大于,忽略 alpha) |
| 规则与登记 | 双副本+engine-quirks 4 条+claudemd+README/CHANGELOG/matrix | evaluate 取数脚本模板(含 computed bg/textAlign→align/value 0-1 守卫/rgb→#hex);modulate 级联/Label TOP/行高钳制/ProgressBar 27 四条引擎陷阱落档 |

## 验收证据

- **验收 1**:RTS HUD fixture(23 节点,上轮实测 DOM 逐字)一次调用 **23/23 layout_verify 全绿 + overlaps/out_of_bounds 空** + 持久化重载验证;一次调用(两次 spawn)实测 ~5.7-6.0s;
- **验收 2**:三坑规则生效(居中/self_modulate/Holder+spacer)+ mini-flow 覆盖率语义(targets<total)与间距 96px±2;
- **验收 3**:diff 可区分性——好图对实测 **0.1762**,合成坏图(下半消失)**0.4797**(≈2.7x),三层断言护栏(基线/相对/绝对);双白名单路径逃逸全拒;
- 门禁:全量 `npm test` 5526 passed/0 failed;lint/build/build-matrix(v0.31.2)/check:budget 0 error/双副本归一化 0 差异。

## 关键裁定(过程留痕)

ProgressBar 引擎下限 27px → 翻译器预警+fixture 校准(非改断言凑绿);coverage=输入+1(合成根,_note 声明);persist 参数取消(跨进程链路"必须 true",写进契约);I-1 透明壳收窄到"推断 Panel"+一次性 warning(修复含负例验证:临时还原旧代码断言确实变红)。

## 遗留(不阻塞,下批候选)

1. 显式 `type:'Panel'` 无 bg 行为翻转(灰底可见)无提示——建议补一条 warning;
2. I-2 的 `!== '/root'` 字符串判定对 `'root/'`/场景根名有条件式 warning 假阳性(无害);
3. StyleBox/主题 override 通道(基本类型值无法构造 StyleBox,需扩展值序列化);
4. 双副本内容一致性 CI 机械校验(归一化 diff 脚本);
5. token budget warn 基线(86412B,历史遗留为主);
6. 集成测试 CI(Linux)恒 skip(本机 Windows 证据);一次调用两次 spawn 的单进程优化(spec 开放问题 3,实测 5.7s 可接受)。
