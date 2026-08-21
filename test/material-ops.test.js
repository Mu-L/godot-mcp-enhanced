import { expect } from 'vitest';
import {
  MATERIAL_ERROR_CODES,
  validateParamType,
  handleTool,
  genMaterialReadScript,
  genMaterialSetParamsScript,
  genMaterialCreateScript,
  genMaterialSaveScript,
  genMaterialLoadScript,
  genShaderReadScript,
  genShaderWriteScript,
  genShaderLoadFileScript,
  genShaderSaveFileScript,
  genShaderApplyTemplateScript,
  parseMaterialParam,
} from '../src/tools/material-ops.js';

describe('handleTool set_params (IMP-1: BLOCKED_PROPS)', () => {
  it('rejects blocked properties script/owner/name/instance', async () => {
    const fakeCtx = { findGodot: async () => '/fake/godot', projectDir: '/fake/p' };
    for (const bad of ['script', 'owner', 'name', 'instance']) {
      const result = await handleTool('material', {
        project_path: '/fake/p', action: 'set_params',
        node_path: 'root/Mesh', material_index: 0,
        params: { [bad]: 'x' },
      }, fakeCtx);
      expect(result).toBeTruthy();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
    }
  });
});

// ─── Error Codes ───────────────────────────────────────────────────────────

describe('MATERIAL_ERROR_CODES', () => {
  it('has MATERIAL_NOT_FOUND', () => { expect('MATERIAL_NOT_FOUND' in MATERIAL_ERROR_CODES).toBeTruthy(); });
  it('has INVALID_MATERIAL_TYPE', () => { expect('INVALID_MATERIAL_TYPE' in MATERIAL_ERROR_CODES).toBeTruthy(); });
  it('has INVALID_PARAM_TYPE', () => { expect('INVALID_PARAM_TYPE' in MATERIAL_ERROR_CODES).toBeTruthy(); });
  it('has SHADER_COMPILE_FAILED', () => { expect('SHADER_COMPILE_FAILED' in MATERIAL_ERROR_CODES).toBeTruthy(); });
  it('has RESOURCE_SAVE_FAILED', () => { expect('RESOURCE_SAVE_FAILED' in MATERIAL_ERROR_CODES).toBeTruthy(); });
  it('has INVALID_TEMPLATE', () => { expect('INVALID_TEMPLATE' in MATERIAL_ERROR_CODES).toBeTruthy(); });
  it('has SCRIPT_EXEC_FAILED', () => { expect('SCRIPT_EXEC_FAILED' in MATERIAL_ERROR_CODES).toBeTruthy(); });
});

// ─── validateParamType ────────────────────────────────────────────────────

describe('validateParamType', () => {
  it('returns "number" for numbers', () => {
    expect(validateParamType(3.14)).toBe('number');
  });
  it('returns "number" for integers', () => {
    expect(validateParamType(0)).toBe('number');
  });
  it('returns "string" for strings', () => {
    expect(validateParamType('hello')).toBe('string');
  });
  it('returns "boolean" for booleans', () => {
    expect(validateParamType(true)).toBe('boolean');
  });
  it('returns "null" for null', () => {
    expect(validateParamType(null)).toBe('null');
  });
  it('returns "null" for undefined', () => {
    expect(validateParamType(undefined)).toBe('null');
  });
  it('returns "array" for array length 2 (Vector2)', () => {
    expect(validateParamType([1, 2])).toBe('array');
  });
  it('returns "array" for array length 3 (Vector3)', () => {
    expect(validateParamType([1, 2, 3])).toBe('array');
  });
  it('returns "array" for array length 4 (Color)', () => {
    expect(validateParamType([1, 0, 0, 1])).toBe('array');
  });
  it('rejects array length 1', () => {
    expect(() => validateParamType([1])).toThrow(/array length 1/);
  });
  it('rejects array length 5', () => {
    expect(() => validateParamType([1, 2, 3, 4, 5])).toThrow(/array length 5/);
  });
  it('rejects objects', () => {
    expect(() => validateParamType({})).toThrow(/not supported/);
  });
  it('rejects arrays with non-number elements', () => {
    expect(() => validateParamType(['a', 'b'])).toThrow(/must be a number/);
  });
  it('rejects arrays with mixed types', () => {
    expect(() => validateParamType([1, 'x', 3])).toThrow(/must be a number/);
  });
});

// ─── genMaterialReadScript ────────────────────────────────────────────────

