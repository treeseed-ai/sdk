export type CapacityGrantStatus = 'planned' | 'active' | 'paused' | 'revoked' | 'expired';

export interface CapacityGrantV2 {
	schemaVersion: 2;
	id: string;
	membershipId: string;
	teamId: string;
	providerId: string;
	projectId: string;
	environment: string;
	status: CapacityGrantStatus;
	executionProviderIds: string[];
	laneIds: string[];
	capabilities: string[];
	allowedModes: Array<'planning' | 'acting'>;
	dailyAgentSecondsLimit?: number | null;
	monthlyAgentSecondsLimit?: number | null;
	maxConcurrentAssignments?: number | null;
	budgetLimits?: {
		tokens?: number | null;
		cost?: { amount: number; currency: string } | null;
		native?: Array<{ unit: string; amount: number }>;
	} | null;
	unmetered?: boolean;
	expiresAt?: string | null;
	metadata?: Record<string, unknown>;
}

export { validateCapacityGrantV2 } from './validation/grant.ts';
export type { CapacityGrantDiagnostic, CapacityGrantValidation } from './validation/grant.ts';
