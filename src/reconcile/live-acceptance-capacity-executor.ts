import type { CapacityProviderPrivateJwk } from '../capacity-provider.ts';

export interface TreeseedCapacityAcceptanceExecutionResult {
	assignmentId: string;
	providerSessionSequence?: number;
	finalSlot?: {
		twoRunnableConnections: boolean;
		providerGlobalLimit: number;
		readyDispatches: number;
		localClaimsAtCapacity: number;
	};
}

export interface TreeseedCapacityAcceptanceExecutionInput {
	runId: string;
	apiUrl: string;
	teamId: string;
	projectId: string;
	providerId: string;
	membershipId: string;
	credentialId: string;
	membershipCredential: string;
	providerAccessToken: string;
	providerSessionId: string;
	providerSessionSequence: number;
	privateJwk: CapacityProviderPrivateJwk;
	assignmentId?: string | null;
	repositoryRoot?: string;
	executionProviderId: string;
	capabilities?: string[];
	activityProfile?: {
		kind: 'research-planning' | 'research-workflow' | 'engineering-workflow';
		subjectModel: 'objective' | 'question';
		subjectSlug: string;
	};
	competingConnection?: {
		teamId: string;
		projectId: string;
		providerId: string;
		membershipId: string;
		credentialId: string;
		membershipCredential: string;
		providerAccessToken: string;
		providerSessionId: string;
		providerSessionSequence: number;
		assignmentId: string;
	};
}