describe('genMaterialReadScript', () => {
  it('contains material check', () => {
    const script = genMaterialReadScript('/root/Player', 0);
    expect(script).toContain('material');
  });
  it('contains get_surface_override_material', () => {
    const script = genMaterialReadScript('/root/Player', 0);
    expect(script).toContain('get_surface_override_material');
  });
  it('contains surface_get_material', () => {
    const script = genMaterialReadScript('/root/Player', 0);
    expect(script).toContain('surface_get_material');
  });
  it('contains ShaderMaterial branch', () => {
    const script = genMaterialReadScript('/root/Player', 0);
    expect(script).toContain('ShaderMaterial');
    expect(script).toContain('get_shader_uniform_list');
  });
  it('contains get_property_list for built-in materials', () => {
    const script = genMaterialReadScript('/root/Player', 0);
    expect(script).toContain('get_property_list');
    expect(script).toContain('PROPERTY_USAGE_STORAGE');
  });
  it('uses material_index parameter', () => {
    const script = genMaterialReadScript('/root/Player', 2);
    expect(script).toContain('get_surface_override_material(2)');
  });
});

// ─── genMaterialCreateScript ──────────────────────────────────────────────

describe('genMaterialCreateScript', () => {
  it('creates ShaderMaterial', () => {
    const script = genMaterialCreateScript('/root/Player', 'ShaderMaterial');
    expect(script).toContain('ShaderMaterial.new()');
    expect(script).toContain('material');
  });
  it('creates StandardMaterial3D', () => {
    const script = genMaterialCreateScript('/root/Player', 'StandardMaterial3D');
    expect(script).toContain('StandardMaterial3D.new()');
  });
  it('creates CanvasItemMaterial', () => {
    const script = genMaterialCreateScript('/root/Player', 'CanvasItemMaterial');
    expect(script).toContain('CanvasItemMaterial.new()');
  });
  it('includes shader loading when shader_path provided', () => {
    const script = genMaterialCreateScript('/root/Player', 'ShaderMaterial', 'res://shaders/player.gdshader');
    expect(script).toContain('ResourceLoader.exists');
    expect(script).toContain('res://shaders/player.gdshader');
  });
  it('no shader loading for non-ShaderMaterial', () => {
    const script = genMaterialCreateScript('/root/Player', 'StandardMaterial3D', 'res://shaders/player.gdshader');
    expect(script.includes('ResourceLoader.exists')).toBeFalsy();
  });
});

// ─── genMaterialSetParamsScript ───────────────────────────────────────────

describe('genMaterialSetParamsScript', () => {
  it('generates is_shader branch', () => {
    const script = genMaterialSetParamsScript('/root/Player', 0, { intensity: 2.5 });
    expect(script).toContain('is_shader');
    expect(script).toContain('set_shader_parameter');
    expect(script).toContain('mat.set(');
  });
  it('converts number to float', () => {
    const script = genMaterialSetParamsScript('/root/Player', 0, { intensity: 2.5 });
    expect(script).toContain('2.5');
  });
  it('converts array[4] to Color', () => {
    const script = genMaterialSetParamsScript('/root/Player', 0, { albedo: [1, 0, 0, 1] });
    expect(script).toContain('Color(1, 0, 0, 1)');
  });
  it('converts array[2] to Vector2', () => {
    const script = genMaterialSetParamsScript('/root/Player', 0, { offset: [3, 4] });
    expect(script).toContain('Vector2(3, 4)');
  });
  it('converts array[3] to Vector3', () => {
    const script = genMaterialSetParamsScript('/root/Player', 0, { pos: [1, 2, 3] });
    expect(script).toContain('Vector3(1, 2, 3)');
  });
  it('converts boolean', () => {
    const script = genMaterialSetParamsScript('/root/Player', 0, { visible: true });
    expect(script).toContain('mat.set_shader_parameter("visible", true)');
    expect(script).toContain('mat.set("visible", true)');
  });
  it('converts null', () => {
    const script = genMaterialSetParamsScript('/root/Player', 0, { val: null });
    expect(script).toContain('mat.set_shader_parameter("val", null)');
    expect(script).toContain('mat.set("val", null)');
  });
  it('converts string (resource path) with load() for shader', () => {
    const script = genMaterialSetParamsScript('/root/Player', 0, { tex: 'res://icon.png' });
    expect(script).toContain('load("res://icon.png")');
    expect(script).toContain('"res://icon.png"');
  });
  it('converts plain string without load() for non-resource', () => {
    const script = genMaterialSetParamsScript('/root/Player', 0, { name: 'hello' });
    expect(script).toContain('"hello"');
    expect(script.includes('load("hello")')).toBeFalsy();
  });
  it('handles multiple params', () => {
    const script = genMaterialSetParamsScript('/root/Player', 0, { a: 1, b: [1, 0, 0, 1] });
    expect(script).toContain('set_shader_parameter("a"');
    expect(script).toContain('set_shader_parameter("b"');
  });
});

// ─── genMaterialSaveScript ────────────────────────────────────────────────

