import type { MarketClient } from '../../../entrypoints/clients/market-client.ts';

export interface TeamLifecycleResult {
	ok: boolean;
	code?: string;
	message?: string;
	team?: {
		id: string;
		name: string;
		status: 'active' | 'archived';
		lifecycleVersion: number;
		restoreDeadlineAt?: string | null;
	};
}

export function archiveTeamMethod(
	this: MarketClient,
	teamId: string,
	lifecycleVersion: number,
) {
	return this.request<TeamLifecycleResult>(`/v1/teams/${encodeURIComponent(teamId)}/archive`, {
		method: 'POST',
		body: { lifecycleVersion },
		requireAuth: true,
	});
}

export function restoreTeamMethod(
	this: MarketClient,
	teamId: string,
	lifecycleVersion: number,
) {
	return this.request<TeamLifecycleResult>(`/v1/teams/${encodeURIComponent(teamId)}/restore`, {
		method: 'POST',
		body: { lifecycleVersion },
		requireAuth: true,
	});
}

export function teamDeletionReadinessMethod(this: MarketClient, teamId: string) {
	return this.request<{
		ok: boolean;
		ready: boolean;
		code?: string;
		message?: string;
		team: TeamLifecycleResult['team'];
		blockers: Array<Record<string, unknown>>;
	}>(`/v1/teams/${encodeURIComponent(teamId)}/deletion-readiness`, { requireAuth: true });
}

export function deleteTeamPermanentlyMethod(
	this: MarketClient,
	teamId: string,
	input: {
		confirmation: string;
		currentPassword?: string;
		reauthenticationGrantId?: string;
		localAcceptanceCleanup?: boolean;
	},
) {
	return this.request<TeamLifecycleResult>(`/v1/teams/${encodeURIComponent(teamId)}/permanent-delete`, {
		method: 'DELETE',
		body: input,
		requireAuth: true,
	});
}
