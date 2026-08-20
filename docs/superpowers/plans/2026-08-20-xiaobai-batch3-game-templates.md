# 批 3:可玩模板库第一期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npx godot-mcp-enhanced init my-game --template=2048|snake|breakout` 一条命令落地**可玩**游戏项目四件套(可玩 demo + GDD + qa 套件 + 调参表),qa 真机跑绿(含确定性 playtest)。

**Architecture:** 模板资产=独立散文件目录 `src/game-templates/<slug>/`(GDScript 保持原样可被语法校验),新构建拷贝脚本复制到 `build/game-templates/`(npm files 扩展);`src/cli/game-templates.ts` 注册表只存元数据与相对路径,内容运行时 fs 读取;消费入口=扩展现有 `init` 子命令的 `--template=` 死参数为四件套落地。游戏代码读 `.tres` 调参资源;GDD 放 `design/gdd/<slug>.md`(CCGS 同款路径,过自家 `validate_gdd`);qa 套件随项目分发,`qa run` 直接可跑。

**Tech Stack:** TypeScript ESM + GDScript 4.5–4.7 + Vitest;游戏零外部资产(ColorRect/Label 程序化占位美术);确定性=Godot 全局 RNG(`playtest.seed` 可锁)。

## Global Constraints(spec §3 批 3 + §6)

- **选型(本 plan 裁定,spec 未决项 3)**:`2048` / `snake`(贪吃蛇)/ `breakout`(打砖块)——认知度最高的三件,确定性 playtest 各有代表形态(网格合并 / 定时步进移动碰撞 / 自写 AABB 反弹物理)。
- **四件套硬标准**(每模板):①可玩 demo(场景+脚本+程序化占位美术,零外部资产,零 autoload 依赖);②GDD 8 段过 `validateGDD` 零 error(`src/tools/game-design.ts`,精确匹配 `^## <段名>$`,段名=Overview/Player Fantasy/Detailed Rules/Formulas/Edge Cases/Dependencies/Tuning Knobs/Acceptance Criteria);③qa 套件含**确定性 playtest 断言**(freeze + send_input_sequence 时间线 + step_until/assert,`options.seed` 锁随机);④调参表 `tuning/<slug>.csv` + 首发同名 `.tres`(Custom Resource,游戏 `_ready` 加载;改表→`csv_to_resources` 重导→重启生效,文档说明)。
- **不新增 MCP 工具** → 不动 capability-matrix、不触发版本硬门禁、check:budget 不受影响(工具描述零变化)。
- **游戏状态 probe 化**:主节点暴露可断言属性(score/moves/game_over 等 @export 或运行时属性),qa 断言与 `game_query` 读它们——「AI 测 AI 写的游戏」样板。
- 模板 `.gd` 遵循 Godot 官方风格(Tab 缩进);落地后过 `validate_scripts`。
- 随机性一律用全局 RNG(`randi`/`randf`/`randi_range`)——`playtest.seed` 才锁得住;**不用** `RandomNumberGenerator` 实例(其内部状态不受全局 seed 控制)。
- 每模板 qa 真机验证:**两跑同 spec → 全 PASSED + `qa diff` 零回归**(2048 必做;snake/breakout 至少单跑绿)。
- 提交纪律:每 Task commit;全批 `npm run lint`+`build`+`test` 全绿。

---

### Task 1:模板资产骨架 + 注册表 + 构建拷贝 + 单测

**Files:**
- Create: `src/cli/game-templates.ts`(注册表+读取函数)
- Create: `src/game-templates/<slug>/`(三个模板资产目录,本 Task 先放骨架占位文件,T3-5 填真内容)
- Create: `scripts/copy-game-templates.mjs`
- Modify: `package.json`(build 追加 `&& node scripts/copy-game-templates.mjs`;files 加 `"build/game-templates/**"`)
- Test: `test/game-templates.test.ts`

