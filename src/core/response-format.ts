// src/core/response-format.ts
/**
 * Response formatting + error detection utilities (Phase 1 of tool-discovery migration).
 *
 * 对标 unity-mcp-server/src/response-format.js(2026-08-10 深挖报告):
 *   - compactStringify:默认紧凑 JSON,省 20-50% token(对标 unity PRETTY 开关)
 *   - firstSentence:lean discovery 视图的一句话摘要(对标 unity firstSentence)
 *   - looksLikeErrorObject / isErrorText:统一逻辑失败识别(对标 unity looksLikeErrorObject)
 *
 * 本模块是纯函数集合,无副作用,无外部依赖,便于单测。
 */

const PRETTY = process.env.GODOT_MCP_PRETTY_JSON === '1';

/**
 * 紧凑序列化(默认),对齐 unity response-format.js:22。
 * 设 GODOT_MCP_PRETTY_JSON=1 时输出缩进格式(调试用)。
 */
export function compactStringify(value: unknown): string {
  return PRETTY ? JSON.stringify(value, null, 2) : JSON.stringify(value);
}

/**
 * 取文本的第一句话(lean discovery 视图用),对齐 unity response-format.js:74-93。
 *
 * 规则:
 *   - 找第一个 ". "(句点+空格)作为句子边界,但跳过 "e.g." / "i.e." 这类缩写
 *   - 超过 160 字符截断并加 "..."
 *   - 中文无 ". " 句号时返回全文(超 160 才截),兼容中文描述
 *
 * 返回 undefined 当输入为 undefined/null/空串。
 */
export function firstSentence(text: string | undefined | null): string | undefined {
  if (!text) return undefined;
  let from = 0;
  let cut = -1;
  while (true) {
    const idx = text.indexOf('. ', from);
    if (idx < 0) break;
    // 跳过 e.g. / i.e. 缩写(句点前 2-3 字符)
    const before = text.slice(Math.max(0, idx - 3), idx).toLowerCase();
    if (before.endsWith('e.g') || before.endsWith('i.e')) {
      from = idx + 2;
      continue;
    }
    cut = idx;
    break;
  }
  const sentence = cut > 0 ? text.slice(0, cut + 1) : text;
  return sentence.length > 160 ? `${sentence.slice(0, 157)}...` : sentence;
}

/**
 * 判断一个对象是否"看起来像错误",对齐 unity response-format.js:31-41。
 *
 * 识别的 shape(godot opsError + unity 兼容):
 *   - {success: false} 或 {ok: false} → true
 *   - {error: "string"} 或 {error: {message: "string"}} → true(unity 形态)
 *   - {message: "string"} 且无 success: true → true(godot advanced-proxy 的 UNKNOWN_TOOL 形态)
 *   - {success: true} 或 {ok: true} → false(显式成功优先,状态查询类带 error 字段但成功不算失败)
 *
 * @param obj 待检测对象(非对象/数组返回 false)
 */
export function looksLikeErrorObject(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const o = obj as Record<string, unknown>;
  // 显式成功标志优先(状态查询类工具带 error 字段但 success=true 不算失败)
  if (o.success === true || o.ok === true) return false;
  if (o.success === false || o.ok === false) return true;
  // unity 形态:error 为 string 或 {message: string}
  if (typeof o.error === 'string' && (o.error as string).length > 0) return true;
  if (o.error && typeof o.error === 'object' && typeof (o.error as { message?: unknown }).message === 'string') return true;
  // godot advanced-proxy 形态:{error_code, message}(无 success 字段时,message 存在即视为错误)
  // 注意:必须在 success 未设置时才认 message,避免误判 {success:true, message:"..."} 的成功响应
  if (typeof o.message === 'string' && (o.message as string).length > 0 && o.success === undefined && o.ok === undefined) {
    return true;
  }
  return false;
}

/**
 * 判断一段文本是否表示错误,对齐 unity response-format.js:102-119。
 *
 * 识别三类:
 *   1. JSON 对象 → looksLikeErrorObject
 *   2. 桥接 envelope:外层非错误但内层 data 是错误(unity 桥接包装)
 *   3. 纯文本以 "Error:" 或 "Error " 开头
 *
 * @param text 待检测文本
 */
export function isErrorText(text: string): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  const first = text[0]!;
  if (first === '{' || first === '[') {
    try {
      const parsed: unknown = JSON.parse(text);
      if (looksLikeErrorObject(parsed)) return true;
      // 桥接 envelope:外层非错误,但内层 data 是错误对象
      if (parsed && typeof parsed === 'object') {
        const data = (parsed as { data?: unknown }).data;
        if (looksLikeErrorObject(data)) return true;
      }
      return false;
    } catch {
      // JSON 解析失败,fall through 到文本检测
    }
  }
  return /^Error[:\s]/.test(text);
}
