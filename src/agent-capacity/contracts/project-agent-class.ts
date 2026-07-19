import type { AgentExecutionMode } from './assignment-records.ts';

export type ProjectAgentClassStatus = 'active' | 'paused' | 'archived';

export interface AgentKernelProfile {
	id?: string;
	name?: string;
	defaultMode?: AgentExecutionMode;
	allowedModes?: AgentExecutionMode[];
	planningBudgetPercent?: number;
	actingBudgetPercent?: number;
	maxConcurrentModeRuns?: number;
	fallbackMode?: AgentExecutionMode | null;
	metadata?: Record<string, unknown>;
}

export interface AgentKernelPolicy {
	modeSelection?: Record<string, unknown>;
	budgetSplit?: Record<string, unknown>;
	fallback?: Record<string, unknown>;
	outputValidation?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

export interface ProjectAgentClass {
	id: string;
	teamId: string;
	projectId: string;
	slug: string;
	name: string;
	status: ProjectAgentClassStatus;
	allowedModes: AgentExecutionMode[];
	requiredCapabilities: string[];
	kernelProfile: AgentKernelProfile;
	kernelPolicy: AgentKernelPolicy;
	handlerRefs: Record<string, unknown>;
	outputContracts: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}
