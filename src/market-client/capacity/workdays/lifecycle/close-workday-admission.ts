import { MarketClient } from '../../../../entrypoints/clients/market-client.ts';

export interface WorkdayAdmissionFence {
	schemaVersion: 'treeseed.capacity-workday-admission-fence/v1';
	teamId: string;
	runId: string;
	closedEnvelopes: number;
	envelopes: { total: number; active: number };
	assignments: { total: number; completed: number; failed: number; nonTerminal: number; unsettled: number };
	modeRuns: { total: number; failed: number; nonTerminal: number };
	ready: boolean;
	successful: boolean;
	problemAssignmentIds: string[];
}

export function closeWorkdayAdmissionMethod(this: MarketClient,teamId: string,runId: string,body: { idempotencyKey: string }) {
	return this.request<{ ok: true; payload: WorkdayAdmissionFence }>(
		`/v1/teams/${encodeURIComponent(teamId)}/workday-runs/${encodeURIComponent(runId)}/close-admission`,
		{ method: 'POST',body,requireAuth: true },
	);
}
