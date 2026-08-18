import type { ProjectWorkflowOperation, WorkflowOperationArtifact, WorkflowOperationRun } from '../../../../secrets-capability/workflow-operation-contracts.ts';
import { MarketClient } from '../../../../entrypoints/clients/market-client.ts';

export function projectWorkflowOperationsMethod(this: MarketClient, projectId: string) {
	return this.request<{ ok: true; payload: ProjectWorkflowOperation[] }>(
		`/v1/projects/${encodeURIComponent(projectId)}/workflow-operations`, { requireAuth: true });
}

export function projectWorkflowOperationRunsMethod(this: MarketClient, projectId: string, options: { operationId?: string; limit?: number } = {}) {
	const query = new URLSearchParams();
	if (options.operationId) query.set('operationId', options.operationId);
	if (options.limit) query.set('limit', String(options.limit));
	const suffix = query.size ? `?${query.toString()}` : '';
	return this.request<{ ok: true; payload: WorkflowOperationRun[] }>(
		`/v1/projects/${encodeURIComponent(projectId)}/workflow-operation-runs${suffix}`, { requireAuth: true });
}

export function workflowOperationRunMethod(this: MarketClient, runId: string) {
	return this.request<{ ok: true; payload: WorkflowOperationRun }>(
		`/v1/workflow-operation-runs/${encodeURIComponent(runId)}`, { requireAuth: true });
}

export function cancelWorkflowOperationRunMethod(this: MarketClient, runId: string) {
	return this.request<{ ok: true; code: string; payload: WorkflowOperationRun }>(
		`/v1/workflow-operation-runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST', requireAuth: true });
}

export function workflowOperationArtifactsMethod(this: MarketClient, runId: string) {
	return this.request<{ ok: true; payload: WorkflowOperationArtifact[] }>(
		`/v1/workflow-operation-runs/${encodeURIComponent(runId)}/artifacts`, { requireAuth: true });
}

export async function downloadWorkflowOperationArtifactMethod(this: MarketClient, runId: string, artifactId: string) {
	const headers: Record<string, string> = { accept: 'application/zip' };
	if (this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;
	if (this.userAgent) headers['user-agent'] = this.userAgent;
	const response = await this.fetchImpl(`${this.baseUrl}/v1/workflow-operation-runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}/download`, { headers });
	if (!response.ok) throw new Error(`Workflow artifact download failed with ${response.status}.`);
	return response;
}
