// B7 Task 3b: addons + TS 资源写原子化字面量契约测试。
// 验证 8 处（addons 3 + TS 5）已改为 tmp+rename 原子模式（对齐 data-import.ts:188 + Task 3a godot_operations.gd _save_atomic）。
// 注意：字面量测试无法抓 Godot 方法签名错误（DirAccess.file_exists 静态/实例坑），依赖 e2e/真编译兜底。
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const files = {
  commandHelpers: 'addons/godot_mcp_server/commands/command_helpers.gd',
  uiCommands: 'addons/godot_mcp_server/commands/ui_commands.gd',
  assetCommands: 'addons/godot_mcp_server/commands/asset/asset_commands.gd',
  uiTheme: 'src/tools/ui/ui-theme.ts',
  sceneCommit: 'src/tools/scene/scene-commit.ts',
  sceneInstance: 'src/tools/scene/scene-instance.ts',
  materialOps: 'src/tools/material-ops.ts',
};

describe('B7 Task 3b: addons + TS 资源写原子化', () => {
  it('addons command_helpers.gd 定义 static _save_atomic（对齐 3a 模式 + FileAccess write-before-clean）', () => {
    const src = readFileSync(files.commandHelpers, 'utf8');
    // addons 既有 helper 全是 static（class_name CommandHelpers），_save_atomic 须对齐
    expect(src).toContain('static func _save_atomic(');
    // 原子提交核心：tmp 派生扩展名 + rename
    expect(src).toContain('rename_absolute');
    expect(src).toMatch(/\.tmp\./); // tmp 须按目标扩展名派生（裸 .tmp 返 err 15）
    // T3a 教训1：FileAccess.file_exists（静态）非 DirAccess.file_exists（实例方法）
    // T3a 教训3：write-before-clean（同路径旧 tmp 残留先清）
    expect(src).toContain('FileAccess.file_exists');
    // 禁用调用形式（注释里提到字面字符串不触发——精确匹配 `DirAccess.file_exists(` 开括号调用）
    expect(src).not.toMatch(/\bDirAccess\.file_exists\s*\(/);
  });

  it('addons ui_commands.gd + asset_commands.gd 全部改调 _save_atomic（无 ResourceSaver.save 直写）', () => {
    for (const f of [files.uiCommands, files.assetCommands]) {
      const src = readFileSync(f, 'utf8');
      // 严格断言：3 个调用文件完全不含 ResourceSaver.save 直写（所有 save 走 helper）
      expect(src, f).not.toMatch(/ResourceSaver\.save/);
      expect(src, f).toContain('_save_atomic(');
    }
  });

  it('TS 生成片段含 tmp+rename 原子模式（对齐 data-import.ts:188）', () => {
    for (const f of [files.uiTheme, files.sceneCommit, files.sceneInstance, files.materialOps]) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).toMatch(/\.tmp\./);               // tmp 派生扩展名
      expect(src, f).toMatch(/rename_absolute/);       // 原子提交
      expect(src, f).toMatch(/remove_absolute/);       // 失败清 tmp
    }
  });

  it('TS 生成片段含 FileAccess.file_exists write-before-clean（T3a 教训3）', () => {
    // T3a 最终实现 _save_atomic 含「写前清同路径旧 tmp」，TS 5 处内联块也加这行
    for (const f of [files.uiTheme, files.sceneCommit, files.sceneInstance, files.materialOps]) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).toMatch(/FileAccess\.file_exists/); // 静态 file_exists
      expect(src, f).not.toMatch(/\bDirAccess\.file_exists\s*\(/); // 禁用调用形式
    }
  });
});
