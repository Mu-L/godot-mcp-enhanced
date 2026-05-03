import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolResult } from '../types.js';
import { textResult } from '../types.js';
import { validatePath } from '../helpers.js';
import { executeGdscript } from '../gdscript-executor.js';
import { normalizeNodePath, gdEscape } from './godot-ops.js';

// ─── Constants ─────────────────────────────────────────────────────────────

export const TILEMAP_ERROR_CODES = {
  TILEMAP_NOT_FOUND: 'TILEMAP_NOT_FOUND',
  INVALID_TILE_COORDS: 'INVALID_TILE_COORDS',
  INVALID_REGION: 'INVALID_REGION',
  TILE_SOURCE_NOT_FOUND: 'TILE_SOURCE_NOT_FOUND',
  SCRIPT_EXEC_FAILED: 'SCRIPT_EXEC_FAILED',
} as const;

const MARKER_RESULT = '___MCP_RESULT___';

// ─── Helper Utilities ─────────────────────────────────────────────────────

export function validateCoords(v: unknown): { x: number; y: number } {
  if (typeof v !== 'object' || v === null) throw new Error('Coords must be an object with x, y integer fields');
  const obj = v as Record<string, unknown>;
  for (const key of ['x', 'y']) {
    if (typeof obj[key] !== 'number' || !Number.isInteger(obj[key] as number)) {
      throw new Error(`Coords field "${key}" must be an integer`);
    }
  }
  return { x: obj.x as number, y: obj.y as number };
}

export function validateRect2i(v: unknown): { x: number; y: number; w: number; h: number } {
  if (typeof v !== 'object' || v === null) throw new Error('Region must be an object with x, y, w, h integer fields');
  const obj = v as Record<string, unknown>;
  for (const key of ['x', 'y', 'w', 'h']) {
    if (typeof obj[key] !== 'number' || !Number.isInteger(obj[key] as number)) {
      throw new Error(`Region field "${key}" must be an integer`);
    }
  }
  const w = obj.w as number;
  const h = obj.h as number;
  if (w <= 0) throw new Error('Region w must be > 0');
  if (h <= 0) throw new Error('Region h must be > 0');
  return { x: obj.x as number, y: obj.y as number, w, h };
}

// Internal helpers
function opsError(code: keyof typeof TILEMAP_ERROR_CODES, message: string) {
  return { success: false, error: message, error_code: TILEMAP_ERROR_CODES[code], warnings: [] };
}

function opsSuccess(data: unknown, warnings: string[] = []) {
  return { success: true, data, warnings };
}

function opsErrorResult(code: keyof typeof TILEMAP_ERROR_CODES, message: string): ToolResult {
  return textResult(JSON.stringify(opsError(code, message)));
}

const SCENE_TREE_HEADER = `extends SceneTree

func _mcp_output(key: String, value) -> void:
\tif not _mcp_outputs: _mcp_outputs = []
\t_mcp_outputs.append({"key": key, "value": str(value)})

var _mcp_outputs: Array = []

func _mcp_done() -> void:
\tprint("${MARKER_RESULT}" + JSON.stringify({"success": true, "outputs": _mcp_outputs}))
\tquit()
`;

const NON_PERSIST = '运行时操作，仅影响当前执行上下文。如需持久化，请编辑 .tscn 文件。';

// ─── GDScript Generators: TileMap ──────────────────────────────────────────

