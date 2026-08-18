import { MarketClient } from '../../../../entrypoints/clients/market-client.ts';

export function preflightWorkdayRunMethod(this: MarketClient, teamId: string, body: Record<string, unknown>) {
	return this.request<{
		ok: true;
		payload: Record<string, unknown>;
	}>(`/v1/teams/${encodeURIComponent(teamId)}/workday-runs/preflight`, { method: 'POST', body, requireAuth: true });
}
