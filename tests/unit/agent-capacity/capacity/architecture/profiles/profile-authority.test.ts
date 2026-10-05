import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { describe, expect, it } from 'vitest';
import { validateAgentDefinitionModel } from '../../../../../../src/capacity/agents/agent-capacity.ts';
import { describeContentFrontmatterSchema } from '../../../../../../src/content/validation/index.ts';
import { exportSchemaConstraints } from '../../../../../../src/content/validation/schema-constraints.ts';
import { zodToJsonSchema } from 'zod-to-json-schema';

function profile() {
	return { schemaVersion: 'treeseed.agent/v1', id: 'configured/renamed-author', name: 'Renamed Author', agentClass: 'renamed-author',
		purpose: 'Complete the assigned objective without runtime role configuration.', responsibilities: ['Preserve exact assignment authority.'],
		capabilities: ['code-change'], context: { include: ['assignment-subject', 'predecessor-results'] },
		activityProfiles: { acting: { handler: 'project/compiled-handler', dependsOn: { agents: ['boundary-verifier'] },
			permissions: { content: { read: ['proposal', 'decision'], write: [] }, tools: ['source.read', 'source.write'] },
			prompt: { system: 'Complete only the bounded task using the exact governed context.', instructions: ['Return exact references.'] },
			additionalContext: ['assigned-source-scope'], parameters: { temperature: 0.25, purpose: 'controlled YAML input' } },
			chat: { handler: 'writer', permissions: { content: { read: ['discussion'], write: ['discussion'] }, tools: ['discussion'] },
				prompt: { system: 'Answer only the independent scoped discussion without scheduling work.' } } } };
}
function native(value: unknown) {
	const child = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./profile-boundary.ts', import.meta.url))],
		{ input: stringify(value), encoding: 'utf8' });
	if (child.error) throw child.error;
	expect(child.status, child.stderr).toBe(0);
	return JSON.parse(child.stdout);
}
describe('governed profile complete authority boundaries', () => {
	function classInputs() {
		const value = profile(), acting = value.activityProfiles.acting;
		return [{ valid: true, input: value }, { valid: true, input: { ...value, agentClass: 'a'.repeat(100) } },
			{ valid: true, input: { ...value, activityProfiles: { ...value.activityProfiles, acting: { ...acting, dependsOn: { agents: ['a'.repeat(100)] } } } } },
			...[' padded', 'padded ', 'a'.repeat(101), '', 'UPPER', 'a b'].flatMap(agentClass => [
				{ valid: false, input: { ...value, agentClass } },
				{ valid: false, input: { ...value, activityProfiles: { ...value.activityProfiles, acting: { ...acting, dependsOn: { agents: [agentClass] } } } } },
			])];
	}
	it('denies padded or overlong configured and dependency agent classes instead of silently normalizing governed identities', () => {
		const entries = classInputs(), held = structuredClone(entries);
		const outcomes = entries.map(entry => { const observed = validateAgentDefinitionModel(entry.input);
			if (entry.valid) expect(observed).toMatchObject({ ok: true, data: entry.input }); return observed.ok; });
		expect(outcomes).toEqual(entries.map(entry => entry.valid)); expect(entries).toEqual(held);
	});
	it('native governed YAML retains exact bounded configured class identities and refuses padded dependency selectors', () => {
		const entries = classInputs(), held = structuredClone(entries);
		const child = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./profile-boundary.ts', import.meta.url)), '--inventory'],
			{ input: stringify(entries.map(entry => entry.input)), encoding: 'utf8' });
		expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status, child.stderr).toBe(0);
		const result: unknown = JSON.parse(child.stdout);
		if (!result || typeof result !== 'object' || !('observations' in result) || !Array.isArray(result.observations)) throw new Error('Native class observations required.');
		expect(result.observations).toHaveLength(entries.length);
		for (const [index, entry] of entries.entries()) expect(result.observations[index]).toMatchObject(entry.valid ? { ok: true, data: entry.input } : { ok: false });
		expect(entries).toEqual(held);
	});
	it('exports the same nonempty configured capability context and activity inventories enforced by the owning profile validator', () => {
		const schema = zodToJsonSchema(describeContentFrontmatterSchema('agent'), { $refStrategy: 'none', postProcess: exportSchemaConstraints });
		expect(schema).toMatchObject({ properties: { capabilities: { minItems: 1, uniqueItems: true },
			context: { properties: { include: { minItems: 1, uniqueItems: true } } }, activityProfiles: { minProperties: 1 } },
			allOf: [{ if: { properties: { agentClass: { not: { const: 'reviewer' } } }, required: ['agentClass'] },
				then: { properties: { activityProfiles: { not: { required: ['reviewing'] } } } } }] });
		const input = profile(), original = structuredClone(input);
		for (const value of [{ ...input, capabilities: [] }, { ...input, context: { include: [] } },
			{ ...input, activityProfiles: {} }, { ...input, activityProfiles: { acting: undefined } }]) {
			const before = structuredClone(value); expect(validateAgentDefinitionModel(value).ok).toBe(false); expect(value).toEqual(before);
		}
		expect(validateAgentDefinitionModel(input)).toMatchObject({ ok: true, data: input }); expect(input).toEqual(original);
	});
	it('native public YAML profile validation and executable schema retain identical nonempty inventory bounds without adding runtime role configuration', () => {
		const input = profile(), values = [input, { ...input, capabilities: [] }, { ...input, context: { include: [] } }, { ...input, activityProfiles: {} }];
		values.push({ ...input, activityProfiles: { ...input.activityProfiles, reviewing: input.activityProfiles.acting } },
			{ ...input, agentClass: 'reviewer', activityProfiles: { ...input.activityProfiles, reviewing: input.activityProfiles.acting } });
		const before = structuredClone(values);
		const child = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./profile-boundary.ts', import.meta.url)), '--inventory'],
			{ input: stringify(values), encoding: 'utf8' });
		expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status, child.stderr).toBe(0);
		const observed: unknown = JSON.parse(child.stdout);
		expect(observed).toMatchObject({ schema: { properties: { capabilities: { minItems: 1, uniqueItems: true },
			context: { properties: { include: { minItems: 1, uniqueItems: true } } }, activityProfiles: { minProperties: 1 } },
			allOf: [{ if: { properties: { agentClass: { not: { const: 'reviewer' } } }, required: ['agentClass'] },
				then: { properties: { activityProfiles: { not: { required: ['reviewing'] } } } } }] },
			observations: [{ ok: true, data: input }, { ok: false }, { ok: false }, { ok: false }, { ok: false }, { ok: true, data: values[5] }] });
		expect(values).toEqual(before);
	});
	it('preserves arbitrary identities compiled handlers prompts parameters and independent chat without role dispatch', () => {
		const original = profile(), before = structuredClone(original), changed = structuredClone(original);
		changed.id = 'different/portable-author'; changed.name = 'Another Author'; changed.agentClass = 'portable-author';
		changed.activityProfiles.acting.parameters.temperature = 0.5; changed.activityProfiles.acting.prompt.system = 'Use this changed governed task prompt without changing provider dispatch.';
		expect(validateAgentDefinitionModel(original)).toMatchObject({ ok: true, data: original });
		expect(validateAgentDefinitionModel(changed)).toMatchObject({ ok: true, data: changed });
		expect(original).toEqual(before); expect(changed.activityProfiles.chat).not.toHaveProperty('dependsOn');
	});
	it('rejects every named provider scheduling workspace estimate and output concept at profile root', () => {
		const fields = ['provider', 'providerId', 'providerSelection', 'credentials', 'runtimeImage', 'runtimeBuild', 'nodeId', 'assignmentId',
			'estimate', 'workItems', 'paths', 'workspace', 'branch', 'outputs', 'outputTaxonomy', 'reviewer', 'reviewerMapping', 'collaborators'];
		const outcomes = fields.map(field => ({ field, result: validateAgentDefinitionModel({ ...profile(), [field]: { forbidden: true } }) }));
		for (const { field, result } of outcomes) { expect(result.ok, field).toBe(false); expect(result.diagnostics.length, field).toBeGreaterThan(0); }
	});
	it('rejects every removed handler compatibility path and permission-side authority field', () => {
		const input = profile(), activity = input.activityProfiles.acting;
		const activityFields = ['defaultHandler', 'overrideHandler', 'handlerVersion', 'handlerDigest', 'handlerDownload', 'runtimeSource',
			'enabled', 'execution', 'tools', 'outputs', 'branchPolicy', 'authorityPresets', 'reviewer', 'collaborators'];
		const permissionFields = ['allow', 'deny', 'commit', 'authorityPreset', 'rawTools', 'shellCommands', 'networkDomains', 'branchPolicy'];
		const outcomes = [
			...activityFields.map(field => ({ field, value: { ...input, activityProfiles: { acting: { ...activity, [field]: {} } } } })),
			...permissionFields.map(field => ({ field, value: { ...input, activityProfiles: { acting: { ...activity,
				permissions: { ...activity.permissions, [field]: {} } } } } })),
		].map(({ field, value }) => ({ field, result: validateAgentDefinitionModel(value) }));
		for (const { field, result } of outcomes) expect(result.ok, field).toBe(false);
	});
	it('denies missing empty malformed and duplicate profile inputs without silently creating permissions or dependencies', () => {
		const base = profile(), acting = base.activityProfiles.acting;
		const values: unknown[] = [null, {}, { ...base, id: '' }, { ...base, responsibilities: [] }, { ...base, capabilities: [] },
			{ ...base, context: { include: [] } }, { ...base, context: { include: ['assignment-subject', 'assignment-subject'] } },
			{ ...base, activityProfiles: {} }, { ...base, activityProfiles: { acting: { ...acting, handler: '' } } },
			{ ...base, activityProfiles: { acting: { ...acting, prompt: { system: 'short' } } } },
			{ ...base, activityProfiles: { acting: { ...acting, permissions: undefined } } },
			{ ...base, activityProfiles: { acting: { ...acting, dependsOn: { agents: ['boundary-verifier', 'boundary-verifier'] } } } },
			{ ...base, activityProfiles: { acting: { ...acting, dependsOn: { events: ['workday-ended'] } } } },
			{ ...base, activityProfiles: { acting: { ...acting, permissions: { ...acting.permissions, tools: ['source.read', 'source.read'] } } } },
			{ ...base, activityProfiles: { acting: { ...acting, permissions: { content: { read: ['architecture'], write: ['review'] }, tools: [] } } } },
		];
		expect(values.map(value => validateAgentDefinitionModel(value).ok)).toEqual(values.map(() => false));
	});
	it('rejects producer reviewing while retaining one independent reviewer class and exact lifecycle selector', () => {
		const input = profile(), reviewing = { ...input.activityProfiles.acting, handler: 'writer',
			permissions: { content: { read: ['decision'], write: ['note', 'question', 'decision'] }, tools: ['source.read', 'verification'] } };
		expect(validateAgentDefinitionModel({ ...input, activityProfiles: { reviewing } }).ok).toBe(false);
		expect(validateAgentDefinitionModel({ ...input, agentClass: 'reviewer', activityProfiles: { reviewing } }).ok).toBe(true);
		expect(validateAgentDefinitionModel({ ...input, activityProfiles: { reporting: { ...reviewing, dependsOn: { events: ['workday-closing'] } } } }).ok).toBe(true);
	});
	it('native public SDK YAML boundary retains changed governed inputs with no provider runtime configuration', () => {
		const input = profile(), original = structuredClone(input); expect(native(input)).toMatchObject({ ok: true, data: input });
		input.id = 'another/native-author'; input.agentClass = 'native-author'; input.activityProfiles.acting.handler = 'project/another-compiled-handler';
		expect(native(input)).toMatchObject({ ok: true, data: input }); expect(original).toEqual(profile());
	});
	it('native public SDK YAML boundary fails closed on malformed content permissions and prohibited scheduling authority', () => {
		const input = profile(), values = [{ ...input, credentials: { fake: 'isolated not-a-secret' } },
			{ ...input, activityProfiles: { acting: { ...input.activityProfiles.acting, permissions: { content: { read: ['review'], write: [] }, tools: [] } } } },
			{ ...input, activityProfiles: { acting: { ...input.activityProfiles.acting, handlerDownload: 'https://example.invalid/handler' } } }];
		expect(values.map(value => native(value).ok)).toEqual([false, false, false]);
	});
});
