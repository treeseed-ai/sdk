import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { verifyAgentContentSchema } from '../../../../src/platform/agent-schema-verification.ts';
import { assertCanonicalAuthorityUnchanged, canonicalAuthority, constraintPaths,
	removeConstraint, schemaRecord, storedDefinitions, type CanonicalSchema } from './canonical-schema-fixture.ts';

afterAll(assertCanonicalAuthorityUnchanged);
const verify = (document: CanonicalSchema) => verifyAgentContentSchema(document);
function mutationDetected(document: CanonicalSchema, change: (copy: CanonicalSchema) => void) {
	const copy = structuredClone(document);
	change(copy);
	const before = JSON.stringify(copy);
	const diagnostics = verify(copy);
	expect(JSON.stringify(copy)).toBe(before);
	return diagnostics.length > 0 && JSON.stringify(diagnostics) !== JSON.stringify(verify(document));
}

describe('exact canonical architecture schema equivalence', () => {
	it('CI binds complete canonical execution verification to one exact Platform checkout before the original suites and coded scenes', () => {
		const workflow = parse(readFileSync('.github/workflows/verify.yml', 'utf8')) as { jobs: { verify: {
			env: Record<string, string>; steps: Array<{ name?: string; uses?: string; run?: string; with?: Record<string, unknown> }>;
		} } };
		const job = workflow.jobs.verify, bound = job.steps.filter(step => step.with?.repository === 'treeseed-ai/platform');
		expect(bound).toHaveLength(1); const checkout = bound[0]!;
		expect(checkout.uses).toMatch(/^actions\/checkout@[a-f0-9]{40}$/u);
		expect(checkout.with).toEqual({ repository: 'treeseed-ai/platform', ref: canonicalAuthority().commit,
			path: '.treeseed/platform-authority', 'persist-credentials': false });
		expect(job.env.TREESEED_DEVELOPMENT_WORKSPACE_ROOT).toBe('${{ github.workspace }}/.treeseed/platform-authority');
		const index = job.steps.indexOf(checkout);
		for (const name of ['Verify package', 'Execute coded golden component scenes']) expect(job.steps.findIndex(step => step.name === name)).toBeGreaterThan(index);
		expect(job.steps.find(step => step.name === 'Verify package')?.run).toBe('npm run verify:direct');
	});
	it('accepts the exact complete canonical target without modifying its stored or runtime definitions', () => {
		const { document } = canonicalAuthority();
		const before = JSON.stringify(document);
		const diagnostics = verify(document);
		expect(JSON.stringify(document)).toBe(before);
		expect(diagnostics).toEqual([]);
	});
	it('detects deletion and unconstrained replacement of every canonical stored record', () => {
		const { document } = canonicalAuthority();
		const missed: string[] = [];
		for (const name of storedDefinitions(document)) {
			for (const operation of ['delete', 'unconstrained'] as const) {
				if (!mutationDetected(document, copy => {
					if (operation === 'delete') delete copy.$defs[name];
					else copy.$defs[name] = true;
				})) missed.push(`${name}:${operation}`);
			}
		}
		expect(missed).toEqual([]);
	});
	it('detects deletion and unconstrained replacement of every canonical runtime and shared definition', () => {
		const { document } = canonicalAuthority();
		const stored = new Set(storedDefinitions(document));
		const missed: string[] = [];
		for (const name of Object.keys(document.$defs).filter(name => !stored.has(name))) {
			for (const operation of ['delete', 'unconstrained'] as const) {
				if (!mutationDetected(document, copy => {
					if (operation === 'delete') delete copy.$defs[name];
					else copy.$defs[name] = true;
				})) missed.push(`${name}:${operation}`);
			}
		}
		expect(missed).toEqual([]);
	});
	it('detects omitted duplicated and runtime-only members of the canonical stored-record union', () => {
		const { document } = canonicalAuthority();
		const missed: string[] = [];
		for (const name of storedDefinitions(document)) {
			if (!mutationDetected(document, copy => { copy.oneOf = copy.oneOf.filter(entry => entry.$ref !== `#/$defs/${name}`); })) missed.push(`omitted:${name}`);
		}
		if (!mutationDetected(document, copy => { copy.oneOf.push(structuredClone(copy.oneOf[0]!)); })) missed.push('duplicate');
		if (!mutationDetected(document, copy => { copy.oneOf.push({ $ref: '#/$defs/AssignmentContext' }); })) missed.push('runtime-only');
		expect(missed).toEqual([]);
	});
	it('detects field removal required-field removal and open-record drift across every canonical object', () => {
		const { document } = canonicalAuthority();
		const missed: string[] = [];
		for (const [name, definition] of Object.entries(document.$defs)) {
			if (typeof definition === 'boolean' || !definition.properties) continue;
			for (const field of Object.keys(schemaRecord(definition.properties))) {
				if (!mutationDetected(document, copy => { delete schemaRecord(schemaRecord(copy.$defs[name]).properties)[field]; })) missed.push(`${name}.properties.${field}`);
			}
			for (const field of (definition.required ?? []) as string[]) {
				if (!mutationDetected(document, copy => {
					const target = schemaRecord(copy.$defs[name]);
					target.required = (target.required as string[]).filter(value => value !== field);
				})) missed.push(`${name}.required.${field}`);
			}
			if (definition.additionalProperties === false && !mutationDetected(document, copy => {
				schemaRecord(copy.$defs[name]).additionalProperties = true;
			})) missed.push(`${name}.additionalProperties`);
		}
		expect(missed).toEqual([]);
	});
	it('detects removed reference bounds uniqueness union and conditional assertions throughout the canonical target', () => {
		const { document } = canonicalAuthority();
		const missed: string[] = [];
		for (const [name, definition] of Object.entries(document.$defs)) {
			for (const path of constraintPaths(definition)) {
				if (!mutationDetected(document, copy => removeConstraint(copy, name, path))) {
					missed.push(`${name}.${path.join('.')}`);
				}
			}
		}
		expect(missed).toEqual([]);
	});
});
