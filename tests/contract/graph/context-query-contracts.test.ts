import { describe, expect, it } from 'vitest';
import {
	compileDeclarativeContextQuery,
	declarativeContextFormatToGraphView,
	declarativeContextPurposeToGraphStage,
} from '../../../src/graph/context-query-contracts.ts';

describe('declarative context query contracts', () => {
	it('compiles frontmatter-shaped context metadata into a context pack request', () => {
		const result = compileDeclarativeContextQuery({
			id: 'runtime-architecture',
			purpose: 'research',
			query: 'agent runtime manager worker AgentKernel providers workday',
			scope: '/knowledge',
			relations: ['related', 'references'],
			depth: 2,
			budget: 8000,
			format: 'full',
		});

		expect(result.ok).toBe(true);
		expect(result.errors).toEqual([]);
		expect(result.compiled?.request).toMatchObject({
			query: 'agent runtime manager worker AgentKernel providers workday',
			stage: 'research',
			scopePaths: ['/knowledge'],
			relations: ['related', 'references'],
			view: 'full',
			options: {
				depth: 2,
				limit: 8,
				maxNodes: 8,
			},
			budget: {
				maxTokens: 8000,
			},
		});
	});

	it('maps only supported graph stages and preserves unsupported purposes as warnings', () => {
		expect(declarativeContextPurposeToGraphStage('implement')).toBe('implement');
		expect(declarativeContextPurposeToGraphStage('optimize')).toBe('plan');

		const result = compileDeclarativeContextQuery({
			id: 'draft-fit',
			purpose: 'optimize',
			query: 'generated knowledge review',
		});

		expect(result.ok).toBe(true);
		expect(result.compiled?.query.purpose).toBe('optimize');
		expect(result.compiled?.request.stage).toBe('plan');
		expect(result.warnings.join('\n')).toContain('using "plan"');
	});

	it('maps declarative formats onto graph views', () => {
		expect(declarativeContextFormatToGraphView('summary')).toBe('brief');
		expect(declarativeContextFormatToGraphView('sources')).toBe('list');
		expect(declarativeContextFormatToGraphView('full')).toBe('full');
		expect(declarativeContextFormatToGraphView('map')).toBe('map');

		const result = compileDeclarativeContextQuery({
			id: 'source-map',
			purpose: 'review',
			query: 'source refs',
			format: 'sources',
		});

		expect(result.compiled?.request.view).toBe('list');
	});

	it('rejects invalid relations, scope, depth, and budget', () => {
		const result = compileDeclarativeContextQuery({
			id: 'bad-query',
			purpose: 'research',
			query: 'runtime',
			scope: 'knowledge',
			relations: ['related', 'unknown'],
			depth: 4,
			budget: 0,
		});

		expect(result.ok).toBe(false);
		expect(result.errors).toEqual(expect.arrayContaining([
			expect.stringContaining('depth'),
			expect.stringContaining('budget'),
			expect.stringContaining('scope'),
			expect.stringContaining('invalid relations'),
		]));
	});

	it('deduplicates relations and reports a warning', () => {
		const result = compileDeclarativeContextQuery({
			id: 'dedupe',
			purpose: 'research',
			query: 'runtime',
			relations: ['related', 'references', 'related'],
		});

		expect(result.ok).toBe(true);
		expect(result.compiled?.request.relations).toEqual(['related', 'references']);
		expect(result.warnings.join('\n')).toContain('duplicate relations');
	});

	it('preserves normalized code scopes for scanner-backed context packs', () => {
		const result = compileDeclarativeContextQuery({
			id: 'runtime-code',
			purpose: 'research',
			query: 'agent runtime worker',
			scope: '/knowledge',
			codeScopes: [' packages/agent/src/services ', 'packages/agent/src/services', 'flow:agent runtime'],
		});

		expect(result.ok).toBe(true);
		expect(result.compiled?.query.codeScopes).toEqual(['packages/agent/src/services', 'flow:agent runtime']);
		expect(result.compiled?.request.scopePaths).toEqual(['/knowledge']);
	});

	it('rejects malformed code scopes', () => {
		const result = compileDeclarativeContextQuery({
			id: 'bad-code-scopes',
			purpose: 'research',
			query: 'agent runtime worker',
			codeScopes: [],
		});

		expect(result.ok).toBe(false);
		expect(result.errors).toEqual(expect.arrayContaining([
			expect.stringContaining('codeScopes'),
		]));
	});
});
