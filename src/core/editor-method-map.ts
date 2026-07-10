// src/core/editor-method-map.ts
// editor 模式 (tool, action) → command_handler 扁平 method 映射。
//
// 背景：EditorToolExecutor._executeInner 原本用工具名（如 'asset'）直接当 JSON-RPC
// method 转发给 command_handler.gd，但 command_handler 只有扁平分支
// （asset_create / asset_path / asset_batch / asset_undo / asset_save），无 'asset'
// 聚合入口 → 走兜底 -32601。本表把 (tool=asset, action=create) 映射到 asset_create，
// 让 editor 转发真正命中 GD handle_*。
//
// 未命中（list_shapes / list_materials 等无对应 GD 分支的 action，或未登记的工具）
// 返回 null，调用方 fallback 到工具名，维持原 -32601 → headless 回退路径
// （见 ToolDispatcher._isUnknownMethod）。
//
// command_handler 分支命名不统一（asset_create 有前缀 / add_node 无前缀 / guard_*
// 域前缀），无法自动推导，故用显式表。新增 (tool,action) 工具时在此登记映射。

type Args = Record<string, unknown>;

export interface EditorMethodEntry {
  /** command_handler.gd 的扁平 method 名 */
  readonly method: string;
  /** 可选：转发前变换 args（如修正字段层级） */
  readonly transformArgs?: (args: Args) => Args;
}

// asset.create 的 transform 修正（不兼容 B）：TS schema 把 position/rotation/scale
// 放顶层（asset-ops.ts，与 params 平级），但 GD handle_create 只把内层 params 传给
// place_one / _apply_transform，顶层 transform 会被静默丢弃。此处把顶层 transform
// 并入 params（params 已有同名键优先，免覆盖 shape 参数）。
export function mergeTransformIntoParams(args: Args): Args {
  const params =
    args.params && typeof args.params === 'object'
      ? { ...(args.params as Args) }
      : {};
  for (const key of ['position', 'rotation', 'scale'] as const) {
    if (args[key] !== undefined && params[key] === undefined) {
      params[key] = args[key];
    }
  }
  return { ...args, params };
}

const MAP: Record<string, Record<string, EditorMethodEntry>> = {
  asset: {
    create: { method: 'asset_create', transformArgs: mergeTransformIntoParams },
    path: { method: 'asset_path' },
    batch: { method: 'asset_batch' },
    undo: { method: 'asset_undo' },
    save: { method: 'asset_save' },
  },
};

/** 解析 (toolName, args.action) → command_handler method。未命中返回 null。 */
export function resolveEditorMethod(toolName: string, args: Args): EditorMethodEntry | null {
  const actionMap = MAP[toolName];
  if (!actionMap) return null;
  const action = args.action;
  if (typeof action !== 'string') return null;
  return actionMap[action] ?? null;
}

// 供漂移检测测试引用：asset 写动作映射到的扁平 method 名（须与
// command_handler.gd 的 asset_* 分支一致）。
export const ASSET_EDITOR_METHODS = [
  'asset_create',
  'asset_path',
  'asset_batch',
  'asset_undo',
  'asset_save',
] as const;
