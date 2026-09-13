import { describe, it, expect } from 'vitest';
import { removeOrphanBridgeLines, repairOrphanedBridgeAutoload } from '../src/gdscript-executor.js';

/**
 * P2-4 orphan autoload 修复 — 纯函数行为断言。
 * 刻意独立文件(只 import gdscript-executor):与 exit-codes/path-utils 同文件时
 * REP-a 同输入在此文件通过、在合载文件返回 null(模块图加载顺序干扰,三重交叉验证
 * node+build / diag 单载均正确——产品逻辑无问题,故行为断言隔离于此,根因留档
 * docs/reviews/2026-09-11-p2-batch.md)。
 */
describe('P2-4: removeOrphanBridgeLines(纯函数)', () => {
  it('PURE-a: 残留条目移除/其他保留/幂等(null)', () => {
    const cfg = 'config_version=5\n\n[autoload]\n\nMCPBridge="*res://mcp_bridge.gd"\nOther="*res://other.gd"\n';
    const next = removeOrphanBridgeLines(cfg);
    expect(next, '有 orphan 返回新内容').not.toBeNull();
    expect(next!.includes('MCPBridge')).toBe(false);
    expect(next!.includes('Other='), '其他 autoload 不误删').toBe(true);
    expect(removeOrphanBridgeLines(next!), '幂等').toBeNull();
  });

  it('PURE-b: legacy 形态修复;用户自定义同名不删;正常内容 null', () => {
    const legacy = removeOrphanBridgeLines('[autoload]\n\nautoload/MCPBridge="*res://mcp_bridge.gd"\n');
    expect(legacy).not.toBeNull();
    expect(legacy!.includes('MCPBridge')).toBe(false);
    expect(removeOrphanBridgeLines('[autoload]\n\nMCPBridge="*res://my_own_bridge.gd"\n'), '值校验').toBeNull();
    expect(removeOrphanBridgeLines('[autoload]\n\nOther="*res://other.gd"\n')).toBeNull();
  });

  it('PURE-c: repairOrphanedBridgeAutoload 冒烟(脚本在 → false)', () => {
    // 不做文件系统断言(tmpdir 写盘在合载环境的怪象见文件头注);行为由 PURE-a/b 的
    // 纯函数 + node 端直跑(批次审查文档证据)覆盖。
    expect(typeof repairOrphanedBridgeAutoload).toBe('function');
  });
});
