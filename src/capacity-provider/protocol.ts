import { PROVIDER_MEMBERSHIP_SCOPES } from './contracts/index.ts';

export const CAPACITY_PROVIDER_ENDPOINTS = {
	sessions: '/v1/provider/availability-sessions',
	sessionRefresh: (sessionId: string) => `/v1/provider/availability-sessions/${encodeURIComponent(sessionId)}`,
	sessionClose: (sessionId: string) => `/v1/provider/availability-sessions/${encodeURIComponent(sessionId)}/close`,
	nextAssignment: '/v1/provider/assignments/next',
	assignment: (assignmentId: string) => `/v1/provider/assignments/${encodeURIComponent(assignmentId)}`,
	assignmentRenew: (assignmentId: string) => `/v1/provider/assignments/${encodeURIComponent(assignmentId)}/renew`,
	assignmentReturn: (assignmentId: string) => `/v1/provider/assignments/${encodeURIComponent(assignmentId)}/return`,
	assignmentComplete: (assignmentId: string) => `/v1/provider/assignments/${encodeURIComponent(assignmentId)}/complete`,
	assignmentFail: (assignmentId: string) => `/v1/provider/assignments/${encodeURIComponent(assignmentId)}/fail`,
	assignmentUsage: (assignmentId: string) => `/v1/provider/assignments/${encodeURIComponent(assignmentId)}/usage`,
	assignmentSettle: (assignmentId: string) => `/v1/provider/assignments/${encodeURIComponent(assignmentId)}/settle`,
	assignmentModeRuns: (assignmentId: string) => `/v1/provider/assignments/${encodeURIComponent(assignmentId)}/mode-runs`,
	assignmentWorkflowOperationDispatch: (assignmentId: string, operationId: string) => `/v1/provider/assignments/${encodeURIComponent(assignmentId)}/workflow-operations/${encodeURIComponent(operationId)}/dispatch`,
	assignmentExplanation: (assignmentId: string) => `/v1/provider/assignments/${encodeURIComponent(assignmentId)}/explanation`,
} as const;

export const CAPACITY_PROVIDER_GOVERNANCE_ENDPOINTS = {
	registrations: '/v1/provider-registrations',
	registration: (requestId: string) => `/v1/provider-registrations/${encodeURIComponent(requestId)}`,
	registrationCredential: (requestId: string) => `/v1/provider-registrations/${encodeURIComponent(requestId)}/credential`,
	accessTokens: '/v1/provider/access-tokens',
	membershipLeave: '/v1/provider/membership/leave',
	identityRotate: '/v1/provider/identity/rotate',
	credentialRotation: '/v1/provider/credential-rotation',
} as const;

export const CAPACITY_PROVIDER_SCOPES = PROVIDER_MEMBERSHIP_SCOPES;
export type CapacityProviderScope = (typeof CAPACITY_PROVIDER_SCOPES)[number];
