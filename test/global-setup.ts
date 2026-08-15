/**
 * vitest globalSetup(每个 run 一次,先于所有测试 worker 启动):
 * 填充 test/fixtures/gdscript-check 的 src/scripts/ 与 addons/(被 .gitignore 的
 * 运行时拷贝产物,源在 src/scripts/ 与 addons/godot_mcp_server/)。
 *
 * 为什么必须在这里做(2026-08-15 run#122 CI 平台债根因):
 * CI check job 的 vitest 步骤跑在 check:gdscript(原填充时机)之前,checkout 后
 * fixture 是空壳 → gdscript-unit / gdscript-unit-path / gdscript-bridge-error-capture
 * 的 Godot load() 得 null → SCRIPT ERROR → extends SceneTree _init 中断、quit() 不执行
 * → headless 进程无限挂 → vitest 10s 超时(本地 Windows 绿是因开发机留有拷贝残留)。
 * 挂 globalSetup 后本地/CI 任意 vitest 入口(npm test / CI check / matrix E2E)统一就绪。
 */
import { syncCheckProjectFixture } from '../src/scoring/check-gdscript.js';

export default function setup(): void {
  const { srcFiles, scriptFiles } = syncCheckProjectFixture();
  process.stderr.write(
    `[global-setup] gdscript-check fixture synced (addons=${srcFiles.length}, scripts=${scriptFiles.length})\n`,
  );
}