**Interfaces(Produces):**
- `interface GameTemplateMeta { slug: string; title: string; summary: string; mainScene: string; files: string[] }`(files=模板目录内相对路径清单,含全部四件套)
- `const GAME_TEMPLATES: Record<string, GameTemplateMeta>`
- `function getGameTemplateDir(): string`(开发态 `src/game-templates` / npm 态 `build/game-templates` 探测,参照 `src/cli/qa.ts` opsScript 探测模式)
- `function listGameTemplates(): { slug, title, summary }[]`
- `function readGameTemplateFiles(slug): { path, content }[]`(逐文件读,缺文件 throw InternalError)

- [ ] **Step 1:写失败测试**(注册表三模板齐/文件实存/GDD 过 validateGDD/qa 围栏 JSON 可解析/CSV 与 tres 并存)

```typescript
// test/game-templates.test.ts 要点
import { GAME_TEMPLATES, getGameTemplateDir, readGameTemplateFiles, listGameTemplates } from '../src/cli/game-templates.js';
import { validateGDD } from '../src/tools/game-design.js';
// 每模板:meta 齐;readGameTemplateFiles 返回的 files 含 main.tscn/<slug>.gd/design/gdd/<slug>.md/qa/<slug>.qa.md/tuning/<slug>.csv+tuning/<slug>.tres;
// GDD 内容 validateGDD(gdd) 零 error(severity==='error' 的 issues 为空);
// qa 文件含 ```qa-spec 围栏且 JSON.parse 通过且 steps 非空且 options.seed 为数字;
// .tres 内容含 `[gd_resource type="Resource"` 与 script_class 引用。
```

- [ ] **Step 2:红 → 实现 → 绿**(注册表+骨架文件:每模板先放最小合法 GDD/qa/csv/tres/gd/tscn 占位,内容真伪由 T3-5 替换;拷贝脚本=递归 copy `src/game-templates` → `build/game-templates`)
- [ ] **Step 3:Commit** `feat(cli): 游戏模板注册表与资产骨架——四件套目录约定+构建拷贝+npm files`

### Task 2:init --template 四件套落地

**Files:**
- Modify: `src/cli/init.ts`(`--template=<game-slug>` 分支:除 project.godot 外写四件套文件+main_scene 配置+调参说明)
- Test: `test/game-templates.test.ts` 追加(临时目录 init 2048 → 文件齐全/主场景注册/project.godot 含 autoload 无/不覆盖已有目录语义保持)

- [ ] **Step 1:失败测试**(mock cwd 临时目录;`runInit(['t2048','--template=2048'])` → 断言 `t2048/scenes/main.tscn`、`t2048/scripts/game.gd`、`t2048/design/gdd/2048.md`、`t2048/qa/2048.qa.md`、`t2048/tuning/2048.csv|.tres` 存在且 project.godot `run/main_scene` 指向 main.tscn;未知模板报错列出可用项)
- [ ] **Step 2:实现 → 绿 → Commit** `feat(cli): init --template 落地游戏四件套(主场景注册+目录结构)`

### Task 3:2048 模板(完整四件套 + 真机 qa 绿)

**Files:**
- Modify: `src/game-templates/2048/`(全部真内容:main.tscn、scripts/game.gd、design/gdd/2048.md、qa/2048.qa.md、tuning/2048.csv、tuning/2048.tres)

**2048 行为规格(实现即验收):**
- 4×4 网格(ColorRect 色块+Label 数字,程序化生成);方向键(Left/Right/Up/Down UI action 或 key)移动合并;每步随机空位生成新块(2 概率 0.9/4 概率 0.1,`randf()`);无可动步或达 2048 → game_over(true 时带 win 标志)。
- **probe 属性**(主 Node 命名 `Game2048`):`score: int`、`moves: int`、`empty_cells: int`、`game_over: bool`、`won: bool`。
- **调参 .tres 字段**(Resource subclass `GameConfig2048`,脚本内 class_name):`grid_size`(默认 4)、`win_value`(2048)、`four_probability`(0.9)、`start_tiles`(2)。CSV 同字段。
- **GDD**:8 段,Formulas 段写合并得分公式(合并值累加);Tuning Knobs 与 .tres 字段一一对应;Acceptance Criteria 与 qa 断言对应。
- **qa 套件**(确定性):`{"options":{"seed":42,"fixed_delta_hz":60}}`;steps:freeze → input send_input_sequence(timeline: at_frame 1/10/20/30 各 press+release 方向 key)→ step_until(conditions: [{path:"/root/Game2048","property":"moves","op":">=","value":4}],max_frames 300)→ assert node_state(score ≥ 0,moves==4,game_over==false)→ unfreeze。
- **验证**:①`npx vitest run test/game-templates.test.ts`(GDD/qa/文件)绿;②落地临时项目 → `node build/index.js qa run <落地>/qa/2048.qa.md --project <落地>` **两跑全 PASSED** + `qa diff` 零回归;③落地项目跑 `validate_scripts`(MCP 工具或 headless `--check-only`)零 parse error。
- [ ] **实现 → 真机验证三连 → Commit** `feat(templates): 2048 可玩模板四件套——确定性 qa 绿(两跑 diff 零回归)`

### Task 4:snake 模板(同结构)

- 20×20 网格;固定步进(_physics_process 帧计数 % speed_frames==0 移动一格);方向键转向(禁 180° 回头);食物空位随机(`randi_range`);撞墙/自身 → game_over;吃到食物 score+1、蛇长+1。
- probe:`score`、`length`、`game_over`、`steps_moved`。调参:`grid_size`(20)、`initial_speed_frames`(8,越小越快)、`initial_length`(3)、`wrap_edges`(false)。qa 同 2048 模式(方向时间线+step_until length 增长断言)。
- **验证**:单测绿 + qa 真机单跑全 PASSED → Commit `feat(templates): snake 可玩模板四件套`

### Task 5:breakout 模板(同结构)

- **自写 AABB 物理**(不用 RigidBody,保确定性):球恒速向量移动(每物理帧按 speed_pixels_frame 位移);撞挡板反弹(反弹角按命中偏移);撞砖反弹+score;球落底 lives-1 重发(方向随机角度 `randf_range`);砖清空/生命归零 → game_over(won)。
- probe:`score`、`lives`、`bricks_left`、`game_over`、`won`。调参:`paddle_width`(120)、`ball_speed`(6.0 px/frame)、`brick_rows`(4)、`brick_cols`(10)、`lives`(3)。qa:时间线左右移动接球+step_until score>0。
- **验证**:同 Task 4 → Commit `feat(templates): breakout 可玩模板四件套`

### Task 6:文档 + 全量三连

- README:小白叙事节 install 段后加「一条命令生成可玩游戏」(`init --template=2048|snake|breakout`,四件套说明+调参工作流「改 CSV→csv_to_resources 重导→重启」);roadmap 中「内置可玩模板库」移入已支持;README.en 同步。
- CHANGELOG [Unreleased] 批 3 小节(快照数字实测后写)。
- `npm run lint && npm run build && npm test` 全绿(含新拷贝脚本产物)。
- Commit `docs: 批3 模板库文档——init --template 上手段与调参工作流`。

## Self-Review

1. spec 覆盖:四件套标准(T1 结构+T3-5 内容)/分发形态 npm 内置(T1 files+拷贝)/读 .tres 参数(T3-5)/不新增工具(全局约束)/verify_delivery 级验证(qa 真机+validate_scripts;CLI 无 verify_delivery,以 qa 断言+脚本编译等价覆盖,CHANGELOG 说明)/选型未决项 3 裁定(2048/snake/breakout)。
2. 占位符:游戏 GDScript 以行为规格+验收标准给出(完整源码属实现产物;规格含状态机/probe/调参字段/qa 步骤全部契约)。
3. 类型一致:GameTemplateMeta.files 与 readGameTemplateFiles/Task 2 落地路径共用同一路径清单。
