import { describe, expect, it } from 'vitest';
import { compareTypeScriptApi, type TypeScriptApiModel } from '../../../src/standards/typescript/index.ts';

function model(definition: string, members: Array<{ name: string; type: string; optional: boolean }> = []): TypeScriptApiModel {
	return {
		schemaVersion: 1,
		entrypoints: [{ specifier: './operator-contracts', declarationPath: 'dist/operator-contracts/index.d.ts', symbols: [{ name: 'WorkdayAllocationProfile', kind: 'interface', definition, deprecated: false, heritage: [], members: members.map((member) => ({ ...member, readonly: false, deprecated: false })), parameters: [], returnType: null, signatures: [] }] }],
	};
}

describe('operator contract semantic compatibility', () => {
	it('classifies a command or contract removal as breaking', () => {
		const baseline = model('interface WorkdayAllocationProfile', [{ name: 'actingDecisionRequired', type: 'true', optional: false }]);
		const candidate = model('interface WorkdayAllocationProfile');
		expect(compareTypeScriptApi(baseline, candidate)).toMatchObject({ classification: 'breaking', findings: [expect.objectContaining({ code: 'typescript_member_removed' })] });
	});

	it('classifies optional allocation metadata as additive and required workday fields as breaking', () => {
		const baseline = model('interface WorkdayAllocationProfile');
		const optional = model('interface WorkdayAllocationProfile', [{ name: 'description', type: 'string', optional: true }]);
		const required = model('interface WorkdayAllocationProfile', [{ name: 'profileDigest', type: 'string', optional: false }]);
		expect(compareTypeScriptApi(baseline, optional).classification).toBe('compatible_addition');
		expect(compareTypeScriptApi(baseline, required).classification).toBe('breaking');
	});
});
