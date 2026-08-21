import { describe, expect, it } from 'vitest';
import { compareTypeScriptApi, extractTypeScriptApi } from '../../../src/standards/typescript/index.ts';

function model(source: string) {
	return extractTypeScriptApi([{ specifier: '.', declarationPath: 'index.d.ts', source }]);
}

describe('TypeScript public API compatibility', () => {
	it('treats representation-only declaration changes as unchanged', () => {
		const baseline = model('export interface Client { readonly id: string; label?: string; }');
		const candidate = model('export interface Client {\n  readonly id: string\n  label?: string\n}');
		expect(compareTypeScriptApi(baseline, candidate)).toEqual({ classification: 'unchanged', findings: [] });
	});

	it('classifies additive exports and optional members as compatible additions', () => {
		const baseline = model('export interface Client { id: string; }');
		const candidate = model('export interface Client { id: string; label?: string; }\nexport type ClientId = string;');
		const comparison = compareTypeScriptApi(baseline, candidate);
		expect(comparison.classification).toBe('compatible_addition');
		expect(comparison.findings.map((entry) => entry.code)).toEqual(['typescript_member_added', 'typescript_symbol_added']);
	});

	it('classifies removals, required members, narrowed parameters, and widened returns as breaking', () => {
		const baseline = model('export interface Client { id: string; label?: string; }\nexport function load(value: string | number): string;');
		const candidate = model('export interface Client { id: string; required: boolean; }\nexport function load(value: string): string | null;');
		const comparison = compareTypeScriptApi(baseline, candidate);
		expect(comparison.classification).toBe('breaking');
		expect(comparison.findings.map((entry) => entry.code)).toEqual(expect.arrayContaining([
			'typescript_member_removed', 'typescript_member_added', 'typescript_parameter_changed', 'typescript_symbol_type_changed',
		]));
	});

	it('observes only declarations supplied by declared package entrypoints', () => {
		const extracted = extractTypeScriptApi([{ specifier: './public', declarationPath: 'public.d.ts', source: 'export type Public = string;' }]);
		expect(extracted.entrypoints.map((entry) => entry.specifier)).toEqual(['./public']);
		expect(extracted.entrypoints[0]?.symbols.map((entry) => entry.name)).toEqual(['Public']);
	});

	it('follows local declaration barrels and detects changes behind the public entrypoint', () => {
		const entrypoint = [{ specifier: '.', declarationPath: 'dist/index.d.ts', source: "export * from './public.js';" }];
		const baseline = extractTypeScriptApi(entrypoint, {
			'dist/index.d.ts': entrypoint[0]!.source,
			'dist/public.d.ts': 'export interface Client { id: string; label?: string; }',
		});
		const candidate = extractTypeScriptApi(entrypoint, {
			'dist/index.d.ts': entrypoint[0]!.source,
			'dist/public.d.ts': 'export interface Client { id: string; }',
		});
		expect(baseline.entrypoints[0]?.symbols.map((entry) => entry.name)).toEqual(['Client']);
		expect(compareTypeScriptApi(baseline, candidate).findings).toEqual(expect.arrayContaining([
			expect.objectContaining({ code: 'typescript_member_removed', path: '.Client.label' }),
		]));
	});

	it('fails closed when a public local declaration barrel cannot be resolved', () => {
		expect(() => extractTypeScriptApi([{
			specifier: '.', declarationPath: 'dist/index.d.ts', source: "export * from './missing.js';",
		}])).toThrow('Unresolved local public declaration: dist/missing.d.ts.');
	});
});
