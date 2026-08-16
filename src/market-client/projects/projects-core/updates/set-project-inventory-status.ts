import type { MarketClient } from '../../../../entrypoints/clients/market-client.ts';

export function archiveProjectMethod(this: MarketClient, projectId: string) {
	return this.request<{ ok: true; payload: Record<string, unknown> }>(`/v1/projects/${encodeURIComponent(projectId)}/archive`, { method: 'POST', body: {}, requireAuth: true });
}

export function restoreProjectMethod(this: MarketClient, projectId: string) {
	return this.request<{ ok: true; payload: Record<string, unknown> }>(`/v1/projects/${encodeURIComponent(projectId)}/restore`, { method: 'POST', body: {}, requireAuth: true });
}
