import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// 批次 B 可靠性：GodotServer 降级链路字面量契约测试。
// B2/B6 在 GodotServer（集成层），单测 mock 成本高；按 recording-screen-drag F2
// 模式用源码字面量断言（对齐 brief Step 9 契约）。

describe('GodotServer 降级链路（B2+B6 字面量契约）', () => {
  const src = readFileSync('src/GodotServer.ts', 'utf8');

  it('B2: handleEditorStall calls disconnect() before nulling editorConn', () => {
    const stallFn = src.match(/private handleEditorStall\(\)[\s\S]*?^\s*}/m);
    expect(stallFn, 'handleEditorStall 函数体未找到').toBeTruthy();
    // disconnect 必须出现在 editorConn = null 之前
    const body = stallFn![0];
    const discIdx = body.indexOf('this.editorConn?.disconnect()');
    const nullIdx = body.indexOf('this.editorConn = null');
    expect(discIdx, 'handleEditorStall 缺少 this.editorConn?.disconnect()').toBeGreaterThan(-1);
    expect(nullIdx, 'handleEditorStall 缺少 this.editorConn = null').toBeGreaterThan(-1);
    expect(nullIdx, 'disconnect() 必须在 editorConn = null 之前').toBeGreaterThan(discIdx);
  });

  it('B6: establishEditorConnection 复位 hm 状态为 connected（重建恢复）', () => {
    // establishEditorConnection 函数体内有嵌套块(if/try)致正则 `^\s*}` 提前闭合,
    // 故改用位置契约:hm.setState('connected') 必须落在 establishEditorConnection
    // 函数体范围内(起点 < setState 位置 < 下一个方法 rebuildEditorConnection 起点)。
    const establishStart = src.indexOf('establishEditorConnection(');
    expect(establishStart, '未找到 establishEditorConnection 方法').toBeGreaterThan(-1);
    const rebuildStart = src.indexOf('rebuildEditorConnection(', establishStart);
    expect(rebuildStart, '未找到 rebuildEditorConnection(应紧跟 establishEditorConnection 之后)').toBeGreaterThan(establishStart);
    const slice = src.slice(establishStart, rebuildStart);
    expect(
      slice.indexOf("hm.setState('connected')"),
      'establishEditorConnection 缺少 hm.setState("connected")（B6 重建复位）',
    ).toBeGreaterThan(-1);
  });
});
