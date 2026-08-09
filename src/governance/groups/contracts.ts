export const GROUP_CONTRACT = 'treeseed.group/v1' as const;
export const GROUP_EDGE_CONTRACT = 'treeseed.group-edge/v1' as const;

export interface GroupRef {
	projectId: string;
	groupId: string;
	immutableRef?: string;
	digest?: string;
}

export type GroupMemberKind = 'agent' | 'person' | 'content';

export interface GroupMemberRef {
	kind: GroupMemberKind;
	id: string;
	projectId: string;
	groupIds: string[];
	roleIds?: string[];
	immutableRef?: string;
}

export interface GroupCoordinationPolicy {
	proposalTypes?: string[];
	eligibleActivityProfiles?: string[];
	participation?: {
		strategy: 'all-eligible' | 'bounded';
		minParticipants?: number;
		maxParticipants?: number;
	};
	humanRoles?: string[];
	agentRoles?: string[];
	reviewQuorum?: number;
	handoffGroupRefs?: GroupRef[];
	allocationDefaults?: { priority?: number; budgetShare?: number };
}

export interface GovernanceGroup {
	contract: typeof GROUP_CONTRACT;
	id: string;
	slug: string;
	name: string;
	description: string;
	classification: string;
	aliases: string[];
	status: 'active' | 'archived';
	coordination?: GroupCoordinationPolicy;
}

export interface GovernanceGroupEdge {
	contract: typeof GROUP_EDGE_CONTRACT;
	id: string;
	fromGroupId: string;
	toGroupId: string;
	predicate: string;
	propagatesMembership: boolean;
}

export interface GroupMembershipProvenance {
	groupId: string;
	kind: 'direct' | 'inherited' | 'subject' | 'proposal-snapshot';
	viaGroupIds: string[];
	sourceEntityRefs: string[];
}

export interface EffectiveGroupMembership {
	projectId?: string;
	directGroupIds: string[];
	effectiveGroupIds: string[];
	provenance: GroupMembershipProvenance[];
}

export interface DecisionGroupSnapshot extends EffectiveGroupMembership {
	proposalId: string;
	proposalCommitSha: string;
	capturedAt: string;
}

export interface GroupMembershipSnapshot extends EffectiveGroupMembership {
	projectId: string;
	graphRevision: string;
	immutableRef: string;
	digest: string;
	capturedAt: string;
}

export type SignalGroupScope =
	| { mode: 'member-groups' }
	| { mode: 'specific-groups'; groupRefs: GroupRef[]; includeDescendants?: boolean }
	| { mode: 'project'; projectId: string };

export interface GroupScopeMatch {
	matched: boolean;
	coordinationGroupId: string | null;
	matchedGroupIds: string[];
	reason: 'explicit' | 'primary' | 'shared-direct' | 'shared-effective' | 'project' | 'outside-scope' | 'ambiguous';
}

export interface GroupedEntityReference {
	model: string;
	id: string;
	commitSha?: string;
}

export interface GroupedContentFields {
	groupIds: string[];
	entityRefs?: GroupedEntityReference[];
}
