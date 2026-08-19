# 债务清理批终审归档(2026-08-19)

- **分支**:`feat/debt-cleanup-20260818`(cc86e9d..b190af6,8 commits:bc801ec plan / ebfa0c0 screenshot 采样 / baff527+4614b84+1941292 转义三波 / 266ba36 Minor 清账+口径 / 391aaeb spec 落答+0.32.5 / b190af6 fix wave)
- **plan**:`docs/superpowers/plans/2026-08-18-debt-cleanup.md`(调研数据全实测后成稿)
- **终审**:SHIPPED WITH NITS → fix wave(b190af6)后 **SHIPPED**(I-1 声明-实际差距完全消除,复审 PASS)

## 核心交付(六块)

1. **screenshot_capture.gd 采样退化修复**(生产 bug,PR-3 挂账):线性 step=total/100 整除宽→最左单列采样(800×600 实测 x 恒 0)→ 10×10 网格分层采样(格中心,static 化);GD 真跑回归测试含「左列均匀+其余噪声」铁证用例;check:gdscript 0/0。
2. **gdEscape→escapeForGdLiteral 转义类闭类**(三波+fix wave,PR-2 T3c 挂账+PR-4 继承点):纯字面量上下文的路径/值内插不再把 % 双写(含 % 文件名加载失败/断言恒错/渲染双写);**分类铁律**=% 格式串左侧维持 gdEscape(全仓唯一 test-framework:182,混合上下文拆双变量);名类(node name/type/property key)豁免(Godot 命名规则+白名单校验零风险面)。
3. **PR-4 终审 Minor 清账**:M-1 uiErrorMapper error_code 断言/M-2 mock 死键/M-5 标点/M-4 timeout 30s 决策注记(维持,余量 ~10x)/M-3 已随 PR#37 CI 修复消解。
4. **README/manifest 口径漂移修复**:正文三处(235→241×2、36→43、205→241)+README.en+manifest "200+ actions"→241;check-tool-count 防 4 pattern(20→24 处,锚定正文措辞不误伤版本表)。
5. **spec §10.5 落答**(生产路径真跑 4.7.1 实测):flow FILL h=39 根因=float32 比例锚点残差(容器 39.9999923706055)+HBoxContainer FILL 子高度整数截断(floor→39,位置保留浮点残差 y=100.0000076);dh=+7 系统性 FILL 拉伸非噪声;**flow 容差维持 2**(系统性偏差是 flow_verify 价值,加宽只会隐藏)。
6. **版本 0.32.5**:八文件版本链+CHANGELOG(闭类诚实口径「按三波口径闭类——非全量清零声明」)+README 版本行。

## 审查链

7 个 task 实现+独立审查全 Approved(Task 1/2/2b/2c/3/4/fix wave);关键裁决:Task 2 审查裁定变体同根因扩 2b;Task 2b 审查裁定四处任意值类扩 2c;defects.ts:87 守卫谓词扩展判合法必要(非削弱);scene-instance % 拒绝使切换成死代码防御(诚实标注);终审 Important(6 处同类残留未入挂账)fix wave 消解。

## 挂账(转出本批,单一「转义残留清单」)

- valueToGd 序列化器全消费点审计(核心序列化器,消费面大,独立批)
- test-framework property/signalName/methodName 三点(:121-126)
- 值域受限低频值类:node-3d-ops:58/ui-theme:33/audio-ops:82
- check-tool-count 英文侧 action pattern 防护缺口(README.en/manifest)
- 既有:check-tool-count main() 无直跑守卫;PR-4 五项 Minor 中 M-4 已注记、其余留档

## 工程教训(已登 memory)

1. **「闭类」声明需按值语义反向枚举**:三波转义按调用形态正向 grep 驱动,漏掉按「插值语义=路径/任意值/标识符」反向全枚举,6 处同类点漏网而声明已闭类——终审反向对账抓住。凡声明「闭类/清零」,final review 应做语义维度反向对账。
2. **同构调用形态是漏改最快指纹**:`NodePath("${gdEscape(...)}")` 一条 grep 同时暴露已切/未切不一致,适合机械替换批次收尾自检。
3. **混合转义上下文拆变量而非整体切换**:test-framework parentPath 同时消费于字面量查找与 % 格式串左侧——按消费点拆双变量,% 左侧维持 gdEscape 是唯一正确解。
4. **GDScript % 语义**:格式化只解析左侧格式串占位符,右侧数组元素是数据(% 原样)——值进右侧数组无需双写。

## 流程交付物

- 本审查文档;memory:`feature-decision-log: debt-cleanup-batch-20260819` + 教训;Obsidian 日志;ledger 交接行;push+PR(merge 留用户)
