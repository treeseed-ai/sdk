export const CAPACITY_SUPPLY_POLICY_CONTRACT = 'treeseed.capacity-supply-policy/v1' as const;

export interface CapacitySupplyPolicy {
	contract: typeof CAPACITY_SUPPLY_POLICY_CONTRACT;
	generation: number;
	reliabilityFloor: number;
	maxFailovers: number;
	allowPlanningFailover: boolean;
	allowActingFailover: boolean;
	preferredCapacityProviderIds?: string[];
	preferredExecutionProviderIds?: string[];
	disallowedCapacityProviderIds?: string[];
	disallowedExecutionProviderIds?: string[];
}

export interface CapacitySupplyCandidate {
	capacityProviderId: string;
	membershipId: string;
	providerSessionId: string;
	grantId: string;
	executionProviderId: string;
	status: 'available' | 'unavailable' | 'degraded' | string;
	capabilities: string[];
	reliability: number;
	pressure: 'idle' | 'normal' | 'busy' | 'throttled' | 'exhausted';
	availableConcurrency: number;
	preferred?: boolean;
	estimatedCost?: number | null;
	minimumAssignmentDuration?: import('../../../../capacity-provider/contracts/governance.ts').MinimumAssignmentDuration;
}

export interface CapacitySupplySelection {
	selected: CapacitySupplyCandidate | null;
	eligible: CapacitySupplyCandidate[];
	rejected: Array<{ candidate: CapacitySupplyCandidate; reasons: string[] }>;
}