export function genTilemapReadScript(
  nodePath: string, region?: { x: number; y: number; w: number; h: number }, layer?: number
): string {
  if (region) {
    return `${SCENE_TREE_HEADER}
func _initialize():
\tvar node = get_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tif node is TileMap:
\t\tvar cells = []
\t\tfor cy in range(${region.y}, ${region.y + region.h}):
\t\t\tfor cx in range(${region.x}, ${region.x + region.w}):
\t\t\t\tvar sid = node.get_cell_source_id(${layer !== undefined ? layer : 0}, Vector2i(cx, cy))
\t\t\t\tif sid >= 0:
\t\t\t\t\tvar ac = node.get_cell_atlas_coords(${layer !== undefined ? layer : 0}, Vector2i(cx, cy))
\t\t\t\t\tvar alt = node.get_cell_alternative_tile(${layer !== undefined ? layer : 0}, Vector2i(cx, cy))
\t\t\t\t\tcells.append({"coords": [cx, cy], "source_id": sid, "atlas_coords": [ac.x, ac.y], "alternative_tile": alt})
\t\t_mcp_output("cells", cells)
\telif node is TileMapLayer:
\t\tvar cells = []
\t\tfor cy in range(${region.y}, ${region.y + region.h}):
\t\t\tfor cx in range(${region.x}, ${region.x + region.w}):
\t\t\t\tvar sid = node.get_cell_source_id(Vector2i(cx, cy))
\t\t\t\tif sid >= 0:
\t\t\t\t\tvar ac = node.get_cell_atlas_coords(Vector2i(cx, cy))
\t\t\t\t\tvar alt = node.get_cell_alternative_tile(Vector2i(cx, cy))
\t\t\t\t\tcells.append({"coords": [cx, cy], "source_id": sid, "atlas_coords": [ac.x, ac.y], "alternative_tile": alt})
\t\t_mcp_output("cells", cells)
\telse:
\t\t_mcp_output("error", "Not a TileMap or TileMapLayer: " + node.get_class())
\t_mcp_done()
`;
  }

  return `${SCENE_TREE_HEADER}
func _initialize():
\tvar node = get_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tif node is TileMap:
\t\tvar used = node.get_used_cells(${layer !== undefined ? layer : 0})
\t\tvar cells = []
\t\tfor c in used:
\t\t\tvar sid = node.get_cell_source_id(${layer !== undefined ? layer : 0}, c)
\t\t\tvar ac = node.get_cell_atlas_coords(${layer !== undefined ? layer : 0}, c)
\t\t\tvar alt = node.get_cell_alternative_tile(${layer !== undefined ? layer : 0}, c)
\t\t\tcells.append({"coords": [c.x, c.y], "source_id": sid, "atlas_coords": [ac.x, ac.y], "alternative_tile": alt})
\t\t_mcp_output("cells", cells)
\telif node is TileMapLayer:
\t\tvar used = node.get_used_cells()
\t\tvar cells = []
\t\tfor c in used:
\t\t\tvar sid = node.get_cell_source_id(c)
\t\t\tvar ac = node.get_cell_atlas_coords(c)
\t\t\tvar alt = node.get_cell_alternative_tile(c)
\t\t\tcells.append({"coords": [c.x, c.y], "source_id": sid, "atlas_coords": [ac.x, ac.y], "alternative_tile": alt})
\t\t_mcp_output("cells", cells)
\telse:
\t\t_mcp_output("error", "Not a TileMap or TileMapLayer: " + node.get_class())
\t_mcp_done()
`;
}

export function genTilemapSetCellScript(
  nodePath: string, coords: { x: number; y: number },
  sourceId: number, atlasCoords: { x: number; y: number },
  alternativeTile: number, layer?: number
): string {
  return `${SCENE_TREE_HEADER}
func _initialize():
\tvar node = get_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tvar coords = Vector2i(${coords.x}, ${coords.y})
\tvar atlas = Vector2i(${atlasCoords.x}, ${atlasCoords.y})
\tif node is TileMap:
\t\tnode.set_cell(${layer !== undefined ? layer : 0}, coords, ${sourceId}, atlas, ${alternativeTile})
\telif node is TileMapLayer:
\t\tnode.set_cell(coords, ${sourceId}, atlas, ${alternativeTile})
\telse:
\t\t_mcp_output("error", "Not a TileMap or TileMapLayer: " + node.get_class())
\t\t_mcp_done()
\t\treturn
\t_mcp_output("set", {"coords": [${coords.x}, ${coords.y}], "source_id": ${sourceId}})
\t_mcp_done()
`;
}

export function genTilemapEraseCellScript(
  nodePath: string, coords: { x: number; y: number }, layer?: number
): string {
  return `${SCENE_TREE_HEADER}
func _initialize():
\tvar node = get_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tvar coords = Vector2i(${coords.x}, ${coords.y})
\tif node is TileMap:
\t\tnode.erase_cell(${layer !== undefined ? layer : 0}, coords)
\telif node is TileMapLayer:
\t\tnode.erase_cell(coords)
\telse:
\t\t_mcp_output("error", "Not a TileMap or TileMapLayer: " + node.get_class())
\t\t_mcp_done()
\t\treturn
\t_mcp_output("erased", {"coords": [${coords.x}, ${coords.y}]})
\t_mcp_done()
`;
}

