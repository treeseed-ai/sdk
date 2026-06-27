import { describe, expect, it } from 'vitest';
import {
	adminApprovalProvider,
	absoluteThresholdProvider,
	simpleMajorityProvider,
	treeseedBicameralProvider,
	type GovernanceElectorateSnapshot,
	type GovernanceEvaluationVote,
} from '../../src/governance.ts';

function voter(userId: string, memberWeight = 1, stakeWeight = 1, activeForQuorum = true) {
	return {
		userId,
		activeForQuorum,
		chambers: [
			{ chamberId: 'member_chamber', eligible: true, weight: memberWeight, source: 'test', evidence: {} },
			{ chamberId: 'stake_chamber', eligible: true, weight: stakeWeight, source: 'test', evidence: {} },
			{ chamberId: 'admin_chamber', eligible: true, weight: 1, source: 'test', evidence: {} },
		],
	};
}

async function snapshot(provider: typeof treeseedBicameralProvider, config: Record<string, unknown> = {}): Promise<GovernanceElectorateSnapshot> {
	return provider.snapshotElectorate({
		teamId: 'team-1',
		projectId: 'project-1',
		scope: 'project',
		providerConfig: config,
		eligibleVoters: [
			voter('u1', 1, 5),
			voter('u2', 1, 3),
			voter('u3', 1, 2),
			voter('u4', 1, 1, false),
		],
		delegations: [],
		createdAt: '2026-01-01T00:00:00.000Z',
	});
}

function vote(userId: string, value: 'support' | 'object' | 'abstain'): GovernanceEvaluationVote {
	return {
		userId,
		vote: value,
		reason: null,
		chamberVotes: {},
		effectiveWeights: {},
		delegatedFrom: [],
	};
}

describe('governance voting providers', () => {
	it('accepts and rejects admin approval decisions', async () => {
		const electorate = await snapshot(adminApprovalProvider);

		expect(adminApprovalProvider.evaluate({ electorate, votes: [], adminDecision: 'approved' }).status).toBe('accepted');
		expect(adminApprovalProvider.evaluate({ electorate, votes: [], adminDecision: 'rejected' }).status).toBe('rejected');
	});

	it('accepts simple majority when support beats objection with quorum at close', async () => {
		const electorate = await snapshot(simpleMajorityProvider, {
			quorumPercent: 0.2,
			minimumParticipatingVoters: 1,
		});

		const outcome = simpleMajorityProvider.evaluate({
			now: '2026-01-02T00:00:00.000Z',
			votingEndsAt: '2026-01-01T00:00:00.000Z',
			electorate,
			votes: [vote('u1', 'support'), vote('u2', 'object'), vote('u3', 'support')],
		});

		expect(outcome.status).toBe('accepted');
		expect(outcome.reasonCode).toBe('support_threshold_met');
	});

	it('accepts absolute threshold when support reaches configured active weight', async () => {
		const electorate = await snapshot(absoluteThresholdProvider, {
			acceptThreshold: 0.6,
			rejectThreshold: 0.6,
			quorumPercent: 0.2,
			minimumParticipatingVoters: 1,
		});

		const outcome = absoluteThresholdProvider.evaluate({
			electorate,
			votes: [vote('u1', 'support'), vote('u2', 'support')],
		});

		expect(outcome.status).toBe('accepted');
	});

	it('requires both bicameral chambers to pass', async () => {
		const electorate = await snapshot(treeseedBicameralProvider, {
			memberChamber: { quorumPercent: 0.2, supportThreshold: 0.5, rejectThreshold: 0.5, minimumParticipatingVoters: 1 },
			stakeChamber: { quorumPercent: 0.2, supportThreshold: 0.6, rejectThreshold: 0.6, minimumParticipatingVoters: 1 },
		});

		const outcome = treeseedBicameralProvider.evaluate({
			electorate,
			votes: [vote('u1', 'support'), vote('u2', 'support')],
		});

		expect(outcome.status).toBe('accepted');
		expect(outcome.chamberResults.map((result) => result.status)).toEqual(['accepted', 'accepted']);
	});

	it('rejects bicameral proposals when either chamber reaches objection threshold', async () => {
		const electorate = await snapshot(treeseedBicameralProvider, {
			memberChamber: { quorumPercent: 0.2, supportThreshold: 0.5, rejectThreshold: 0.5, minimumParticipatingVoters: 1 },
			stakeChamber: { quorumPercent: 0.2, supportThreshold: 0.6, rejectThreshold: 0.6, minimumParticipatingVoters: 1 },
		});

		const outcome = treeseedBicameralProvider.evaluate({
			electorate,
			votes: [vote('u1', 'object'), vote('u2', 'object')],
		});

		expect(outcome.status).toBe('rejected');
		expect(outcome.reasonCode).toBe('object_threshold_met');
	});

	it('returns no decision when bicameral quorum fails at deadline', async () => {
		const electorate = await snapshot(treeseedBicameralProvider, {
			memberChamber: { quorumPercent: 0.9, supportThreshold: 0.5, rejectThreshold: 0.5, minimumParticipatingVoters: 4 },
			stakeChamber: { quorumPercent: 0.9, supportThreshold: 0.6, rejectThreshold: 0.6, minimumParticipatingVoters: 4 },
		});

		const outcome = treeseedBicameralProvider.evaluate({
			now: '2026-01-02T00:00:00.000Z',
			votingEndsAt: '2026-01-01T00:00:00.000Z',
			electorate,
			votes: [vote('u1', 'support')],
		});

		expect(outcome.status).toBe('no_decision_quorum_failed');
		expect(outcome.reasonCode).toBe('deadline_quorum_failed');
	});
});
