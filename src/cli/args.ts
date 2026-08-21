/**
 * CLI 参数解析共享原语(2026-08-21 架构审查 C-2:消灭 gif/web/qa/init 四处重复的 opt/num)。
 *
 * 约定:支持 `--name=value` 与 `--name value` 双形式(B-1 审查约定:只认等号会静默回落
 * 默认值,README 示例是空格形式)。
 */

/** 取字符串选项;两种形式都认。未指定返回 undefined。 */
export function opt(args: string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === `--${name}`) return args[i + 1];           // 空格形式(相邻消费)
    if (a.startsWith(`--${name}=`)) return a.split('=').slice(1).join('=');
  }
  return undefined;
}

/** 取数字选项;未指定用 fallback,非数字报错退出(exit 2)。 */
export function num(args: string[], name: string, fallback: number): number {
  const v = opt(args, name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    console.error(`--${name} 需要数字,收到 "${v}"`);
    process.exit(2);
  }
  return n;
}
