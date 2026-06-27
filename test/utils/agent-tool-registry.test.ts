import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	TREESEED_AGENT_TOOL_DEFINITIONS,
	assertKnownAgentToolIds,
	listAgentToolIds,
} from '../../src/agent-tools.ts';
import { AGENT_OPERATION_NAMES } from '../../src/operations/agent-tools.ts';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workspaceRoot = resolve(packageRoot, '../..');

describe('agent tool registry', () => {
	it('declares unique dotted ids with schemas, requirements, and targets', () => {
		const ids = listAgentToolIds();
		expect(new Set(ids).size).toBe(ids.length);
		for (const definition of TREESEED_AGENT_TOOL_DEFINITIONS) {
			expect(definition.id).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/u);
			expect(definition.inputSchema).toMatchObject({ type: 'object' });
			expect(definition.outputSchema).toMatchObject({ type: 'object' });
			expect(definition.requirements.length).toBeGreaterThan(0);
			expect(['sdk_dispatch', 'treedx_proxy', 'treeseed_content', 'provider_runner']).toContain(definition.executionTarget);
			expect(['read', 'content_write', 'worktree_write', 'shared_state_write']).toContain(definition.mutability);
			if (definition.executionTarget === 'sdk_dispatch') {
				expect(definition.dispatch).toBeTruthy();
			}
		}
	});

	it('exposes generic and generated model-aware content tools', () => {
		const ids = listAgentToolIds();
		expect(ids).toContain('treeseed.content.create');
		expect(ids).toContain('treeseed.content.commit');
		expect(ids).toContain('treeseed.questions.create');
		expect(ids).toContain('treeseed.knowledge.create');
		expect(TREESEED_AGENT_TOOL_DEFINITIONS.find((definition) => definition.id === 'treeseed.questions.create')).toMatchObject({
			executionTarget: 'treeseed_content',
			content: { action: 'create', model: 'question' },
		});
	});

	it('validates bundled starter tool ids against the registry', () => {
		const roots = [
			resolve(workspaceRoot, 'starters/engineering/template/src/content/agents'),
			resolve(workspaceRoot, 'starters/research/template/src/content/agents'),
			resolve(workspaceRoot, 'starters/information-hub/template/src/content/agents'),
		];
		const ids: string[] = [];
		for (const root of roots) {
			if (!existsSync(root)) {
				continue;
			}
			const output = execFileSync('find', [root, '-name', '*.mdx'], { encoding: 'utf8' });
			for (const file of output.split('\n').filter(Boolean)) {
				const source = readFileSync(file, 'utf8');
				for (const match of source.matchAll(/^\s+-\s+([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)$/gmu)) {
					ids.push(match[1]);
				}
			}
		}
		const result = assertKnownAgentToolIds(ids);
		expect(result.unknown).toEqual([]);
	});

	it('does not expose a separate staging merge operation', () => {
		expect(AGENT_OPERATION_NAMES).not.toContain(['merge', 'to', 'staging'].join('_'));
	});
});