describe('genMaterialSaveScript', () => {
  it('contains ResourceSaver.save', () => {
    const script = genMaterialSaveScript('/root/Player', 0, 'res://materials/player.tres');
    expect(script).toContain('ResourceSaver.save');
  });
  it('contains DirAccess for auto-create directory', () => {
    const script = genMaterialSaveScript('/root/Player', 0, 'res://materials/player.tres');
    expect(script).toContain('make_dir_recursive');
  });
  it('contains error check for save failure', () => {
    const script = genMaterialSaveScript('/root/Player', 0, 'res://materials/player.tres');
    expect(script).toContain('Failed to save');
  });
});

// ─── genMaterialLoadScript ────────────────────────────────────────────────

describe('genMaterialLoadScript', () => {
  it('contains ResourceLoader.exists check', () => {
    const script = genMaterialLoadScript('/root/Player', 'res://materials/player.tres');
    expect(script).toContain('ResourceLoader.exists');
  });
  it('contains load call', () => {
    const script = genMaterialLoadScript('/root/Player', 'res://materials/player.tres');
    expect(script).toContain('load(');
  });
  it('sets material', () => {
    const script = genMaterialLoadScript('/root/Player', 'res://materials/player.tres');
    expect(script).toContain('material');
  });
  it('contains not found error for missing resource', () => {
    const script = genMaterialLoadScript('/root/Player', 'res://materials/missing.tres');
    expect(script).toContain('Material not found');
  });
});

// ─── genShaderReadScript ──────────────────────────────────────────────────

describe('genShaderReadScript', () => {
  it('contains shader code output', () => {
    const script = genShaderReadScript('/root/Player', 0);
    expect(script).toContain('shader_code');
    expect(script).toContain('mat.shader.code');
  });
  it('checks for ShaderMaterial type', () => {
    const script = genShaderReadScript('/root/Player', 0);
    expect(script).toContain('Not a ShaderMaterial');
  });
  it('checks for null shader', () => {
    const script = genShaderReadScript('/root/Player', 0);
    expect(script).toContain('No shader assigned');
  });
});

// ─── genShaderWriteScript ─────────────────────────────────────────────────

describe('genShaderWriteScript', () => {
  it('contains shader duplicate', () => {
    const script = genShaderWriteScript('/root/Player', 0, 'shader_type canvas_item;');
    expect(script).toContain('mat.shader.duplicate()');
  });
  it('contains compile result check', () => {
    const script = genShaderWriteScript('/root/Player', 0, 'shader_type canvas_item;');
    expect(script).toContain('compile_result');
    expect(script).toContain('compile_success');
  });
  it('embeds shader code', () => {
    const script = genShaderWriteScript('/root/Player', 0, 'shader_type canvas_item;');
    expect(script).toContain('shader_type canvas_item');
  });
  it('uses process_frame for compile wait', () => {
    const script = genShaderWriteScript('/root/Player', 0, 'shader_type canvas_item;');
    expect(script).toContain('process_frame');
    expect(script.includes('create_timer')).toBeFalsy();
  });
  it('includes errors and warnings arrays', () => {
    const script = genShaderWriteScript('/root/Player', 0, 'shader_type canvas_item;');
    expect(script).toContain('"errors"');
    expect(script).toContain('"warnings"');
  });
});

// ─── genShaderLoadFileScript ──────────────────────────────────────────────

describe('genShaderLoadFileScript', () => {
  it('contains ResourceLoader.exists check', () => {
    const script = genShaderLoadFileScript('/root/Player', 0, 'res://shaders/water.gdshader');
    expect(script).toContain('ResourceLoader.exists');
  });
  it('loads shader file', () => {
    const script = genShaderLoadFileScript('/root/Player', 0, 'res://shaders/water.gdshader');
    expect(script).toContain('mat.shader = load(');
  });
  it('contains file not found error', () => {
    const script = genShaderLoadFileScript('/root/Player', 0, 'res://shaders/missing.gdshader');
    expect(script).toContain('Shader file not found');
  });
});

// ─── genShaderSaveFileScript ──────────────────────────────────────────────

describe('genShaderSaveFileScript', () => {
  it('contains FileAccess.open', () => {
    const script = genShaderSaveFileScript('res://shaders/new.gdshader', 'shader_type canvas_item;');
    expect(script).toContain('FileAccess.open');
  });
  it('contains DirAccess for auto-create', () => {
    const script = genShaderSaveFileScript('res://shaders/new.gdshader', 'shader_type canvas_item;');
    expect(script).toContain('make_dir_recursive');
  });
  it('contains store_string', () => {
    const script = genShaderSaveFileScript('res://shaders/new.gdshader', 'shader_type canvas_item;');
    expect(script).toContain('store_string');
  });
});

