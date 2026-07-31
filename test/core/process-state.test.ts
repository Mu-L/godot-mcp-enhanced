import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('fullSystemScanGodot filter excludes --editor processes', () => {
  const srcPath = join(__dirname, '../../src/core/process-state.ts');
  const src = readFileSync(srcPath, 'utf-8');

  it('PowerShell branch excludes --editor (Windows)', () => {
    // 提取 PowerShell Where-Object 块
    const psBlock = src.match(/Where-Object \{[\s\S]*?CommandLine\.Contains[\s\S]*?\}/s);
    expect(psBlock, 'PowerShell Where-Object block found').toBeTruthy();

    // 反向断言：过滤必须排除 --editor
    expect(psBlock![0]).toMatch(/-not.*\*--editor\*|--editor.*-not/i);
  });

  it('POSIX branch excludes --editor (Linux/macOS)', () => {
    // 提取 POSIX sh 分支 grep 命令
    const shBlock = src.match(/pgrep -f godot[\s\S]*?grep -F/s);
    expect(shBlock, 'POSIX pgrep/grep block found').toBeTruthy();

    // 反向断言：过滤必须排除 --editor
    expect(shBlock![0]).toMatch(/grep.*-v.*--editor|--editor.*exclude/i);
  });
});
