import type {
	AgentLabActivityInterval,
	AgentLabDelta,
	AgentLabEntityKind,
	AgentLabEntitySummary,
	AgentLabMetricPoint,
	AgentLabMetricTargets,
	AgentLabOverview,
	AgentLabWorkdayContext,
} from '../../../../agent-capacity/contracts/support/agent-lab-monitoring.ts';
import type { MarketClient } from '../../../../entrypoints/clients/market-client.ts';

type Selection = { date?: string | null; workday?: string | null };
type DeltaSelection = Selection & { cursor?: string | null };

function path(teamId: string, suffix: string, options: Record<string, unknown> = {}) {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(options)) {
		if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
	}
	return `/v1/teams/${encodeURIComponent(teamId)}/agent-lab/${suffix}${query.size ? `?${query}` : ''}`;
}

export function agentLabWorkdayContextMethod(this: MarketClient, teamId: string, options: Selection = {}) {
	return this.request<{ ok: true; payload: AgentLabWorkdayContext }>(path(teamId, 'workday-context', options), { requireAuth: true });
}

export function agentLabOverviewMethod(this: MarketClient, teamId: string, options: Selection = {}) {
	return this.request<{ ok: true; payload: AgentLabOverview }>(path(teamId, 'overview', options), { requireAuth: true });
}

export function agentLabActivityMethod(this: MarketClient, teamId: string, options: DeltaSelection = {}) {
	return this.request<{ ok: true; payload: AgentLabDelta<AgentLabActivityInterval> }>(path(teamId, 'activity', options), { requireAuth: true });
}

export function agentLabMetricSeriesMethod(this: MarketClient, teamId: string, options: DeltaSelection = {}) {
	return this.request<{ ok: true; payload: AgentLabDelta<AgentLabMetricPoint> }>(path(teamId, 'metric-series', options), { requireAuth: true });
}

export function agentLabEntitiesMethod(this: MarketClient, teamId: string, options: Selection & {
	kind: AgentLabEntityKind; q?: string | null; status?: string | null; projectId?: string | null;
	activityProfile?: string | null; limit?: number; cursor?: string | null;
}) {
	return this.request<{ ok: true; payload: { kind: AgentLabEntityKind; items: AgentLabEntitySummary[]; page: Record<string, unknown>; total: number } }>(path(teamId, 'entities', options), { requireAuth: true });
}

export function updateAgentLabTargetsMethod(this: MarketClient, teamId: string, input: {
	targets?: AgentLabMetricTargets; expectedRevision?: string | null;
} = {}) {
	return this.request<{ ok: true; payload: { targets: AgentLabMetricTargets; revision: string } }>(path(teamId, 'targets'), {
		method: 'PATCH', body: input, requireAuth: true,
	});
}
