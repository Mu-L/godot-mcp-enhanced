# PR#36(tilemap scene_path)外部贡献集成审查归档(2026-08-19)

- **来源**:PR#36,作者 @thefireKS(仓库首个外部贡献;原 commit 12c6aff,fork 基底 0.32.1 时代)
- **集成分支**:`feat/tilemap-scene-path-integ`(e975bf7..2e6c3bb,3 commits:0923153 cherry-pick+集成调整 / 8c72bd9 0.32.6 收尾 / 2e6c3bb 审查 M-1 判空)
- **集成 PR**:PR#39(作者署名保留——cherry-pick 保留 author);回应评论 [PR#36#issuecomment-5336859808](https://github.com/wgt19861219/godot-mcp-enhanced/pull/36#issuecomment-5336859808)
- **独立审查**:Spec ✅ + Quality Approved(建议 merge)

## 原贡献评估

- **问题真实**:八生成器硬编码 `_mcp_load_main_scene()`,主场景是菜单的项目(常见布局)`node_path` 无论怎么写都只拿 `TILEMAP_NOT_FOUND`,报错形态误导排查。
- **方案合规**:复用 `SCENE_TREE_HEADER` 既有 `_mcp_load_scene`/`_mcp_get_scene_node`(ui/scene 工具同款模式,零新抽象);`resolveWithinRoot` 白名单;省略参数时生成脚本逐字节不变(测试锁定);作者真机 Godot 4.6.2 端到端验证(575 cells)。
- **质量**:5 个生成器级用例(默认路径不变/命名场景/null-check 双路/引号转义/八生成器全覆盖)。

## 集成调整(相对原 PR)

| # | 调整 | 理由 |
|---|------|------|
| 1 | `scenePreamble` 转义 `gdEscape`→`escapeForGdLiteral`(nodePath×2/scenePath) | 债务批约定:纯字面量上下文 `%` 不双写(含 % 路径加载会失败);patternJson 维持 master 的 escapeForGdLiteral |
| 2 | handler `resolveWithinRoot` 包 try/catch → `INVALID_PARAMS` | 原裸抛掉外层 catch 误映射 `SCRIPT_EXEC_FAILED`(审查实证外层 :484 无匹配关键词) |
| 3 | 空 scene_path 判空短路 `INVALID_PARAMS`(审查 M-1) | 空串解析为项目根 → 运行期 load 目录 null 才报错;对照 normalizeNodePath 空串显式抛错惯例 |
| 4 | 补 handler 级负向测试 3+1 用例(`../` 逃逸/白名单外/空串/合法路径解析透传) | 仓库铁律:新路径参数必须配白名单负向测试(文件路径参数白名单盲区教训) |
| 5 | CHANGELOG `[Unreleased]`→`[0.32.6]` 版本段;matrix 当前基底重生成 | 仓库版本段惯例+fork 基底过旧(write 94 vs 95) |

## 冲突解决记录

- `tilemap-ops.ts`:采纳 scenePreamble 结构+master 的 escapeForGdLiteral 约定;
- `CHANGELOG.md`:master 全部版本段+新增 0.32.6 段;
- `capability-matrix.{json,md}`:取 master 后 `build-matrix` 重生成(43 tools no drift,desc 286→352B/schema 3228→3540B,budget 0 err)。

## 验证

- `test/tilemap-ops.test.js` **41/41**(既有 32+作者 5+集成 4)
- 全量 `npm test` **5795 passed**(含集成真跑 Godot 4.7.1)/ lint 0 / build 0 / tool-count 24 处 / rules-sync 9 一致 / version-check 0.32.6
- 审查维度:cherry-pick 完整性(原 diff 逐项对照零丢失)/转义对齐/白名单语义实证(path-utils :156-190 段级拒绝+realpath)/测试注入面推演(vi.mock hoisting+假绿面不可达:正向用例为 mock 金丝雀,负向断言独立于 mock)/版本收尾/仓库级约束(双副本无涉/actionRisks 不变)。

## 工程教训

1. **外部贡献集成的基底漂移代价**:fork 基底落后 4 个版本时,附带的生成产物(matrix)与约定(转义)全部过期——集成应以「结构采纳+按当前约定重写细节」处理,而非机械 rebase。
2. **裸抛 resolveWithinRoot 的错误码漂移**:handler 外层 catch 按错误消息关键词映射时,内层路径校验裸抛会掉进兜底分支拿到误导性错误码(SCRIPT_EXEC_FAILED 而非 INVALID_PARAMS)——新参数校验一律自带 try/catch 映射。

## 后续(挂账/候选)

- 作者分析的其余 17 个模块同款 `_mcp_load_main_scene` 硬编码(animation 16 处/audio 4 处等)——后续批次候选(如有需要逐模块评估是否都该有 scene_path,或统一 scene 上下文机制)。
- merge 后:关闭 PR#36(回评指向 PR#39)+分支清理+memory+ledger。
