export type WorkflowConfigurationScope = 'repository' | 'environment' | 'organization';

export type WorkflowConfigurationRequirement = {
	name: string;
	scope: WorkflowConfigurationScope;
	environment?: string | null;
	required: boolean;
};

export type ProjectWorkflowOperation = {
	id: string;
	projectId: string;
	teamId: string;
	workflowBindingId: string;
	repositoryBindingId: string;
	workflowId: string;
	refPolicy: string[];
	allowedInputs: Record<string, { required: boolean; pattern?: string; maximumLength?: number }>;
	requiredSecrets: WorkflowConfigurationRequirement[];
	requiredVariables: WorkflowConfigurationRequirement[];
	actorPolicy: string[];
	modePolicy: Array<'planning' | 'acting' | 'operator'>;
	version: number;
};

export type WorkflowOperationRun = {
	id: string;
	operationId: string;
	projectId: string;
	teamId: string;
	actorType: 'user' | 'operator' | 'capacity_provider';
	actorId: string;
	mode: 'planning' | 'acting' | 'operator';
	assignmentId?: string | null;
	handleId?: string | null;
	providerId: string;
	providerRunId?: string | null;
	providerRunUrl?: string | null;
	sourceSha: string;
	ref: string;
	correlationId: string;
	status: 'authorizing' | 'queued' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'unknown';
	artifacts: WorkflowOperationArtifact[];
	createdAt: string;
	updatedAt: string;
};

export type WorkflowOperationArtifact = {
	id: string;
	name: string;
	sizeBytes: number;
	expired: boolean;
	digest?: string | null;
	createdAt?: string | null;
	expiresAt?: string | null;
};

export interface WorkflowExecutionAdapter {
	readonly providerId: string;
	dispatch(input: {
		operation: ProjectWorkflowOperation;
		run: WorkflowOperationRun;
		inputs: Record<string, string>;
	}): Promise<{ providerRunId: string; providerRunUrl?: string | null }>;
	observe(run: WorkflowOperationRun): Promise<WorkflowOperationRun>;
	cancel(run: WorkflowOperationRun): Promise<WorkflowOperationRun>;
}

export interface WorkflowConfigurationAdapter {
	readonly providerId: string;
	listPresence(input: { repositoryId: string; requirements: WorkflowConfigurationRequirement[] }): Promise<Record<string, boolean>>;
	putEncryptedSecret(input: { repositoryId: string; requirement: WorkflowConfigurationRequirement; keyId: string; ciphertext: string }): Promise<void>;
	deleteSecret(input: { repositoryId: string; requirement: WorkflowConfigurationRequirement }): Promise<void>;
	readVariables(input: { repositoryId: string; requirements: WorkflowConfigurationRequirement[] }): Promise<Record<string, string>>;
	putVariable(input: { repositoryId: string; requirement: WorkflowConfigurationRequirement; value: string }): Promise<void>;
}
