import { describe,expect,it } from 'vitest';
import { allowedSafetyModesForActivity,compileAgentAuthoritySnapshot } from '../../../../src/agent-capacity/authority/agent-authority-presets.ts';
import type { AgentActivityProfile } from '../../../../src/types/agents.ts';

function profile(overrides: Partial<AgentActivityProfile> = {}): AgentActivityProfile {
	return {
		enabled: true,
		handler: 'actor',
		prompt: { system: 'Work only within authority.' },
		branchPolicy: { kind: 'read-only', base: 'main' },
		tools: { allowed: [] },
		outputs: { messageTypes: [], modelMutations: [] },
		permissions: {
			models: {},
			commit: { allowed: false },
			repository: { readPaths: ['src/**'], writePaths: [], allowCodeMutation: false },
			network: { allowedDomains: [] },
			shell: { allowedCommands: [] },
		},
		...overrides,
	};
}

describe('agent authority presets', () => {
	it('compiles preset provenance into one explicit tool snapshot', () => {
		const snapshot = compileAgentAuthoritySnapshot('chat', profile({
			authorityPresets: ['messaging'],
			tools: { allowed: ['treeseed.content.read'], denied: ['treeseed.discussion.follow'] },
		}));
		expect(snapshot.presetIds).toEqual(['messaging']);
		expect(snapshot.tools.allowed).toEqual(expect.arrayContaining([
			'treeseed.status', 'treeseed.assignment_plan', 'treeseed.discussion.read',
			'treeseed.discussion.respond', 'treeseed.discussion.request_handoff', 'treeseed.content.read',
		]));
		expect(snapshot.tools.allowed).not.toContain('treeseed.discussion.follow');
		expect(snapshot.permissions).toBeDefined();
	});

	it('keeps raw TreeDX mutation primitives internal when model-aware content tools are available', () => {
		const snapshot = compileAgentAuthoritySnapshot('planning', profile({
			tools: { allowed: ['treeseed.content.create', 'treeseed.content.commit', 'treedx.apply_workspace_changeset', 'treedx.commit_workspace'] },
		}));
		expect(snapshot.tools.allowed).toContain('treeseed.content.create');
		expect(snapshot.tools.allowed).toContain('treeseed.content.commit');
		expect(snapshot.tools.allowed).not.toContain('treedx.apply_workspace_changeset');
		expect(snapshot.tools.allowed).not.toContain('treedx.commit_workspace');
	});

	it('preserves the governed TreeDX branch while denying repository mutation outside acting', () => {
		const snapshot = compileAgentAuthoritySnapshot('planning', profile({
			branchPolicy: { kind: 'staging-content', base: 'staging' },
			permissions: {
				...profile().permissions!,
				repository: { readPaths: ['src/content/**'], writePaths: ['src/content/**'], allowCodeMutation: false },
			},
		}));
		expect(snapshot.branchPolicy).toEqual({ kind: 'staging-content', base: 'staging' });
		expect(snapshot.permissions?.repository).toMatchObject({ writePaths: [], allowCodeMutation: false });
		expect(snapshot.tools.allowed).not.toContain('treeseed.checkpoint');
	});

	it('keeps acting and reviewing authority disjoint', () => {
		const acting = compileAgentAuthoritySnapshot('acting', profile({
			permissions: {
				...profile().permissions!,
				repository: { readPaths: ['src/**'], writePaths: ['src/**'], allowCodeMutation: true },
			},
		}));
		const reviewing = compileAgentAuthoritySnapshot('reviewing', profile());
		expect(acting.diagnostics).toEqual([]);
		expect(acting.tools.allowed).toContain('treeseed.checkpoint');
		expect(reviewing.diagnostics).toEqual([]);
		expect(reviewing.tools.allowed).not.toContain('treeseed.checkpoint');
		expect(reviewing.tools.allowed).toContain('treeseed.changed_paths');
	});

	it('rejects widening and enforces the profile safety-mode matrix', () => {
		expect(compileAgentAuthoritySnapshot('reviewing', profile({
			permissions: {
				...profile().permissions!,
				repository: { readPaths: ['src/**'], writePaths: ['src/**'], allowCodeMutation: true },
			},
		})).diagnostics).toContain('reviewing cannot enable repository code mutation.');
		expect(allowedSafetyModesForActivity('acting')).toEqual(['acting']);
		expect(allowedSafetyModesForActivity('reviewing')).toEqual(['planning', 'acting']);
		for (const type of ['planning','estimating','chat','reporting'] as const) expect(allowedSafetyModesForActivity(type)).toEqual(['planning']);
	});
});
