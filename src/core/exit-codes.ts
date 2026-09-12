/**
 * CLI 进程退出码单一注册表(P2-5,2026-09-11)。
 *
 * 类别粒度语义(aigengame exit_codes.py 对标:类别进 exit code,细粒度进输出消息/错误 JSON;
 * 遵循 shell 惯例的码沿用惯例值,调用方/CI 可一眼审计):
 *   0  EXIT_OK              成功(含"无发现"的正常结束,如 doctor 全绿)
 *   1  EXIT_OPERATION_FAILED 操作/断言失败(qa 套件 FAIL、diff REGRESSED、run 失败)
 *   2  EXIT_USAGE           用法/参数错误(遵循 shell 惯例:argparse/getopt 同值)
 *
 * 约定:CLI 新增退出点一律引用本注册表常量;test/p2-exit-path-repair.test.ts(EX-b)静态扫描
 * src/cli 的 process.exit(n) 字面值,新引入注册表外的码会被 CI 拦截。存量约 25 处字面值
 * (值均合法)暂豁免——扫描只拦值域,常量替换按新改动逐步推进。
 * MCP 工具层错误码(opsErrorResult 的字符串 code)与此无关——那是协议内错误,不进程退出。
 */
export const EXIT_CODES = {
  EXIT_OK: 0,
  EXIT_OPERATION_FAILED: 1,
  EXIT_USAGE: 2,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

/** 全部合法退出码值(静态扫描断言用)。 */
export const ALL_EXIT_VALUES: readonly ExitCode[] = Object.values(EXIT_CODES);

/** 码 → 语义说明(CI/诊断输出用)。 */
export function describeExitCode(code: number): string {
  switch (code) {
    case EXIT_CODES.EXIT_OK: return 'OK';
    case EXIT_CODES.EXIT_OPERATION_FAILED: return 'OPERATION_FAILED';
    case EXIT_CODES.EXIT_USAGE: return 'USAGE';
    default: return `UNKNOWN(${code}) — must not appear; add it to src/core/exit-codes.ts or use an existing constant`;
  }
}