export function genTilemapFillRectScript(
  nodePath: string, region: { x: number; y: number; w: number; h: number },
  sourceId: number, atlasCoords: { x: number; y: number },
  alternativeTile: number, layer?: number
): string {
  return `${SCENE_TREE_HEADER}
func _initialize():
\tvar node = get_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tvar atlas = Vector2i(${atlasCoords.x}, ${atlasCoords.y})
\tif node is TileMap:
\t\tfor cy in range(${region.h}):
\t\t\tfor cx in range(${region.w}):
\t\t\t\tnode.set_cell(${layer !== undefined ? layer : 0}, Vector2i(${region.x} + cx, ${region.y} + cy), ${sourceId}, atlas, ${alternativeTile})
\telif node is TileMapLayer:
\t\tfor cy in range(${region.h}):
\t\t\tfor cx in range(${region.w}):
\t\t\t\tnode.set_cell(Vector2i(${region.x} + cx, ${region.y} + cy), ${sourceId}, atlas, ${alternativeTile})
\telse:
\t\t_mcp_output("error", "Not a TileMap or TileMapLayer: " + node.get_class())
\t\t_mcp_done()
\t\treturn
\t_mcp_output("filled", {"region": {"x": ${region.x}, "y": ${region.y}, "w": ${region.w}, "h": ${region.h}}, "source_id": ${sourceId}})
\t_mcp_done()
`;
}

export function genTilemapClearScript(
  nodePath: string, layer?: number
): string {
  return `${SCENE_TREE_HEADER}
func _initialize():
\tvar node = get_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tif node is TileMap:
\t\tnode.clear()
\telif node is TileMapLayer:
\t\tnode.clear()
\telse:
\t\t_mcp_output("error", "Not a TileMap or TileMapLayer: " + node.get_class())
\t\t_mcp_done()
\t\treturn
\t_mcp_output("cleared", {"node": "${gdEscape(nodePath)}"})
\t_mcp_done()
`;
}

export function genTilemapCopyScript(
  nodePath: string, sourceRegion: { x: number; y: number; w: number; h: number }, layer?: number
): string {
  const l = layer !== undefined ? layer : 0;
  return `${SCENE_TREE_HEADER}
func _initialize():
\tvar node = get_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tvar cells = []
\tif node is TileMap:
\t\tfor cy in range(${sourceRegion.h}):
\t\t\tfor cx in range(${sourceRegion.w}):
\t\t\t\tvar c = Vector2i(${sourceRegion.x} + cx, ${sourceRegion.y} + cy)
\t\t\t\tvar sid = node.get_cell_source_id(${l}, c)
\t\t\t\tif sid >= 0:
\t\t\t\t\tvar ac = node.get_cell_atlas_coords(${l}, c)
\t\t\t\t\tvar alt = node.get_cell_alternative_tile(${l}, c)
\t\t\t\t\tcells.append({"coords": [cx, cy], "source_id": sid, "atlas_coords": [ac.x, ac.y], "alternative_tile": alt})
\telif node is TileMapLayer:
\t\tfor cy in range(${sourceRegion.h}):
\t\t\tfor cx in range(${sourceRegion.w}):
\t\t\t\tvar c = Vector2i(${sourceRegion.x} + cx, ${sourceRegion.y} + cy)
\t\t\t\tvar sid = node.get_cell_source_id(c)
\t\t\t\tif sid >= 0:
\t\t\t\t\tvar ac = node.get_cell_atlas_coords(c)
\t\t\t\t\tvar alt = node.get_cell_alternative_tile(c)
\t\t\t\t\tcells.append({"coords": [cx, cy], "source_id": sid, "atlas_coords": [ac.x, ac.y], "alternative_tile": alt})
\telse:
\t\t_mcp_output("error", "Not a TileMap or TileMapLayer: " + node.get_class())
\t\t_mcp_done()
\t\treturn
\t_mcp_output("pattern", {"cells": cells, "size": {"w": ${sourceRegion.w}, "h": ${sourceRegion.h}}})
\t_mcp_done()
`;
}

