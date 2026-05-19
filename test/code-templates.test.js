import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lintGDScript } from '../build/tools/gdscript-lint.js';
import { TEMPLATES, getTemplateSuggestion } from '../build/tools/code-templates.js';

describe('Code Templates', () => {
  const tests = [
    { id: 'T001', rules: ['L001'] }, { id: 'T002', rules: ['L002'] },
    { id: 'T003', rules: ['L013'] }, { id: 'T004', rules: ['L004', 'L005', 'L011'] },
    { id: 'T005', rules: ['L006'] }, { id: 'T006', rules: ['L014'] },
    { id: 'T007', rules: ['L012'] },
  ];
  for (const tt of tests) {
    it(`${tt.id}: generated code passes lint for related rules`, () => {
      const tpl = TEMPLATES.find(t => t.id === tt.id);
      assert.ok(tpl);
      const code = tpl.generate({});
      const result = lintGDScript(code, true);
      for (const ruleId of tt.rules) {
        const found = result.errors.find(e => e.rule === ruleId) || result.warnings.find(w => w.rule === ruleId);
        assert.ok(!found, `${tt.id} should not trigger ${ruleId}`);
      }
    });
  }
  it('getTemplateSuggestion returns suggestion for L002', () => {
    assert.ok(getTemplateSuggestion('L002')?.includes('PhysicsMaterial'));
  });
  it('getTemplateSuggestion returns null for unknown rule', () => {
    assert.equal(getTemplateSuggestion('L999'), null);
  });
});
