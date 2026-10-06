/** Portable durable records shared by workday control-plane and operator consumers. */
import type { WorkdayAgentSelection } from '../../../workday.ts';
import type { AgentWorkExecutionMode } from '../../support/authority/execution-mode.ts';
import { z } from 'zod';
import { leaseSchema } from '../assignments/agent-execution.ts';
import { workdayIntentSchema } from '../../../../operator-contracts/workday-lifecycle.ts';

export type CapacityWorkdayRunStatus =
	| 'queued'
	| 'running'
	| 'completed'
	| 'cancelled'
	| 'failed'
	| 'degraded';

export type CapacityWorkdayEventStatus =
	| 'recorded'
	| 'active'
	| 'completed'
	| 'warning'
	| 'error'
	| 'failed';

export interface CapacityWorkdayRunRecord {
	id: string;
	teamId: string;
	capacityProviderId: string | null;
	scenarioId: string;
	status: CapacityWorkdayRunStatus;
	environment: string;
	executionMode: AgentWorkExecutionMode;
	executionKind?: import('../communication/communication-records.ts').CapacityExecutionKind;
	triggerKind?: import('../communication/communication-records.ts').CapacityTriggerKind;
	hidden?: boolean;
	requestedById: string | null;
	parameters: Record<string, unknown>;
	summary: Record<string, unknown>;
	metrics: Record<string, unknown>;
	expected: Record<string, unknown>;
	actual: Record<string, unknown>;
	reportRefs: Record<string, unknown>;
	error: Record<string, unknown>;
	startedAt: string | null;
	completedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface CapacityWorkdayEventRecord {
	id: string;
	runId: string;
	teamId: string;
	projectId: string | null;
	workdayId: string | null;
	assignmentId: string | null;
	eventIndex: number;
	eventType: string;
	status: CapacityWorkdayEventStatus;
	title: string | null;
	message: string | null;
	parameters: Record<string, unknown>;
	context: Record<string, unknown>;
	refs: Record<string, unknown>;
	metadata: Record<string, unknown>;
	createdAt: string;
}

export type AgentActivityEventSeverity = 'debug' | 'info' | 'warning' | 'error';

/** Compact, ordered workday activity. Full model and tool payloads are retrieved through transcriptRef. */
export interface AgentActivityEvent {
	id: string;
	sequence: number;
	sourceEventId: string;
	timestamp: string;
	teamId: string;
	projectId: string | null;
	workdayId: string;
	assignmentId: string | null;
	executionRunId: string | null;
	agentId: string | null;
	agentClassId: string | null;
	activityType: string | null;
	handlerId: string | null;
	capacityProviderId: string | null;
	providerManagerId: string | null;
	runnerId: string | null;
	executionProviderId: string | null;
	eventType: string;
	severity: AgentActivityEventSeverity;
	summary: string;
	transcriptRef: string | null;
	artifactRefs: Record<string, unknown>[];
	contextPackDigest: string | null;
	usageDelta: Record<string, unknown>;
	durationMs: number | null;
	errorCategory: string | null;
	recoveryState: string | null;
	redactionStatus: string;
	payloadDigest: string;
}

export interface ProviderRuntimeEventInput {
	id: string;
	leaseToken?: string;
	runnerId?: string;
	sequence?: number;
	protectedPayload?: Record<string, unknown>;
	eventType: `provider.${string}`;
	status: 'recorded' | 'active' | 'completed' | 'warning' | 'error' | 'failed';
	component: 'provider-manager' | 'provider-runner' | 'lease' | 'execution-provider' | 'recovery';
	message: string;
	createdAt?: string;
	context?: Record<string, unknown>;
	refs?: Record<string, unknown>;
	metrics?: Record<string, unknown>;
}

export const workdayScheduleSchema = z.object({
	id: leaseSchema.shape.id, teamId: leaseSchema.shape.id, status: z.enum(['active', 'paused', 'completed', 'failed']),
	purpose: z.string(), cadenceSeconds: z.number().int().min(60), intent: workdayIntentSchema,
	lastRunId: z.string().nullable(), nextRunAt: leaseSchema.shape.acquiredAt, stateVersion: z.number().int().positive(),
	createdAt: leaseSchema.shape.acquiredAt, updatedAt: leaseSchema.shape.acquiredAt,
}).strict();
export type CapacityWorkdayScheduleRecord = z.infer<typeof workdayScheduleSchema>;
