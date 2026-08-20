import { createInterface } from 'readline';

/**
 * CLI y/N 确认(默认 N,Enter 拒绝)。
 * 非 TTY(管道/CI)返回 false 不阻塞——交互引导只在真实终端出现。
 */
export async function confirmYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`${question} [y/N] `, (ans) => resolve(ans.trim().toLowerCase()));
  });
  rl.close();
  return answer === 'y' || answer === 'yes';
}
