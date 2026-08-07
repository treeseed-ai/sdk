export const GROUP_CONTRACT = 'treeseed.group/v1' as const;
export const GROUP_EDGE_CONTRACT = 'treeseed.group-edge/v1' as const;

export interface GovernanceGroup {
	contract: typeof GROUP_CONTRACT;
	id: string;
	slug: string;
	name: string;
	description: string;
	classification: string;
	aliases: string[];
	status: 'active' | 'archived';
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
	directGroupIds: string[];
	effectiveGroupIds: string[];
	provenance: GroupMembershipProvenance[];
}

export interface DecisionGroupSnapshot extends EffectiveGroupMembership {
	proposalId: string;
	proposalCommitSha: string;
	capturedAt: string;
}

export interface AgentGroupSubscription {
	groupIds: string[];
	includeDescendants: boolean;
	models: string[];
	events: string[];
	activityProfile: string;
	intent?: 'discuss' | 'propose' | 'act';
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
