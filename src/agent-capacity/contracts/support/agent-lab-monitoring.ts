export const agentLabMetricKeys = [
	'agents', 'workdays', 'systemEvents', 'assignments', 'executions',
	'artifacts', 'passed', 'failed', 'running',
] as const;

export type AgentLabMetricKey = typeof agentLabMetricKeys[number];
export type AgentLabMetricSemantic = 'configured' | 'cumulative' | 'instantaneous' | 'exact-total';
export type AgentLabEntityKind = 'agents' | 'workdays' | 'events' | 'assignments' | 'executions' | 'artifacts';

export interface AgentLabMetricValue {
	key: AgentLabMetricKey;
	value: number;
	secondary?: string | null;
	semantic: AgentLabMetricSemantic;
	observedAt: string;
}

export interface AgentLabWorkdaySummary {
	id: string;
	title: string;
	status: string;
	startedAt: string | null;
	finishedAt: string | null;
}

export interface AgentLabWorkdayContext {
	selectedDate: string;
	selectedWorkdayId: string | null;
	latestWorkdayId: string | null;
	workdays: AgentLabWorkdaySummary[];
}

export interface AgentLabOverview {
	revision: string;
	generatedAt: string;
	timeZone: string;
	operatingDay: { start: string; end: string };
	team: { id: string; name: string };
	workdayContext: AgentLabWorkdayContext;
	metricTargets: AgentLabMetricTargets;
	targetRevision: string | null;
	connectivity: 'live' | 'idle' | 'degraded';
	activeWorkdays: number;
	activeProviders: number;
	executionProviders: string[];
	metrics: AgentLabMetricValue[];
}

export interface AgentLabActivityInterval {
	id: string;
	stateVersion: number;
	projectId: string;
	projectName: string;
	agentId: string;
	agentName: string;
	agentClassId: string;
	activityProfile: string;
	assignmentId: string;
	executionId: string;
	status: string;
	startedAt: string;
	finishedAt: string | null;
}

export interface AgentLabMetricPoint {
	id: string;
	stateVersion: number;
	timestamp: string;
	values: Record<AgentLabMetricKey, number>;
	statistics: Partial<Record<AgentLabMetricKey, { semantic: AgentLabMetricSemantic; exactTotal: number; mean: number; standardDeviation: number | null; low: number; high: number; sampleSize: number; observedAt: string }>>;
}

export type AgentLabMetricTargets = Partial<Record<AgentLabMetricKey, number>>;

export interface AgentLabDelta<T> {
	revision: string;
	generatedAt: string;
	cursor: string | null;
	upserts: T[];
	removedIds: string[];
}

export interface AgentLabEntitySummary {
	id: string;
	kind: AgentLabEntityKind;
	title: string;
	description: string;
	status?: string | null;
	projectId?: string | null;
	projectName?: string | null;
	workdayName?: string | null;
	activityProfile?: string | null;
	occurredAt?: string | null;
}
