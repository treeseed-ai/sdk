import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_AGENT_EXECUTION_PROVIDER_IDS } from '../../../src/types/agents.ts';

const packageRoot = process.cwd();
const roots = [resolve(packageRoot, 'src/agent-capacity'), resolve(packageRoot, 'src/capacity-provider')];
const rootModules = [resolve(packageRoot, 'src/capacity/agents/agent-capacity.ts'), resolve(packageRoot, 'src/capacity/providers/capacity-provider.ts')];
const suppression = /@ts-(?:nocheck|ignore|expect-error)|eslint-disable|biome-ignore/gu;
const forbiddenImport = /from\s+['"]@treeseed\/(?:admin|agent|api|cli|core|ui)(?:\/[^'"]*)?['"]/gu;

function sourceFiles(root: string): string[] {
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(root, entry.name);
		return entry.isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
	});
}

describe('portable agent-capacity static architecture', () => {
	it('keeps canonical modules focused, unsuppressed, and inside the SDK boundary', () => {
		const failures: Array<{ file: string; issue: string }> = [];
		for (const path of [...roots.flatMap(sourceFiles), ...rootModules]) {
			const source = readFileSync(path, 'utf8');
			const file = relative(packageRoot, path);
			const lines = source.split(/\r?\n/u).length;
			if (lines > 500) failures.push({ file, issue: `${lines} lines exceeds 500` });
			if (suppression.test(source)) failures.push({ file, issue: 'compiler or lint suppression' });
			suppression.lastIndex = 0;
			if (forbiddenImport.test(source)) failures.push({ file, issue: 'forbidden package-boundary import' });
			forbiddenImport.lastIndex = 0;
		}
		expect(failures).toEqual([]);
	});

	it('advertises only canonical execution providers and built-in handlers', () => {
		const source = readFileSync(resolve(packageRoot, 'src/entrypoints/models/plugin-default.ts'), 'utf8');
		expect(BUILT_IN_AGENT_EXECUTION_PROVIDER_IDS).toEqual(['codex', 'copilot', 'jira', 'github_issues', 'discord', 'workflow']);
		expect(source).toContain('execution: [...BUILT_IN_AGENT_EXECUTION_PROVIDER_IDS]');
		for (const handler of ['writer', 'actor', 'estimate', 'releaser', 'reporter']) {
			expect(source).toContain(`'${handler}'`);
		}
		for (const removed of ['jira_issue_queue', 'human_issue_queue', 'github_issue_queue', 'issue_queue', 'discord_thread', 'workflow_operation', 'deterministic_workflow', 'github_actions_workflow']) {
			expect(source).not.toContain(`'${removed}'`);
		}
		for (const removedHandler of ['plan', 'research', 'act', 'review', 'report']) {
			expect(source).not.toContain(`'${removedHandler}'`);
		}
	});
});
