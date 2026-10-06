import { z } from 'zod';
import { uniqueArray } from '../../../../content/validation/schema-constraints.ts';
import { AGENT_TOOL_GROUPS } from '../../../../types/agents.ts';
import { assignmentAttemptSchema, leaseSchema } from '../assignments/agent-execution.ts';

// Canonical stored supply records, not negotiated capability-offer/v2 or
// reconstructed usage. Reuse the existing exact authority scalar validators.
const identifier = leaseSchema.shape.id, timestamp = leaseSchema.shape.acquiredAt;
export const availabilityWindowSchema = z.object({ startsAt: timestamp, endsAt: timestamp }).strict();
export const nativeLimitSchema = z.object({ name: identifier, unit: identifier, maximum: z.number().finite().positive() }).strict();
export const providerOfferSchema = z.object({
	schemaVersion: z.literal('treeseed.provider-offer/v1'), id: identifier, providerId: identifier,
	revision: z.number().int().positive(), runtimeBuild: assignmentAttemptSchema.innerType().shape.provider.shape.runtimeBuild,
	capabilities: uniqueArray(z.array(identifier)), toolGroups: uniqueArray(z.array(z.enum(AGENT_TOOL_GROUPS))),
	maximumConcurrency: z.number().int().positive(), availability: z.array(availabilityWindowSchema).min(1),
	nativeLimits: z.array(nativeLimitSchema), validFrom: timestamp, validUntil: timestamp.optional(),
}).strict();
export const providerStateSchema = z.object({
	schemaVersion: z.literal('treeseed.provider-state/v1'), providerId: identifier, offerId: identifier, healthy: z.boolean(),
	activeAssignmentIds: uniqueArray(z.array(identifier)), observedNativeUsage: z.record(z.number().finite().nonnegative()),
	observedAt: timestamp,
}).strict();
export type ProviderOffer = z.infer<typeof providerOfferSchema>;
export type ProviderState = z.infer<typeof providerStateSchema>;

export const CAPACITY_SUPPLY_POLICY_CONTRACT = 'treeseed.capacity-supply-policy/v1' as const;

export interface CapacitySupplyPolicy {
	contract: typeof CAPACITY_SUPPLY_POLICY_CONTRACT;
	generation: number;
	reliabilityFloor: number;
	maxFailovers: number;
	allowPlanningFailover: boolean;
	allowActingFailover: boolean;
	preferredCapacityProviderIds?: string[];
	disallowedCapacityProviderIds?: string[];
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
}

export interface CapacitySupplySelection {
	selected: CapacitySupplyCandidate | null;
	eligible: CapacitySupplyCandidate[];
	rejected: Array<{ candidate: CapacitySupplyCandidate; reasons: string[] }>;
}
