/// <reference types="vitest/globals" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // 填充 gdscript-check fixture(被 gitignore 的运行时拷贝产物)——CI vitest 跑在
    // check:gdscript 之前,不填充则 GD 类测试 load null 挂死超时(见 test/global-setup.ts)
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup.js'],
    include: ['test/**/*.test.{js,ts}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/scripts/*.gd', 'src/tools/game-bridge.ts'], // game-bridge.ts:Linux CI 跑不了其测试(vitest mock 平台 bug,见 issue #15),覆盖率退本地(Windows game-bridge.test.ts 23/23 覆盖)
      // C-06: Thresholds set with ~4% margin below actual coverage to prevent flaky CI.
      // Review: when coverage consistently exceeds thresholds by >4%, raise them.
      thresholds: {
        statements: 60,
        branches: 51,
        functions: 69,
        lines: 61,
      },
    },
    testTimeout: 10_000,
  },
});
