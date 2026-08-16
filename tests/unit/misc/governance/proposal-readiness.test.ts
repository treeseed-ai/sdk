import { describe,expect,it } from 'vitest';
import { evaluateGovernanceProposalReadiness } from '../../../../src/governance/policy/proposal-readiness.ts';

const complete = {
	title: 'Harden the Guide planning workflow',
	summary: 'Create a staged, evidence-first editorial planning workflow with explicit governance readiness.',
	body: 'This proposal replaces ungrounded authorization records with research-led planning. It specifies discovery, synthesis, estimation, independent review, and closeout so human participants can judge valuable work before deciding whether acting may begin.',
	relatedObjectives: ['objective:guide'], evidenceRefs: ['note:evidence'],
	proposalTypes: ['technical-accuracy'],
	plan: {
		desiredOutcome: 'Give operators a complete and verifiable planning workflow they can trust.',
		currentProblem: 'Current editorial proposals omit the evidence and execution detail needed for sound governance.',
		proposedApproach: 'Research the objective, synthesize a bounded plan, estimate it, and review it independently.',
		scope: ['Guide planning'], nonGoals: ['Automatic approval'], deliverables: ['Editorial plan'],
		acceptanceCriteria: ['All required evidence is linked'], risks: ['Stale evidence'], dependencies: ['TreeDX'],
		alternatives: ['Retain manual planning'], verification: ['Run the planning scene'], openQuestions: [],
	},
	contentProvenance: { contentPath: 'src/content/proposals/guide.mdx', commitSha: 'a'.repeat(40), digest: 'digest' },
};

describe('proposal readiness', () => {
	it('keeps incomplete drafts out of governance readiness', () => {
		const result = evaluateGovernanceProposalReadiness({ relatedObjectives: [], plan: {} });
		expect(result.contentReady).toBe(false);
		expect(result.missingContent).toContain('related objective');
		expect(result.missingContent).toContain('immutable TreeDX provenance');
	});

	it('rejects structured objects where canonical evidence reference strings are required', () => {
		const result = evaluateGovernanceProposalReadiness({
			...complete,
			evidenceRefs: [{ path: 'src/content/notes/evidence.mdx', revision: 'abc' }] as unknown as string[],
		});
		expect(result.contentReady).toBe(false);
		expect(result.missingContent).toContain('research evidence');
	});

	it('requires participation and review before decision, then estimates only when explicitly requested', () => {
		const content = evaluateGovernanceProposalReadiness(complete);
		expect(content.contentReady).toBe(true);
		expect(content.votingReady).toBe(false);
		expect(content.missingVoting).toEqual(['independent review']);
		const estimating = evaluateGovernanceProposalReadiness({ ...complete, independentReviewCount: 1, requiresEstimate: true });
		expect(estimating.missingVoting).toContain('structured estimate');
		const voting = evaluateGovernanceProposalReadiness({ ...complete, independentReviewCount: 1 });
		expect(voting.votingReady).toBe(true);
	});

	it('requires every reviewer class declared by the proposal types', () => {
		const result = evaluateGovernanceProposalReadiness({ ...complete, independentReviewCount: 1, estimateCount: 1, requiredReviewerClasses: ['technical-verification','audience-review'], reviewedReviewerClasses: ['technical-verification'] });
		expect(result.votingReady).toBe(false);
		expect(result.missingReviewerClasses).toEqual(['audience-review']);
		expect(result.missingVoting).toContain('required proposal-type reviews');
	});

	it('requires exact-version participation and an author-independent group review', () => {
		const snapshot = { proposalVersion: 3, planningGraphRevision: 'graph-7', digest: 'snapshot-digest',
			groupIds: ['group:guide'], memberIds: ['author', 'reviewer'], authorAgentId: 'author' };
		const stale = evaluateGovernanceProposalReadiness({ ...complete, proposalVersion: 4, participationSnapshot: snapshot,
			independentReviewCount: 1, estimateCount: 2, completedParticipantIds: ['author', 'reviewer'], independentReviewerIds: ['author'] });
		expect(stale.participationVersionReady).toBe(false);
		expect(stale.authorIndependent).toBe(false);
		expect(stale.missingVoting).toEqual(expect.arrayContaining(['participation for the exact proposal version', 'author-independent group review']));
		const ready = evaluateGovernanceProposalReadiness({ ...complete, proposalVersion: 3, participationSnapshot: snapshot,
			independentReviewCount: 1, estimateCount: 2, completedParticipantIds: ['author', 'reviewer'], independentReviewerIds: ['reviewer'] });
		expect(ready.votingReady).toBe(true);
	});
});
