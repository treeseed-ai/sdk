import { describe, expect, it } from 'vitest';
import {
	GROUP_CONTRACT, GROUP_EDGE_CONTRACT, resolveEffectiveGroupMembership, snapshotDecisionGroups,
	validateGovernanceGroupGraph, type GovernanceGroup, type GovernanceGroupEdge,
} from '../../../../../src/index/capacity-and-governance.ts';

const groups: GovernanceGroup[] = ['engineering', 'platform', 'security'].map((id) => ({
	contract: GROUP_CONTRACT, id, slug: id, name: id, description: id, classification: `topic/${id}`, aliases: [], status: 'active',
}));
const edges: GovernanceGroupEdge[] = [
	{ contract: GROUP_EDGE_CONTRACT, id: 'platform-engineering', fromGroupId: 'platform', toGroupId: 'engineering', predicate: 'is-part-of', propagatesMembership: true },
	{ contract: GROUP_EDGE_CONTRACT, id: 'security-platform', fromGroupId: 'security', toGroupId: 'platform', predicate: 'is-part-of', propagatesMembership: true },
];

describe('governance group membership', () => {
	it('resolves multiple levels with durable provenance and snapshots proposal membership for decisions', () => {
		validateGovernanceGroupGraph(groups, edges);
		const membership = resolveEffectiveGroupMembership({ directGroupIds: ['security'], edges });
		expect(membership.effectiveGroupIds).toEqual(['engineering', 'platform', 'security']);
		expect(membership.provenance.find((entry) => entry.groupId === 'engineering')?.viaGroupIds).toEqual(['security', 'platform']);
		const snapshot = snapshotDecisionGroups({ proposalId: 'proposal-1', proposalCommitSha: 'a'.repeat(40), capturedAt: '2026-08-06T00:00:00.000Z', membership });
		expect(snapshot.provenance.every((entry) => entry.kind === 'proposal-snapshot')).toBe(true);
	});

	it('rejects cycles only in membership-propagating edges', () => {
		expect(() => validateGovernanceGroupGraph(groups, [...edges, {
			contract: GROUP_EDGE_CONTRACT, id: 'cycle', fromGroupId: 'engineering', toGroupId: 'security', predicate: 'related-to', propagatesMembership: true,
		}])).toThrow(/cycle/u);
		expect(() => validateGovernanceGroupGraph(groups, [...edges, {
			contract: GROUP_EDGE_CONTRACT, id: 'ontology-cycle', fromGroupId: 'engineering', toGroupId: 'security', predicate: 'related-to', propagatesMembership: false,
		}])).not.toThrow();
	});
});
