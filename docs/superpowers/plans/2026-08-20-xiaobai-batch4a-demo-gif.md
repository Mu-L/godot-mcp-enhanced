# 批 4a:demo GIF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。

**Goal:** `npx godot-mcp-enhanced gif <project> [--out <path>] [--fps N] [--seconds N] [--keys up,left,…] [--seed N]` 一条命令:起游戏→freeze→按 seed 顺序注入按键→定频截图→零依赖编码出 GIF89a。

**Architecture:** 编码器纯函数 `src/cli/gif-encoder.ts`(合并帧采样:unique 色 ≤256 精确直通调色板,否则中位切分 256 色;GIF89a + Netscape 循环 + GCE 延时 + LZW 子块);CLI 编排 `src/cli/gif.ts`(复用 qa setup 链:`game_bridge_install` → `run_project wait_for_bridge` → freeze/step/take_screenshot,`resolveGameDataPath` 取本机 PNG,pngjs 解码);router 加 `gif`。

**Global Constraints(spec §3 批 4a + §6)**
- 帧来源=已有 bridge take_screenshot + playtest.step 定频推帧(2-5fps);**零 GD 改动**(不动 addons/,无 check:gdscript 触发)。
- 零新依赖(pngjs 已有,PNG 解码;编码全自写)。
- 产物默认落项目内 `dist/demo.gif`(dist 在 .gitignore);`--out` 项目外路径走 y/N 确认(confirm.ts 复用)。
- 不新增 MCP 工具;每 Task commit;全批 lint/build/test 全绿。

### Task 1:GIF 编码器(TDD)
**Files:** Create `src/cli/gif-encoder.ts` + `test/gif-encoder.test.ts`
- [ ] 失败测试:①LZW 编码→**测试内自写 GIF-LZW 解码器**往返(随机索引帧,2-256 色多尺寸);②encodeGif 结构断言(GIF89a 头/逻辑屏/256 色表/Netscape loop/帧数=输入/Trailer 0x3B);③精确直通(≤256 unique 色零量化误差:解码回索引==原索引);④中位切分(>256 unique:解码回颜色都在调色板内)。
- [ ] 实现:`quantizeFrames(frames)→{palette:number[][], indices:Uint8Array[]}`(unique 直通/中位切分);`lzwEncode(indices,minCodeSize)→Uint8Array`(9-12 位可变码长,clear/EOI,字典重置);`encodeGif(frames,width,height,delayCs)→Buffer`(子块 255 切分)。
- [ ] 绿 → commit `feat(cli): 零依赖 GIF89a 编码器——中位切分/精确直通量化+LZW(往返测试)`

### Task 2:CLI gif 命令
**Files:** Create `src/cli/gif.ts`;Modify `src/cli/router.ts`
- [ ] 实现:`runGif(args)`——解析参数(project 必填/--out/--fps 4 默认/--seconds 8/--keys 默认方向键循环/--seed 42);qa 同款 setup(ToolContext 伪造成品照抄 cli/qa.ts 模式:findGodot+ps+gameBridge/runtime handleTool);freeze→循环 N=seconds*fps 次:{send_input_sequence?否——按键序列映射到帧窗(每窗开头注入一对 press/release);playtest.step(frames=60/fps);take_screenshot;resolveGameDataPath+pngjs 解码}→encodeGif→写盘(项目外确认);teardown stop_project+unfreeze。
  按键注入:每帧窗一次 `send_input_sequence(timeline:[{at_frame:1,key,pressed:true},{at_frame:3,key,pressed:false}])`(keys 序列按窗轮转;seed 仅决定 keys 未指定时的取样顺序——用 Node 侧简单 LCG 从 seed 派生,不依赖游戏 RNG)。
- [ ] 手测:`node build/index.js gif /tmp/t2048 --out /tmp/demo2048.gif --seconds 6` → 产物存在、GIF89a 头、尺寸 1280×720。
- [ ] commit `feat(cli): gif 子命令——bridge 定频截图+按键时间线+编码落盘`

### Task 3:验证与文档
- [ ] 真机:2048 GIF 首帧与同时 take_screenshot PNG 像素对比(pngjs 读两图;精确调色板场景 diff≈0;量化场景给 8/255 平均阈值);snake/breakout 各出一条 GIF(--keys left,right)。
- [ ] README/README.en:小白叙事 GIF 段(roadmap「demo GIF」移已支持);CHANGELOG;全量三连。
- [ ] commit `docs: 批4a GIF 上手段+验证证据`

## Self-Review
spec 覆盖:帧来源(bridge+step)/零依赖编码/产物确认门/不动 addons/验证(首帧 diff+单测往返+三连)——全覆盖。偏差记录:按键来源由 qa 时间线改为 CLI 参数+seed 派生(spec 只说 playtest 驱动,输入内容未规定)。
