export type ProviderLanePurpose = 'communication' | 'operation';
export type CapacityExecutionKind = 'workday' | 'conversation' | 'simulation' | 'recovery';
export type CapacityTriggerKind = 'scheduled' | 'manual' | 'discussion' | 'agent-handoff';
export type CommunicationPriorityClass = 'human-interactive' | 'workday-blocking-agent' | 'agent-asynchronous' | 'operational';

export const COMMUNICATION_PRIORITY: Readonly<Record<CommunicationPriorityClass,number>> = {
	'human-interactive':400,
	'workday-blocking-agent':300,
	'agent-asynchronous':200,
	operational:100,
};

export type AgentInvocationStatus = 'queued'|'coalesced'|'admitted'|'running'|'suspended'|'blocked'|'completed'|'failed'|'cancelled'|'expired'|'stale';

export interface AgentInvocationRequest {
	contract:'treeseed.agent-invocation-request/v1';
	id:string; teamId:string; projectId:string; agentId:string; projectAgentClassId:string;
	agentRevision:string; profileRevision:string; executionKind:CapacityExecutionKind; triggerKind:CapacityTriggerKind;
	priorityClass:CommunicationPriorityClass; priority:number; sourceKind:string; sourceRefs:string[]; subjectDigest:string;
	idempotencyKey:string; requestDigest:string; status:AgentInvocationStatus; availableAt:string; expiresAt:string|null;
	parentWorkdayId:string|null; parentAssignmentId:string|null; handoffRootId:string|null; handoffParentId:string|null;
	handoffDepth:number; blocking:boolean; recipientAgentIds:string[]; admittedDemandId:string|null; executionId:string|null;
	assignmentId:string|null; finalMessageRef:string|null; blocker:Record<string,unknown>|null;
	createdAt:string; updatedAt:string; completedAt:string|null;
}

export interface DiscussionCoordinationPolicy {
	contract:'treeseed.discussion-coordination-policy/v1';
	humanToAgentEnabled:boolean; agentCoordinationEnabled:boolean; outsideWorkdayEnabled:boolean;
	maximumHandoffDepth:number; maximumHandoffsPerRoot:number; maximumRecipientsPerHandoff:number;
	allowSelfHandoff:false;
}

export interface DiscussionHandoffContext {
	contract:'treeseed.discussion-handoff-context/v1'; rootInvocationId:string; parentInvocationId:string;
	sourceAgentId:string; recipientAgentIds:string[]; subjectDigest:string; sourceMessageRefs:string[];
	parentWorkdayId:string|null; parentAssignmentId:string|null; depth:number; blocking:boolean;
}

export type ClientActionKind='navigate'|'reveal-resource'|'set-view-filter'|'populate-draft'|'present-confirmation';
export interface ClientActionRequest {
	contract:'treeseed.client-action-request/v1'; id:string; idempotencyKey:string; assignmentId:string;
	userId:string; teamId:string; projectId:string; sessionId:string|null; action:ClientActionKind;
	payload:Record<string,unknown>; status:'pending'|'completed'|'rejected'|'expired'|'failed'|'unavailable';
	expiresAt:string; createdAt:string; updatedAt:string;
}

export interface OperationHandoffRequest {
	contract:'treeseed.operation-handoff/v1'; id:string; assignmentId:string; invocationId:string;
	teamId:string; projectId:string; discussionId:string; sourceMessageRefs:string[]; target:string;
	inputs:Record<string,unknown>; expectedEffect:string; requiredAuthority:string[];
	proposalId:string|null; decisionId:string|null; approvalRequestId:string|null;
	status:'proposed'|'awaiting-approval'|'approved'|'scheduled'|'completed'|'failed'|'cancelled';
}
