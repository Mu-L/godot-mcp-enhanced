import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

describe('C10/C11/C12 undo 完整性', () => {
	const animtree = readFileSync('addons/godot_mcp_server/commands/animtree_commands.gd', 'utf8');

	it('C10 add_state/add_transition/set_blend 含 create_action_mixed', () => {
		const addState = animtree.match(/func handle_animtree_add_state[\s\S]*?^func /m)?.[0] ?? '';
		const addTrans = animtree.match(/func handle_animtree_add_transition[\s\S]*?^func /m)?.[0] ?? '';
		const setBlend = animtree.match(/func handle_animtree_set_blend[\s\S]*?^func /m)?.[0] ?? '';
		expect(addState).toContain('create_action_mixed');
		expect(addTrans).toContain('create_action_mixed');
		expect(setBlend).toContain('create_action_mixed');
	});

	it('C10 add_state undo 调 remove_node；add_transition undo 调 remove_transition', () => {
		const addState = animtree.match(/func handle_animtree_add_state[\s\S]*?^func /m)?.[0] ?? '';
		const addTrans = animtree.match(/func handle_animtree_add_transition[\s\S]*?^func /m)?.[0] ?? '';
		expect(addState).toContain('remove_node');
		expect(addTrans).toContain('remove_transition');
	});

	const node = readFileSync('addons/godot_mcp_server/commands/node_commands.gd', 'utf8');

	it('C11 batch_add_nodes commit 有 try/catch + 孤儿清理（is_inside_tree + free）', () => {
		const batch = node.match(/func handle_batch_add_nodes[\s\S]*?^func /m)?.[0] ?? '';
		expect(batch).toMatch(/try:|catch/);
		expect(batch).toContain('is_inside_tree()');
		expect(batch).toContain('.free()');
	});

	it('C12 edit_node 跳过只读属性 undo（查 PROPERTY_USAGE_READ_ONLY）', () => {
		const edit = node.match(/func handle_edit_node[\s\S]*?^func /m)?.[0] ?? '';
		expect(edit).toContain('PROPERTY_USAGE_READ_ONLY');
	});

	it('C12 _get_property_usage helper 存在', () => {
		// helper 可在 node_commands 或 command_helpers
		const helperInNode = node.includes('_get_property_usage');
		const helpers = readFileSync('addons/godot_mcp_server/commands/command_helpers.gd', 'utf8');
		const helperInHelpers = helpers.includes('_get_property_usage');
		expect(helperInNode || helperInHelpers).toBe(true);
	});

	const scene = readFileSync('addons/godot_mcp_server/commands/scene_commands.gd', 'utf8');

	it('C12 set_instance_property 跳过只读属性 undo', () => {
		const fn = scene.match(/func handle_set_instance_property[\s\S]*?^func /m)?.[0] ?? '';
		expect(fn).toContain('PROPERTY_USAGE_READ_ONLY');
	});
});
