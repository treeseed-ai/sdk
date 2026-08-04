import type { AgentActivityEvent } from '../../agent-capacity/contracts/capacity/workdays/workday-records.ts';

export const AGENT_LAB_PRESENTATIONS = ['race-control', 'strategy-command', 'esports-tournament'] as const;
export type AgentLabPresentation = typeof AGENT_LAB_PRESENTATIONS[number];

export type AgentLabWorkdayConfig = {
	id: string;
	title?: string;
	agentTests: string[];
	objectiveRefs: string[];
	durationSeconds: number;
	availableCredits: number;
	maxActiveAssignments: number;
	planningOnly: boolean;
	profileInputs: Record<string, unknown>;
};

export type AgentLabSceneConfig = {
	scope: { kind: 'team'; team: string; capacityProvider: string } | { kind: 'ephemeral' };
	provider: 'local';
	executionProvider: 'codex';
	presentation: AgentLabPresentation;
	timeZone: string;
	repositories: string[];
	agents: string[];
	agentClasses: string[];
	workdays: AgentLabWorkdayConfig[];
};

export type AgentLabTranscriptItem = {
	id: string;
	timestamp: string | null;
	type: string;
	text: string | null;
	status: string | null;
	payload: Record<string, unknown>;
};

export type AgentLabExecutionEvidence = {
	id: string;
	timestamp: string | null;
	kind: 'context-pack' | 'work-package' | 'provider-invocation' | 'agent-message' | 'reasoning' | 'tool-call' | 'treedx-call' | 'provider-output' | 'diagnostic';
	label: string;
	status: string | null;
	summary: string | null;
	detail: unknown;
};

export type AgentLabExecution = {
	id: string;
	assignmentId: string | null;
	modeRunId: string | null;
	agentId: string | null;
	agentClassId: string | null;
	activityType: string | null;
	handlerId: string | null;
	projectId: string | null;
	status: string;
	startedAt: string | null;
	finishedAt: string | null;
	providerId: string | null;
	providerManagerId: string | null;
	runnerId: string | null;
	executionProviderId: string | null;
	transcript: AgentLabTranscriptItem[];
	evidence: AgentLabExecutionEvidence[];
	signals: Record<string, unknown>[];
	artifacts: Record<string, unknown>[];
	usage: Record<string, unknown>;
	error: Record<string, unknown> | null;
	assignment: Record<string, unknown>;
	credits: AgentLabCreditSummary;
};

export type AgentLabCreditSummary = {
	estimated: number;
	requested: number;
	reserved: number;
	actual: number;
	released: number;
	refunded: number;
	overrun: number;
};

export type AgentLabAgent = {
	id: string;
	title: string;
	classId: string;
	description: string | null;
	identity: Record<string, unknown>;
	capabilities: Record<string, unknown>[];
	activityProfiles: Array<{
		id: string;
		activityType: string;
		handlerId: string | null;
		enabled: boolean;
		execution: Record<string, unknown>;
	}>;
};

export type AgentLabAssertion = {
	id: string;
	label: string;
	status: 'pending' | 'passed' | 'failed';
	detail?: string;
};

export type AgentLabWorkdaySnapshot = {
	id: string;
	title: string;
	workdayRunId: string | null;
	status: 'pending' | 'running' | 'completed' | 'failed' | 'degraded' | 'cancelled';
	startedAt: string | null;
	finishedAt: string | null;
	agentTests: string[];
	activity: AgentActivityEvent[];
	executions: AgentLabExecution[];
	providerExecutions: Record<string, unknown>[];
	assignments: Record<string, unknown>[];
	governance: Record<string, unknown>[];
	accounting: Record<string, unknown>;
	assertions: AgentLabAssertion[];
	diagnostics: string[];
};

export type AgentLabSnapshot = {
	schemaVersion: 'treeseed.agent-simulation/v2';
	sceneId: string;
	runId: string;
	status: 'starting' | 'running' | 'completed' | 'failed' | 'cleaning';
	presentation: AgentLabPresentation;
	timeZone: string;
	generatedAt: string;
	team: { id: string | null; name: string | null; isolation: 'ephemeral' | 'team' };
	provider: { id: string | null; membershipId: string | null; executionProviderId: 'codex'; status: string };
	repositories: Array<{ slug: string; projectId: string | null; repositoryId: string | null; ref: string | null }>;
	agents: AgentLabAgent[];
	workdays: AgentLabWorkdaySnapshot[];
	cleanup: { status: 'pending' | 'running' | 'completed' | 'failed'; diagnostics: string[] };
	diagnostics: string[];
};

export type AgentLabPresentationAdapter = {
	id: AgentLabPresentation;
	label: string;
	description: string;
	render(snapshot: AgentLabSnapshot): string;
};

export type AgentLabRunUpdate = {
	snapshot: AgentLabSnapshot;
};

export type AgentLabExecutorInput = {
	projectRoot: string;
	config: AgentLabSceneConfig;
	sceneId: string;
	runId: string;
	reportPath: string;
	onUpdate(update: AgentLabRunUpdate): Promise<void> | void;
};

export type AgentLabExecutor = (input: AgentLabExecutorInput) => Promise<AgentLabSnapshot>;
