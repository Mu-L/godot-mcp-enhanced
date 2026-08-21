# 第三方审查报告:审查修复批 2(GD bridge 对称性)

- **日期**:2026-08-21 | **分支**:`fix/audit-2-gd-symmetry`(5 commits:71e5649/5f6d101/c9fbbac/51678dc/e590f7f,基于 master 70bf3db)
- **审查者**:code-reviewer 子代理(独立会话,64 次工具调用;五处修复逐行精读 + 4 份 mcp_bridge.gd 副本比对 + Godot 源码 input_enums.h 核枚举)
- **原始判定**:**SHIPPED WITH NITS**(0 Blocking + 1 Important + 3 Nit)→ 全处置 → **SHIPPED**

## 逐维度结论(审查者实测)

| 维度 | 结论 | 关键证据 |
|---|---|---|
| G-1 数值白名单 | ✅ | mcp_bridge.gd:2634-2635 白名单置于 float(target)(:2637)之前,与 Vector 分支 N-1(:2656)范式对称;bool target 一并拒(bool 非 int),比修复前 float(true)=1 静默匹配更诚实 |
| freeze pending 守卫 | ✅ 时序正确 | :2460(owner 拒)→ :2464-2465(两 pending 拒)→ :2466(owner_pid 赋值)——拒绝性检查全部完成后才占 owner |
| button 映射 | ✅ 枚举实证 | Godot 源码 core/input/input_enums.h 实证 LEFT=1/RIGHT=2/MIDDLE=3/WHEEL_*=4-7/XBUTTON=8/9——1-9 恰为全部有效枚举,>9 拒之有据;默认值 1 经 helper 仍 1(:1631-1632);深预检(:2582-2585)与直接调用(:1631)同享 |
| coerce is_valid 语义 | ✅ 暴露闭环 | :1511/:1517 严格判定非法保留原值;调用点 :1399 node.callv + :2760 注释实证 ERROR_TYPE_TYPE 被捕获显式报错;合法 "5" 仍转(不破坏既有) |
| all_applied | ✅ 兼容+边缘可接受 | lambda+Array.all() 均 4.0+ 特性;空 applied 仅 wall 超时 0 事件注入时出现,同响应 success:false+applied_count:0 已充分诊断 |
| 行为回归 | ✅ 零回归 | 全 test/ 唯一字符串条件值是新增用例故意非法的 'abc';既有 input-seq e2e 仅 key/action;**两个既有调用方受益**:workflow.ts:818-821(dev_loop DSL 产出 button:'left' 字符串,修复前静默坏)+rule-templates.ts:298/:840(分发示例) |
| 测试质量 | ✅ 高 | 契约断言静态可证删守卫必红;P2b 顺序断言精确(带空格等号不误中 != 行);「freeze 守卫单连接不可达」论证属实(game-bridge.ts:484/:561-563 _sendLock 全局链式串行化) |
| 仓库级约束 | ✅ 全合规 | 4 份 mcp_bridge.gd 副本(src/build/gdscript-check/input-seq-e2e)逐一比对同款同行号;rule-templates/.claude/rules mtime 均早于本批零触碰;matrix 无需重建(工具清单/描述零变化);CHANGELOG [Unreleased] 合规 |
| 竞态归档诚实性 | ✅(载体经 I-1 处置补齐) | 注释与 CHANGELOG 数字一致(18/20、15/20、6/6);回退干净(_verify_listen_ownership 全文零匹配) |

## Important 与处置

### I-1:竞态实测数据与 plan 的引用载体死链(已处置)
- **事实**:本分支上 `docs/reviews/2026-08-21-audit-fixes-batch2.md`(尚未落盘)与 master plan(在批 1 分支)不存在,18/20 等实测数字在 git 内无原始载体可溯源。
- **处置**:①master plan 从批 1 分支带入本分支(e590f7f,两分支各自完整,先合哪个都不断链);②本审查报告即为 batch2.md 落位,内含实验数据全记录(见下节)。

## Nits 与处置

| # | 内容 | 处置 |
|---|---|---|
| N-1 | send_touch/send_drag 直接调用路径 index 裸转残留(深预检只盖 timeline,与 button 修复不对称) | ✅ 补 `_is_valid_touch_index` 守卫 + 契约 G-2f(守卫先于裸转的顺序断言——守卫后的裸转安全) |
| N-2 | all_applied 空真语义(wall 超时 0 事件时 Array.all() 空真 true) | ✅ GD 注释补读法(读 all_applied 须对照 applied_count);bridge rule 分发版补句留后续(改 rule-templates 触发 version-bump 硬门禁,代价大) |
| N-3 | qa runner 仅 success===false 分支透传 all_applied(success=true&&all_applied=false 不判红) | 维持 F-4 既定决策(不改 success 语义);applied 明细经 condense 已进 detail,自动判红留后续增强 |

## 端口竞态实验全记录(Task 2.5b,归档防丢)

- **实验 1(v1 探针,复刻「探测→listen」窗口)**:双 Godot 进程同瞬 spawn,20 轮 **18 轮双 listen OK**(双方探测均判空闲+双方 listen 都返 err=0)——竞态坐实,远超待办预估。
- **实验 2(v2 探针,加「listen 后回探自连判属主」校验)**:两轮结果漂移——first run **双属主 15/20**(双方各自 probe 均到达自己 server)/second run **零属主 6/6**(校验全超时)。修复方案证伪:Windows 双 bind 下应用层属主探测无法可靠区分抢占者与被抢占者,已回退。
- **途中抓到**:TCPServer 无 poll() 方法(4.6.3 实测 Nonexistent function 报错)——check:gdscript 逐文件 parse 查不出运行时方法存在性,is_connection_available() 自身即时查询无需 poll。
- **候选缓解(未实施,留用户裁决)**:起始候选端口随机化(降低碰撞概率,非根治)。

## 审查后主会话复跑(审查者无 Bash 的补证)

- `npm run check:gdscript` → errors=0 warnings=0 ✅
- `npx vitest run test/gd-symmetry-contract.test.ts` → **13/13**(处置后含 G-2f)✅
- `GODOT_MCP_E2E_L2=1 npx vitest run test/e2e-gd-symmetry.test.ts` → **4/4 真机** ✅
- `GODOT_MCP_E2E_L2=1 npx vitest run test/e2e-bridge-input-sequence.test.ts` → **6/6 真机回归** ✅
- `STRICT=1 npm run check:rules-sync` → 9 模板双向对账一致 ✅
- 全量 `npm test` → **6091 passed / 0 failed** / 45 skipped ✅

## 工程教训(登 memory)

1. **契约测试删守卫红测是源码字符串断言类测试的标配验收**——「断言存在」不等于「断言有效」,本批 G-1a/P2a 红测双红是直接证据(实现者中途误用 git checkout 恢复未 commit 改动致守卫丢失,红测立即暴露——教训另条)。
2. **GDScript 裸转三连坑同族不同症状**(float("abc")=0 假阳性/int("left")=0 无效枚举/int("5px")=5 部分解析)——统一修法「白名单前置 + is_valid_* 严格判定 + 非法保留原值交引擎显式报错」已成型,但应按**参数类别**而非「单个命令」横向扫荡(button 修了 touch/drag index 差点漏,审查 N-1 抓回)。
3. **回探自连判属主被真机证伪**——Windows 双 bind 场景应用层探测不可靠;归档「已证伪方案+证伪数据」比只留结论有长期价值。
4. **check:gdscript 逐文件 parse 查不出运行时方法存在性**(TCPServer.poll 不存在照样 0 error)——新调 API 先单进程冒烟再进主链。
