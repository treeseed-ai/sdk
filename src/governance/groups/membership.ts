import type {
	AgentGroupSubscription, DecisionGroupSnapshot, EffectiveGroupMembership, GovernanceGroup, GovernanceGroupEdge,
	GroupMembershipProvenance,
} from './contracts.ts';

function unique(values: string[]) {
	return [...new Set(values.filter(Boolean))].sort();
}

export function validateGovernanceGroupGraph(groups: GovernanceGroup[], edges: GovernanceGroupEdge[]) {
	const ids = new Set(groups.map((group) => group.id));
	if (ids.size !== groups.length) throw new Error('Group IDs must be unique.');
	const propagating = new Map<string, string[]>();
	for (const edge of edges) {
		if (!ids.has(edge.fromGroupId) || !ids.has(edge.toGroupId)) throw new Error(`Group edge ${edge.id} references an unknown group.`);
		if (!edge.propagatesMembership) continue;
		propagating.set(edge.fromGroupId, [...(propagating.get(edge.fromGroupId) ?? []), edge.toGroupId]);
	}
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (id: string) => {
		if (visiting.has(id)) throw new Error(`Membership-propagating group edge creates a cycle at ${id}.`);
		if (visited.has(id)) return;
		visiting.add(id);
		for (const parent of propagating.get(id) ?? []) visit(parent);
		visiting.delete(id);
		visited.add(id);
	};
	for (const id of ids) visit(id);
}

export function resolveEffectiveGroupMembership(input: {
	directGroupIds: string[];
	edges: GovernanceGroupEdge[];
	subjects?: Array<{ ref: string; membership: EffectiveGroupMembership }>;
}): EffectiveGroupMembership {
	const parents = new Map<string, string[]>();
	for (const edge of input.edges.filter((candidate) => candidate.propagatesMembership)) {
		parents.set(edge.fromGroupId, [...(parents.get(edge.fromGroupId) ?? []), edge.toGroupId]);
	}
	const provenance = new Map<string, GroupMembershipProvenance>();
	const inherit = (groupId: string, path: string[], sourceRefs: string[], kind: GroupMembershipProvenance['kind']) => {
		if (!provenance.has(groupId)) provenance.set(groupId, { groupId, kind, viaGroupIds: path, sourceEntityRefs: sourceRefs });
		for (const parent of parents.get(groupId) ?? []) inherit(parent, [...path, groupId], sourceRefs, kind === 'direct' ? 'inherited' : kind);
	};
	for (const groupId of unique(input.directGroupIds)) inherit(groupId, [], [], 'direct');
	for (const subject of input.subjects ?? []) {
		for (const groupId of subject.membership.effectiveGroupIds) inherit(groupId, [], [subject.ref], 'subject');
	}
	return {
		directGroupIds: unique(input.directGroupIds),
		effectiveGroupIds: [...provenance.keys()].sort(),
		provenance: [...provenance.values()].sort((left, right) => left.groupId.localeCompare(right.groupId)),
	};
}

export function snapshotDecisionGroups(input: {
	proposalId: string; proposalCommitSha: string; capturedAt: string; membership: EffectiveGroupMembership;
}): DecisionGroupSnapshot {
	return { ...input.membership, proposalId: input.proposalId, proposalCommitSha: input.proposalCommitSha, capturedAt: input.capturedAt,
		provenance: input.membership.provenance.map((entry) => ({ ...entry, kind: 'proposal-snapshot' })) };
}

export function subscriptionMatches(input: {
	subscription: AgentGroupSubscription;
	model: string;
	event: string;
	effectiveGroupIds: string[];
	descendantGroupIds?: string[];
}) {
	if (!input.subscription.models.includes(input.model) || !input.subscription.events.includes(input.event)) return false;
	const candidates = new Set(input.effectiveGroupIds);
	if (input.subscription.includeDescendants) for (const id of input.descendantGroupIds ?? []) candidates.add(id);
	return input.subscription.groupIds.some((id) => candidates.has(id));
}
