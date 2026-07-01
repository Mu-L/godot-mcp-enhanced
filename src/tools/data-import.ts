// CSV 前置校验:仅解析 header 行(RFC4180 引号),不解析所有行值(权威解析在 GDScript get_csv_line)。
export interface ParseCsvResult { ok: boolean; headers?: string[]; error?: string; }

export function parseCsv(text: string): ParseCsvResult {
  if (!text || !text.trim()) return { ok: false, error: 'empty csv' };
  const firstLine = text.split(/\r?\n/)[0]!;
  // 简单 RFC4180:引号内逗号不拆(header 行)
  const headers: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < firstLine.length; i++) {
    const ch = firstLine[i]!;
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { headers.push(cur); cur = ''; continue; }
    cur += ch;
  }
  headers.push(cur);
  if (headers.length === 0) return { ok: false, error: 'no header columns' };
  return { ok: true, headers };
}

// T3: generateImportScript — 生成 GDScript 脚本,CSV 值通过 FileAccess.get_csv_line 运行时读取
// (零进脚本字符串 = CRITICAL-1 注入根治)。4 参数(classPath/outputDir/filenameCol/csvTmpPath)
// 经 gdEscape 转义后插值,防闭串注入。
import { gdEscape } from './shared.js';

export interface ImportScriptOpts {
  classPath: string;
  outputDir: string;
  filenameCol: string;
  csvTmpPath: string;
}