// ─── genShaderApplyTemplateScript ─────────────────────────────────────────

describe('genShaderApplyTemplateScript', () => {
  it('applies dissolve template', () => {
    const script = genShaderApplyTemplateScript('/root/Player', 0, 'dissolve');
    expect(script).toContain('dissolve');
    expect(script).toContain('template_applied');
  });
  it('applies outline template', () => {
    const script = genShaderApplyTemplateScript('/root/Player', 0, 'outline');
    expect(script).toContain('outline');
  });
  it('applies water template with spatial shader', () => {
    const script = genShaderApplyTemplateScript('/root/Player', 0, 'water');
    expect(script).toContain('shader_type spatial');
  });
  it('throws for invalid template name', () => {
    expect(() => genShaderApplyTemplateScript('/root/Player', 0, 'nonexistent')).toThrow(/Invalid template/);
  });
  it('contains compile check with errors/warnings', () => {
    const script = genShaderApplyTemplateScript('/root/Player', 0, 'glow');
    expect(script).toContain('compile_success');
    expect(script).toContain('errors');
    expect(script).toContain('warnings');
  });
});

// ─── Template coverage ────────────────────────────────────────────────────

describe('all templates are valid', () => {
  const templateNames = ['dissolve', 'outline', 'blur', 'glow', 'water', 'gradient_map'];
  for (const name of templateNames) {
    it(`${name} template generates valid script`, () => {
      const script = genShaderApplyTemplateScript('/root/Node', 0, name);
      expect(script).toContain('_mcp_output');
      expect(script).toContain('_mcp_done');
    });
  }
});

// ─── handleTool integration tests ───────────────────────────────────────────

describe('handleTool routing', () => {
  it('returns null for unknown tool name', async () => {
    const result = await handleTool('unknown_tool', {}, { findGodot: async () => '/fake' });
    expect(result).toBe(null);
  });

  it('returns null for unrelated tool', async () => {
    const result = await handleTool('run_project', {}, { findGodot: async () => '/fake' });
    expect(result).toBe(null);
  });

  it('material_write rejects missing action', async () => {
    const result = await handleTool('material', {
      project_path: '/tmp/fake',
      node_path: '/root/Node',
      action: 'set_params',
    }, { findGodot: async () => '/fake' });
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error_code).toBeTruthy();
  });

  it('material_write rejects invalid material_type', async () => {
    const result = await handleTool('material', {
      project_path: '/tmp/fake',
      node_path: '/root/Node',
      action: 'create',
      material_type: 'InvalidType',
    }, { findGodot: async () => '/fake' });
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error_code).toBe('INVALID_MATERIAL_TYPE');
  });

  it('shader_edit list_templates works without project_path', async () => {
    const result = await handleTool('material', {
      action: 'shader_list_templates',
    }, { findGodot: async () => '/fake' });
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.data.templates.length >= 6).toBe(true);
  });

  it('shader_edit rejects missing code for write', async () => {
    const result = await handleTool('material', {
      project_path: '/tmp/fake',
      node_path: '/root/Node',
      action: 'shader_write',
    }, { findGodot: async () => '/fake' });
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error_code).toBe('SCRIPT_EXEC_FAILED');
  });

  it('material_write rejects non-res:// resource_path', async () => {
    const result = await handleTool('material', {
      project_path: '/tmp/fake',
      node_path: '/root/Node',
      action: 'save',
      resource_path: 'invalid/path.tres',
    }, { findGodot: async () => '/fake' });
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
  });

  it('material_read rejects empty node_path', async () => {
    const result = await handleTool('material', {
      project_path: '/tmp/fake',
      action: 'read',
      node_path: '',
    }, { findGodot: async () => '/fake' });
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
  });
});

// F-7: % 字符不再被 gdEscape 双写为 %%(改用 escapeForGdLiteral)
describe('F-7: percent preservation (escapeForGdLiteral)', () => {
  it('parseMaterialParam preserves % in string values', () => {
    const result = parseMaterialParam('100%');
    // 不应出现 %% 双写
    expect(result).not.toContain('%%');
    expect(result).toBe('"100%"');
  });

  it('genShaderSaveFileScript preserves % in shader code', () => {
    const script = genShaderSaveFileScript('/root/Player', 'shader_type canvas_item;\n// 50% opacity\nvoid fragment() { COLOR.a = 0.5; }');
    // store_string 的参数中 % 不应被双写
    expect(script).not.toContain('%%');
    expect(script).toContain('50% opacity');
  });

  it('genShaderWriteScript preserves % in shader code (JSON round-trip)', () => {
    const script = genShaderWriteScript('/root/Player', 0, '// usage: 30%\nshader_type canvas_item;');
    expect(script).not.toContain('%%');
  });
});
