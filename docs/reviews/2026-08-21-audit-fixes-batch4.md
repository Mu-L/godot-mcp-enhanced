# 第三方审查报告:审查修复批 4(安全+隐私+杂项清挂账,收官批)

- **日期**:2026-08-21 | **分支**:`fix/audit-4-security-privacy-misc`(2 commits:9aba472/b0afb19,基于 master 70bf3db)
- **审查者**:code-reviewer 子代理(独立会话,33 次工具调用;行号快照全部 grep 实测 + POSIX 平台合理性论证 + 攻击面推演)
- **原始判定**:**SHIPPED WITH NITS**(0 Blocking + 4 Nit)→ 全处置 → **SHIPPED**

## 逐维度结论(审查者实测)

| 维度 | 结论 | 关键证据 |
|---|---|---|
| ADS 拒收 | ✅ | zip-extract.ts:46-54 新校验位置正确;负向 4 形态全拒+零解压产物断言;**非 win32 平台统一拒合理**——解压平台≠消费平台(POSIX 解出的 ADS 载荷可拷到 Windows),且两调用方为官方 GitHub 资产(SHA512 同源)信任链内冒号零出现;**额外收益**:`base.includes(':')` 顺带覆盖中段盘符形态 `foo/C:bar`(drive-relative,原行首正则双盲) |
| CSP 修 | ✅ | 仅 SVG 分支(:100-106);script-src 未显式→fallback default-src 'none',SVG 内 `<script>` 禁、`style-src 'unsafe-inline'` 仅放开样式不引入脚本执行面;三态断言(:108-118)锁定「统一加会坏试玩」论证——未来有人统一加 CSP 时 toBeUndefined 断言即红 |
| realpath | ✅(2 Nit) | 带路径分支 :133-146 dir 对称 realpath;裸 run_id 分支静态逃逸不可能(无路径分隔符);symlink 利用前提(目录写权限)在 MCP 链路无创建路径,不构成新增攻击面 |
| 披露订正 | ✅ | 行号快照全部实测吻合(godot-installer.ts:100/:102/:17、index.ts:152-153、config.ts:12、ToolDispatcher.ts:501);NO_PROXY 全仓 grep 全为订正/否定语境(历史 plans/CHANGELOG 段保留历史记录是正确做法);update-checker.ts:111 fetch 未设 dispatcher/EnvHttpProxyAgent 与「undici 不读代理 env」静态一致 |
| 版本链 | ✅(1 Nit) | package.json/manifest/capability-matrix 三处 0.32.9 静态一致;CHANGELOG 定版段格式合规;npm publish 未做(自述待用户)合规 |
| 仓库级约束 | ✅ | check-rules-version-bump.mjs:18 确纳入 claudemd-builder→bump 被强制;content-sync 校验对不含 claudemd-builder(独立文本),rule-templates/`.claude/rules` grep capture_screenshot 零匹配双副本零影响;zip-extract 死赋值删后 `q` 仍有读取无 unused 形态 |
| 验证完整性 | ⚠️ 静态全测/运行未复跑 | 测试计数 grep 实数 33+11+18=62 与声明一致;vitest/lint/version-sync 未复跑(主会话已实跑,见下) |

## 审查后主会话复跑

- `npx vitest run test/godot-installer.test.ts test/web-export.test.ts test/qa-report.test.ts` → 33+11+18=**62/62** ✅(收尾时实跑)
- 处置后 `npx vitest run test/qa-report.test.ts test/qa-index.test.ts` → **38/38** ✅
- `npm run lint` → **0 error 0 warning**(F-3 死赋值删除生效)✅
- `node scripts/version-sync.mjs --check` → 0.32.9 一致 ✅;`STRICT=1 npm run check:rules-sync` → 9 模板一致 ✅;rules-version-bump 门禁通过 ✅
- 代理实测(实现者会话复现):`HTTP_PROXY=http://127.0.0.1:1`(必拒端口)下 `fetch registry.npmjs.org` → **200 直连** ✅
- 全量 `npm test` → **6076 passed / 0 failed** ✅

## Nits 与处置

| # | 内容 | 处置 |
|---|---|---|
| N-1 | realpathSync(dir) 不存在时裸 ENOENT 冒泡(而非友好消息) | ✅ 包 try-catch 归「报告目录不存在(先 qa run)」 |
| N-2 | 裸 run_id 分支与带路径分支 realpath 不对称(实际影响零,纵深对称性) | ✅ 裸名 join 后统一过 realpath |
| N-3 | README 0.32.9 版本行按四批终态描述,本分支只含批 4 | 不改代码——**merge 顺序约束**:四批全量合入后 0.32.9 行描述才成立(本行由批 4 终稿代写,批 1-3 分支不再写版本行);约束记录于本报告+待办 |
| N-4 | symlink 用例 Windows 无特权时静默 skip(绿而未验风险) | ✅ catch 分支 console.warn 显式可见 |

## 工程教训(登 memory)

1. **CSP 加固必须按 MIME 分支而非全局统一**——对唯一内嵌脚本媒介单点加、对其余类型用负向断言锁住「不加了什么」;`default-src 'none'` 一刀切会静默弄坏 Godot Web 试玩的同源 js/wasm。
2. **字符串前缀白名单必须过 realpath 才算闭环**——existsSync/join+startsWith 对 symlink 全部失明;同函数多入口分支只修一半会留同威胁模型的双路径不对称,修白名单时 grep 该函数所有入口路径。
3. **zip 解压器文件名校验覆盖 ADS 形态**——行首盘符正则对 `foo.txt:ads` 和中段 `C:bar` 双盲,基名级 includes(':') 一并封;解压平台≠消费平台,全平台统一拒优于按 win32 条件拒。
4. **披露文档的行号引用同样适用快照护栏**——审查者复验全部吻合的代价是逐个 grep;「文档只是描述」不是跳过实测的理由。
