import { describe, expect, it } from 'vitest';
import { advanceResearchWorkflow, compileResearchWorkflow, RESEARCH_WORKFLOW_STAGES } from '../../src/agent-capacity.ts';

const citation = (id: string, publisher: string) => ({
	sourceUrl: `https://${publisher}/source/${id}`, title: `Source ${id}`, publisher,
	retrievedAt: '2026-07-18T00:00:00.000Z', contentHash: `sha256:${id.padEnd(64, '0')}`,
	claimIds: ['claim-1'], confidence: 'high' as const,
});

describe('durable research workflow policy', () => {
	it('compiles the canonical eleven-stage four-role workflow', () => {
		const workflow = compileResearchWorkflow({ id: 'research-1', teamId: 'team-1', projectId: 'project-1', objectiveRef: 'objective:1', questionRef: 'question:1' });
		expect(workflow.nodes.map((node) => node.stage)).toEqual(RESEARCH_WORKFLOW_STAGES);
		expect(new Set(workflow.nodes.map((node) => node.role))).toEqual(new Set(['researcher', 'reviewer', 'technical-writer', 'reporter']));
		expect(workflow.nodes[0]?.status).toBe('ready');
		expect(workflow.maxRevisionCycles).toBe(3);
		expect(() => compileResearchWorkflow({ id: 'invalid', teamId: 'team-1', projectId: 'project-1', objectiveRef: 'objective:1', questionRef: 'question:1', maxRevisionCycles: 0 })).toThrow('research_workflow_revision_limit_invalid');
	});

	it('requires independent sources, rejection, revision, publication, and report in order', () => {
		let workflow = compileResearchWorkflow({ id: 'research-1', teamId: 'team-1', projectId: 'project-1', objectiveRef: 'objective:1', questionRef: 'question:1', now: '2026-07-18T00:00:00.000Z' });
		const complete = (stage: (typeof RESEARCH_WORKFLOW_STAGES)[number], extra: Record<string, unknown> = {}) => {
			workflow = advanceResearchWorkflow(workflow, { expectedStateVersion: workflow.stateVersion, stage, assignmentId: `assignment:${stage}`, artifactRefs: [`artifact:${stage}`], ...extra }, `2026-07-18T00:00:${String(workflow.stateVersion).padStart(2, '0')}.000Z`);
		};
		complete('question-decomposition');
		complete('source-selection-criteria');
		complete('governed-source-search');
		expect(() => complete('independent-source-fetch', { citations: [citation('1', 'one.test')] })).toThrow(/independent_sources_required/u);
		expect(() => complete('independent-source-fetch', { citations: [citation('1', 'one.test'), { ...citation('2', 'one.test'), publisher: 'spoofed-two.test' }] })).toThrow(/independent_sources_required/u);
		complete('independent-source-fetch', { citations: [citation('1', 'one.test'), citation('2', 'two.test')] });
		complete('linked-evidence-notes', { artifactRefs: ['note:one', 'note:two'] });
		const unsupported = [{ id: 'claim-1', text: 'Material claim', material: true, status: 'unsupported' as const, citationIds: [] }];
		complete('claim-synthesis', { claims: unsupported });
		expect(() => complete('citation-review-rejection', { reviewOutcome: 'approved' })).toThrow(/review_rejection_required/u);
		complete('citation-review-rejection', { reviewOutcome: 'rejected', reviewReason: 'Claim lacks support.' });
		expect(() => complete('revision', { claims: unsupported })).toThrow(/revision_incomplete/u);
		complete('revision', { claims: [{ ...unsupported[0]!, status: 'supported', citationIds: ['source-1', 'source-2'] }] });
		expect(() => complete('citation-review-approval', { reviewOutcome: 'rejected' })).toThrow(/review_rejection_reason_required/u);
		complete('citation-review-approval', { reviewOutcome: 'approved' });
		complete('cited-knowledge-publication', { publicationRef: 'knowledge:final' });
		complete('workday-report', { reportRef: 'note:report' });
		expect(workflow).toMatchObject({ status: 'completed', stateVersion: 12, reviewerRejectedUnsupportedClaims: true, reviewerApprovedRevision: true, revisionCount: 1, publicationRef: 'knowledge:final', reportRef: 'note:report' });
		expect(workflow.citations).toHaveLength(2);
	});

	it('reopens revision when post-revision review rejects and preserves review-attempt evidence', () => {
		let workflow = compileResearchWorkflow({ id: 'research-loop', teamId: 'team-1', projectId: 'project-1', objectiveRef: 'objective:1', questionRef: 'question:1', now: '2026-07-18T00:00:00.000Z' });
		const complete = (stage: (typeof RESEARCH_WORKFLOW_STAGES)[number], extra: Record<string, unknown> = {}) => {
			workflow = advanceResearchWorkflow(workflow, { expectedStateVersion: workflow.stateVersion, stage, assignmentId: `assignment:${stage}:${workflow.stateVersion}`, artifactRefs: [`artifact:${stage}`], ...extra }, `2026-07-18T00:00:${String(workflow.stateVersion).padStart(2, '0')}.000Z`);
		};
		complete('question-decomposition'); complete('source-selection-criteria'); complete('governed-source-search');
		complete('independent-source-fetch', { citations: [citation('1', 'one.test'), citation('2', 'two.test')] });
		complete('linked-evidence-notes', { artifactRefs: ['note:one', 'note:two'] });
		complete('claim-synthesis', { claims: [{ id: 'claim-1', text: 'Unsupported', material: true, status: 'unsupported', citationIds: [] }] });
		complete('citation-review-rejection', { reviewOutcome: 'rejected', reviewReason: 'Missing support.' });
		complete('revision', { claims: [{ id: 'claim-1', text: 'First revision', material: true, status: 'supported', citationIds: ['source-1', 'source-2'] }] });
		complete('citation-review-approval', { reviewOutcome: 'rejected', reviewReason: 'The cited evidence still does not substantiate the wording.' });
		expect(workflow.nodes.find((node) => node.stage === 'revision')).toMatchObject({ status: 'ready', assignmentId: null, artifactRefs: [] });
		expect(workflow.nodes.find((node) => node.stage === 'citation-review-approval')).toMatchObject({ status: 'pending', assignmentId: null, artifactRefs: [] });
		expect(workflow).toMatchObject({ status: 'running', stateVersion: 10, reviewerApprovedRevision: false, revisionCount: 1 });
		expect(workflow.metadata?.reviewAttempts).toEqual([
			expect.objectContaining({ stage: 'citation-review-rejection', outcome: 'rejected' }),
			expect.objectContaining({ stage: 'citation-review-approval', outcome: 'rejected' }),
		]);
		complete('revision', { claims: [{ id: 'claim-1', text: 'Evidence-bounded second revision', material: true, status: 'supported', citationIds: ['source-1', 'source-2'] }] });
		complete('citation-review-approval', { reviewOutcome: 'approved' });
		complete('cited-knowledge-publication', { publicationRef: 'knowledge:final' });
		complete('workday-report', { reportRef: 'note:report' });
		expect(workflow).toMatchObject({ status: 'completed', stateVersion: 14, reviewerApprovedRevision: true, revisionCount: 2 });
		expect(workflow.metadata?.reviewAttempts).toHaveLength(3);
	});

	it('rejects stale and out-of-order transitions', () => {
		const workflow = compileResearchWorkflow({ id: 'research-1', teamId: 'team-1', projectId: 'project-1', objectiveRef: 'objective:1', questionRef: 'question:1' });
		expect(() => advanceResearchWorkflow(workflow, { expectedStateVersion: 0, stage: 'question-decomposition', assignmentId: 'a', artifactRefs: ['q'] })).toThrow(/state_conflict/u);
		expect(() => advanceResearchWorkflow(workflow, { expectedStateVersion: 1, stage: 'governed-source-search', assignmentId: 'a', artifactRefs: ['q'] })).toThrow(/stage_not_ready/u);
	});

	it('blocks publication after the configured revision limit instead of reopening forever', () => {
		let workflow = compileResearchWorkflow({
			id: 'research-bounded', teamId: 'team-1', projectId: 'project-1', objectiveRef: 'objective:1',
			questionRef: 'question:1', maxRevisionCycles: 1, now: '2026-07-18T00:00:00.000Z',
		});
		const complete = (stage: (typeof RESEARCH_WORKFLOW_STAGES)[number], extra: Record<string, unknown> = {}) => {
			workflow = advanceResearchWorkflow(workflow, {
				expectedStateVersion: workflow.stateVersion, stage, assignmentId: `assignment:${stage}:${workflow.stateVersion}`,
				artifactRefs: [`artifact:${stage}`], ...extra,
			});
		};
		complete('question-decomposition'); complete('source-selection-criteria'); complete('governed-source-search');
		complete('independent-source-fetch', { citations: [citation('1', 'one.test'), citation('2', 'two.test')] });
		complete('linked-evidence-notes', { artifactRefs: ['note:one', 'note:two'] });
		complete('claim-synthesis', { claims: [{ id: 'claim-1', text: 'Unsupported', material: true, status: 'unsupported', citationIds: [] }] });
		complete('citation-review-rejection', { reviewOutcome: 'rejected', reviewReason: 'Missing support.' });
		complete('revision', { claims: [{ id: 'claim-1', text: 'Still too broad', material: true, status: 'supported', citationIds: ['source-1', 'source-2'] }] });
		complete('citation-review-approval', { reviewOutcome: 'rejected', reviewReason: 'The wording still exceeds the sources.' });
		expect(workflow).toMatchObject({
			status: 'blocked', reviewerApprovedRevision: false, revisionCount: 1,
			metadata: { blockedCode: 'research_workflow_revision_limit_reached', blockedReason: 'The wording still exceeds the sources.' },
		});
		expect(workflow.nodes.find((node) => node.stage === 'citation-review-approval')).toMatchObject({ status: 'failed' });
		expect(workflow.nodes.find((node) => node.stage === 'revision')).toMatchObject({ status: 'completed' });
	});
});
