// test/p1-7-logging.test.ts
// P1-7 (SEP-2577): 验证 GodotServer 的 logging capability 声明 + 项目上下文通知走 sendLoggingMessage。
// 采用源码字面量断言模式(对齐 godot-server-degrade.test.ts F2 模式)。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('P1-7 SEP-2577 logging 合规', () => {
  const src = readFileSync('src/GodotServer.ts', 'utf8');

  describe('logging capability 声明(SERVERS that emit notifications/message MUST declare)', () => {
    it('capabilities 含 logging: {} 声明', () => {
      // SEP-2577: emit log 的 server MUST 声明 logging capability。
      // 此前未声明 → SDK sendLoggingMessage 静默 no-op(logger.ts warn/error 推送失效),
      // 且 GodotServer 直发 notification(notifications/message) 抛 SdkError 被 catch 吞。
      expect(src).toMatch(/logging:\s*\{\s*\}/);
    });
  });

  describe('项目上下文通知走 SDK 正规 logging 路径', () => {
    it('用 sendLoggingMessage(非 this.server.notification 直发 notifications/message)', () => {
      // P1-7: 从 this.server.notification({method:'notifications/message',...}) 改为
      // this.server.sendLoggingMessage({level:'info',...})。
      // sendLoggingMessage 走 SDK 正规 logging 路径,声明 capability 后正常发出;
      // notification 直发会被 assertNotificationCapability 抛错。
      expect(src).toMatch(/this\.server\.sendLoggingMessage\(/);
      // 不应再有 this.server.notification 直发 notifications/message 的实际调用
      // (注释里的历史描述允许,只检查实际调用模式 this.server.notification(...method:'notifications/message')
      expect(src).not.toMatch(/this\.server\.notification\(\s*\{\s*method:\s*['"]notifications\/message['"]/);
    });

    it('项目上下文通知 level=info, logger=server', () => {
      // 验证通知内容格式(SEP-2577 LoggingMessageNotification params: level + logger + data)
      expect(src).toMatch(/level:\s*['"]info['"]/);
      expect(src).toMatch(/logger:\s*['"]server['"]/);
    });
  });
});