// GDScript 模板:tab 缩进(GDScript 强制 tab,空格被拒)。CSV 值走 FileAccess,不进脚本源码。
// 枚举转换:hint_string 优先(spec §4 修订 + T1 PoC 实证:纯 @export var x:int 无 hint=0,
// ClassDB 路径失效;只有 @export_enum 产生 hint=2 + hint_string,索引即 int),ClassDB fallback。
const GDSCRIPT_TEMPLATE = (cp: string, od: string, fc: string, csv: string) => `extends SceneTree
var _outputs := []
var _class_path := "${gdEscape(cp)}"
var _output_dir := "${gdEscape(od)}"
var _filename_col := "${gdEscape(fc)}"
var _csv_path := "${gdEscape(csv)}"
var _errors := []
var _generated := []
var _row_count := 0
var _failed := 0

func _mcp_output(k, v): _outputs.append({"key": k, "value": v})

func _convert_enum(raw: String, field: Dictionary, cls_name: String) -> Variant:
\t# 优先 hint_string(spec §4 修订 + T1 PoC 实证):@export_enum("SWORD,BOW") 产生逗号分隔列表,索引即 int
\tif field.has("hint_string") and field.hint_string != "":
\t\tvar opts: PackedStringArray = field.hint_string.split(",")
\t\tfor i in range(opts.size()):
\t\t\tif opts[i] == raw:
\t\t\t\treturn i
\t# fallback: ClassDB class enum
\tif ClassDB.class_has_integer_constant(cls_name, raw):
\t\treturn ClassDB.class_get_integer_constant(cls_name, raw)
\treturn null

func _type_convert(raw: String, field: Dictionary, cls_name: String) -> Variant:
\t# 枚举: TYPE_INT(2) + hint=PROPERTY_HINT_ENUM(2) 或 hint_string 非空
\tif field.type == 2 and (field.hint == 2 or (field.has("hint_string") and field.hint_string != "")):
\t\treturn _convert_enum(raw, field, cls_name)
\tmatch field.type:
\t\t2: return int(raw)
\t\t3: return float(raw)
\t\t4: return raw
\t\t1:
\t\t\tvar l := raw.to_lower()
\t\t\treturn l == "true" or l == "1"
\t\t5:
\t\t\tvar p: PackedStringArray = raw.split(",")
\t\t\tif p.size() >= 2: return Vector2(float(p[0]), float(p[1]))
\t\t12:
\t\t\tif raw.begins_with("#"): return Color.html(raw)
\t\t\tvar c: PackedStringArray = raw.split(",")
\t\t\tif c.size() >= 3: return Color(float(c[0]), float(c[1]), float(c[2]))
\t\t28, 30:  # TYPE_PACKED_STRING_ARRAY / TYPE_ARRAY
\t\t\treturn raw.split(",")
\treturn null

func _initialize():
\tvar Class = load(_class_path)
\tif Class == null:
\t\t_errors.append({"row": 0, "reason": "load class failed: " + _class_path})
\t\t_mcp_output("generated", _generated); _mcp_output("errors", _errors)
\t\t_mcp_output("stats", {"rows": 0, "generated": 0, "failed": 0}); print(JSON.stringify(_outputs)); quit(); return
\tvar inst0 = Class.new()
\tvar cls_name: String = inst0.get_class()
\tvar all_props: Array = inst0.get_property_list()
\tvar fields: Array = []
\tfor p in all_props:
\t\tif (p.usage & 8192) != 0:  # PROPERTY_USAGE_SCRIPT_VARIABLE
\t\t\tfields.append(p)
\tvar f := FileAccess.open(_csv_path, FileAccess.READ)
\tif f == null:
\t\t_errors.append({"row": 0, "reason": "open csv failed"}); _done(); return
\tvar header: PackedStringArray = f.get_csv_line()
\tvar fn_idx: int = header.find(_filename_col)
\tif fn_idx == -1:
\t\t_errors.append({"row": 0, "reason": "filename_column not found: " + _filename_col}); _done(); return
\tDirAccess.make_dir_recursive_absolute(_output_dir)
\tvar fn_re := RegEx.create_from_string("^[A-Za-z0-9_.-]+$")
\twhile not f.eof_reached():
\t\tvar row: PackedStringArray = f.get_csv_line()
\t\tif row.size() == 0 or (row.size() == 1 and row[0] == ""): continue
\t\t_row_count += 1
\t\tvar filename: String = row[fn_idx] if fn_idx < row.size() else ""
\t\tif filename == "":
\t\t\t_errors.append({"row": _row_count, "reason": "empty filename"}); _failed += 1; continue
\t\t# CRITICAL-2: filename 白名单 + 段级拒 ..
\t\tvar segs: PackedStringArray = filename.split("/")
\t\tvar has_dotdot := false
\t\tfor seg in segs:
\t\t\tif seg == "..": has_dotdot = true
\t\tif not fn_re.search(filename) or has_dotdot:
\t\t\t_errors.append({"row": _row_count, "value": filename, "reason": "invalid filename"}); _failed += 1; continue
\t\tvar res = Class.new()
\t\tfor field in fields:
\t\t\tvar col: int = header.find(field.name)
\t\t\tif col == -1: continue  # 缺失列 → 保留默认
\t\t\tif col >= row.size(): continue
\t\t\tvar raw: String = row[col]
\t\t\tif raw == "": continue  # 空单元格 → 保留默认(防空串覆盖)
\t\t\tvar converted: Variant = _type_convert(raw, field, cls_name)
\t\t\tif converted == null:
\t\t\t\t_errors.append({"row": _row_count, "field": field.name, "value": raw, "reason": "type convert failed"}); continue
\t\t\tres.set(field.name, converted)
\t\tvar full_path: String = _output_dir + "/" + filename + ".tres"
\t\tResourceSaver.save(res, full_path)
\t\t_generated.append(full_path)
\t_done()

func _done():
\t_mcp_output("generated", _generated); _mcp_output("errors", _errors)
\t_mcp_output("stats", {"rows": _row_count, "generated": _generated.size(), "failed": _failed})
\tprint(JSON.stringify(_outputs)); quit()
`;

export function generateImportScript(o: ImportScriptOpts): string {
  return GDSCRIPT_TEMPLATE(o.classPath, o.outputDir, o.filenameCol, o.csvTmpPath);
}