export function genTilemapPasteScript(
  nodePath: string, targetCoords: { x: number; y: number },
  pattern: { cells: Array<{ coords: [number, number]; source_id: number; atlas_coords: [number, number]; alternative_tile: number }>; size: { w: number; h: number } },
  layer?: number
): string {
  const patternJson = JSON.stringify(pattern);
  return `${SCENE_TREE_HEADER}
func _initialize():
\tvar node = get_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tvar pattern = JSON.parse('${gdEscape(patternJson)}')
\tvar tx = ${targetCoords.x}
\tvar ty = ${targetCoords.y}
\tif node is TileMap:
\t\tfor cell in pattern["cells"]:
\t\t\tvar cx = cell["coords"][0] + tx
\t\t\tvar cy = cell["coords"][1] + ty
\t\t\tnode.set_cell(${layer !== undefined ? layer : 0}, Vector2i(cx, cy), cell["source_id"], Vector2i(cell["atlas_coords"][0], cell["atlas_coords"][1]), cell["alternative_tile"])
\telif node is TileMapLayer:
\t\tfor cell in pattern["cells"]:
\t\t\tvar cx = cell["coords"][0] + tx
\t\t\tvar cy = cell["coords"][1] + ty
\t\t\tnode.set_cell(Vector2i(cx, cy), cell["source_id"], Vector2i(cell["atlas_coords"][0], cell["atlas_coords"][1]), cell["alternative_tile"])
\telse:
\t\t_mcp_output("error", "Not a TileMap or TileMapLayer: " + node.get_class())
\t\t_mcp_done()
\t\treturn
\t_mcp_output("pasted", {"target": [tx, ty], "cell_count": pattern["cells"].size()})
\t_mcp_done()
`;
}

export function genTilemapSetTransformScript(
  nodePath: string, coords: { x: number; y: number },
  flipH: boolean, flipV: boolean, transpose: boolean, layer?: number
): string {
  return `${SCENE_TREE_HEADER}
func _initialize():
\tvar node = get_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tvar c = Vector2i(${coords.x}, ${coords.y})
\tvar sid: int = -1
\tvar ac: Vector2i = Vector2i(0, 0)
\tvar alt: int = 0
\tif node is TileMap:
\t\tsid = node.get_cell_source_id(${layer !== undefined ? layer : 0}, c)
\t\tif sid < 0:
\t\t\t_mcp_output("error", "No tile at coords")
\t\t\t_mcp_done()
\t\t\treturn
\t\tac = node.get_cell_atlas_coords(${layer !== undefined ? layer : 0}, c)
\t\talt = node.get_cell_alternative_tile(${layer !== undefined ? layer : 0}, c)
\telif node is TileMapLayer:
\t\tsid = node.get_cell_source_id(c)
\t\tif sid < 0:
\t\t\t_mcp_output("error", "No tile at coords")
\t\t\t_mcp_done()
\t\t\treturn
\t\tac = node.get_cell_atlas_coords(c)
\t\talt = node.get_cell_alternative_tile(c)
\telse:
\t\t_mcp_output("error", "Not a TileMap or TileMapLayer: " + node.get_class())
\t\t_mcp_done()
\t\treturn
\tvar base_alt = alt & ~7
\tvar new_alt = base_alt
\tif ${flipH}:
\t\tnew_alt = new_alt | 1
\tif ${flipV}:
\t\tnew_alt = new_alt | 2
\tif ${transpose}:
\t\tnew_alt = new_alt | 4
\tif node is TileMap:
\t\tnode.set_cell(${layer !== undefined ? layer : 0}, c, sid, ac, new_alt)
\telse:
\t\tnode.set_cell(c, sid, ac, new_alt)
\t_mcp_output("transform_set", {"coords": [${coords.x}, ${coords.y}], "flip_h": ${flipH}, "flip_v": ${flipV}, "transpose": ${transpose}, "alternative_tile": new_alt})
\t_mcp_done()
`;
}

// ─── Tool Registration (placeholder — Task 5 will replace) ────────────────

export function getToolDefinitions(): Tool[] {
  return [];
}

export async function handleTool(
  _name: string, _args: Record<string, unknown>, _ctx: ToolContext
): Promise<ToolResult | null> {
  return null;
}
