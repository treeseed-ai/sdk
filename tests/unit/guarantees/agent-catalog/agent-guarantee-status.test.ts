import { mkdirSync,mkdtempSync,readFileSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe,expect,it } from 'vitest';
import { createAgentGuaranteeCatalogStatus } from '../../../../src/guarantees/contracts/agent-guarantee-status.ts';
import { guaranteeSourceClosure,guaranteeSourceGeneration } from '../../../../src/guarantees/features/guarantee-source-closure.ts';

function workspace() {
	const root = mkdtempSync(resolve(tmpdir(), 'agent-guarantee-status-'));
	mkdirSync(resolve(root, 'guarantees/agent/profile'), { recursive: true });
	writeFileSync(resolve(root, 'package.json'), JSON.stringify({ name: '@treeseed/market' }));
	writeFileSync(resolve(root, 'treeseed.site.yaml'), 'id: test\n');
	writeFileSync(resolve(root, 'guarantees/agent/profile/planning.guarantee.yaml'), `schemaVersion: treeseed.guarantee/v2
id: guarantee.agent.profile.planning-outcome.901
journeyIndex: 901
type: agent
subtype: profile
journey: Planning outcome
ownerPackage: "@treeseed/market"
summary: Planning produces the exact governed artifact.
status: planned
capabilityId: agent.profile.planning-outcome
catalog: agent.system
activation:
  minimumConsecutivePasses: 3
  requiredVariants: [baseline, clean-repeat, interruption-resume]
  invalidateOnSourceChange: true
proof:
  requiredCommands: [capacity.assignment]
  minimumRepositoryPostconditions: 0
  outcomePredicates:
    planning.exact-artifact: [planning.exact-artifact]
outcomes:
  - id: planning.exact-artifact
    kind: required
    description: The exact artifact is read back.
    evidenceKinds: [content_read_back]
    authoritativeSubjects: [artifactRef]
dependencies: { journeys: [], guarantees: [] }
actors: { allowed: [operator], forbidden: [] }
devices: { required: [] }
gates: [core]
preconditions: { fixtures: [], notes: [] }
api: { required: false, verifierRefs: [] }
content: { required: false, verifierRefs: [] }
audit: { required: false, verifierRefs: [] }
negativeCases: []
evidence: { required: [verifier_evidence] }
`);
	return root;
}

function record(root: string, index: number, variant: string, status: 'passed' | 'failed', artifactRef = 'note@abc') {
	const closure = guaranteeSourceClosure(root);
	const generation = guaranteeSourceGeneration(closure);
	const runId = `run-${index}`;
	const output = resolve(root, '.treeseed/guarantees/runs', runId);
	mkdirSync(output, { recursive: true });
	const evidencePath = `.treeseed/guarantees/runs/${runId}/verifier.json`;
	writeFileSync(resolve(root, evidencePath), JSON.stringify({
		stdout: JSON.stringify({
			schemaVersion: 'treeseed.guarantee-verifier-result/v1',
			guaranteeId: 'guarantee.agent.profile.planning-outcome.901',
			capabilityId: 'agent.profile.planning-outcome',
			variant,
			sourceGeneration: generation,
			assertions: [{
				id: 'planning.exact-artifact',
				status,
				evidence: ['artifact.json'],
				entityRefs: { artifactRef },
			}],
			repositoryPostconditions: [],
			cleanup: { verified: true, activeAssignments: 0, activeLeases: 0, activeReservations: 0, activeDemands: 0, activeWorkspaces: 0, activeWorktrees: 0, unpublishedBranches: 0, staleAuthorities: 0 },
			evidence: ['artifact.json'],
		}),
	}));
	writeFileSync(resolve(output, 'report.json'), JSON.stringify({
		completedAt: `2026-08-13T00:00:0${index}.000Z`,
		sourceClosure: { started: closure, completed: closure, matches: true },
		results: [{
			id: 'guarantee.agent.profile.planning-outcome.901',
			status,
			completedAt: `2026-08-13T00:00:0${index}.000Z`,
			evidence: [evidencePath],
		}],
	}));
}

describe('agent guarantee catalog status', () => {
	it('activates only after the same-generation three-variant streak', () => {
		const root = workspace();
		record(root, 1, 'baseline', 'passed');
		record(root, 2, 'clean-repeat', 'passed');
		expect(createAgentGuaranteeCatalogStatus({ workspaceRoot: root }).entries[0]).toMatchObject({
			state: 'passing', passingStreak: 2, missingVariants: ['interruption-resume'],
		});
		record(root, 3, 'interruption-resume', 'passed');
		expect(createAgentGuaranteeCatalogStatus({ workspaceRoot: root }).entries[0]).toMatchObject({
			state: 'active', passingStreak: 3, missingVariants: [],
		});
	});

	it('resets a streak on failure and reports the exact failed assertion', () => {
		const root = workspace();
		record(root, 1, 'baseline', 'passed');
		record(root, 2, 'clean-repeat', 'failed');
		expect(createAgentGuaranteeCatalogStatus({ workspaceRoot: root }).entries[0]).toMatchObject({
			state: 'broken', passingStreak: 0, failedAssertions: ['planning.exact-artifact'],
		});
	});

	it('invalidates evidence after any source-closure generation change', () => {
		const root = workspace();
		mkdirSync(resolve(root, 'scripts/guarantees'), { recursive: true });
		writeFileSync(resolve(root, 'scripts/guarantees/verify.ts'), 'export const generation = 1;\n');
		record(root, 1, 'baseline', 'passed');
		writeFileSync(resolve(root, 'scripts/guarantees/verify.ts'), 'export const generation = 2;\n');
		expect(createAgentGuaranteeCatalogStatus({ workspaceRoot: root }).entries[0]).toMatchObject({
			state: 'blocked', passingStreak: 0,
		});
	});

	it('requires configured cross-variant entity identities to be distinct', () => {
		const root = workspace();
		const manifest = resolve(root, 'guarantees/agent/profile/planning.guarantee.yaml');
		writeFileSync(manifest, readFileSync(manifest, 'utf8').replace('  invalidateOnSourceChange: true', '  invalidateOnSourceChange: true\n  distinctEntityRefs:\n    - subject: artifactRef\n      variants: [baseline, interruption-resume]'));
		record(root, 1, 'baseline', 'passed', 'artifact@one');
		record(root, 2, 'clean-repeat', 'passed', 'artifact@clean');
		record(root, 3, 'interruption-resume', 'passed', 'artifact@one');
		expect(createAgentGuaranteeCatalogStatus({ workspaceRoot: root }).entries[0]).toMatchObject({state:'passing',activationIssues:[expect.stringContaining('must be present and distinct')]});
		record(root, 4, 'interruption-resume', 'passed', 'artifact@two');
		expect(createAgentGuaranteeCatalogStatus({ workspaceRoot: root }).entries[0]).toMatchObject({state:'active',activationIssues:[]});
	});
});
