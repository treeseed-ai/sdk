import { describe, expect, it, vi } from 'vitest';
import type { MarketClient } from '../../../src/market-client.ts';
import { deleteLocalCapacityAcceptanceTeam } from '../../../src/reconcile/live-acceptance-capacity-scope.ts';

describe('isolated capacity acceptance scope cleanup', () => {
	it('terminalizes active workdays before resolving released assignments and deleting the project aggregate', async () => {
		let projectListed = false;
		let blockersRead = 0;
		let teamBlockersRead = 0;
		const calls: string[] = [];
		const client = {
			async projects() {
				if (projectListed) return { ok: true, payload: [] };
				projectListed = true;
				return { ok: true, payload: [{ id: 'project-a', slug: 'project-a' }] };
			},
			async capacityProviderAssignments() {
				return { ok: true, payload: { items: [{ id: 'assignment-expired', status: 'expired' }], page: {} } };
			},
			async workdayRuns() {
				return { ok: true, payload: { items: [{ id: 'run-a', status: 'running' }], page: { hasMore: false } } };
			},
			async updateWorkdayRun() {
				calls.push('cancel-workday-run');
				return { ok: true, payload: { status: 'cancelled' } };
			},
			async cancelCapacityAssignment() {
				calls.push('cancel-assignment');
				return { ok: true, payload: { status: 'cancelled' } };
			},
			async projectDeletionBlockers() {
				blockersRead += 1;
				return {
					ok: true,
					payload: blockersRead === 1
						? [{ code: 'active_workday', id: 'workday-a' }]
						: [],
				};
			},
			async cancelWorkday() {
				calls.push('cancel-workday');
				return { ok: true, payload: { status: 'cancelled' } };
			},
			async deleteProject() {
				calls.push('delete-project');
				return { ok: true, payload: {} };
			},
			async teamDeletionBlockers() {
				teamBlockersRead += 1;
				calls.push('team-blockers');
				return { ok: true, payload: teamBlockersRead === 1 ? [{ code: 'catalog_item', id: 'project-a' }] : [] };
			},
			async deleteTeam() {
				calls.push('delete-team');
				return { ok: true };
			},
		} as unknown as MarketClient;

		await deleteLocalCapacityAcceptanceTeam(client, { id: 'team-a', name: 'capacity-live-acceptance-a' });

		expect(calls).toEqual([
			'cancel-workday-run',
			'cancel-workday',
			'cancel-assignment',
			'delete-project',
			'team-blockers',
			'team-blockers',
			'delete-team',
		]);
	});

	it('fails closed when nonterminal project blockers remain', async () => {
		const deleteProject = vi.fn();
		const client = {
			async projects() {
				return { ok: true, payload: [{ id: 'project-a', slug: 'project-a' }] };
			},
			async capacityProviderAssignments() {
				return { ok: true, payload: { items: [], page: {} } };
			},
			async workdayRuns() {
				return { ok: true, payload: { items: [], page: { hasMore: false } } };
			},
			async projectDeletionBlockers() {
				return { ok: true, payload: [{ code: 'active_job', id: 'job-a' }] };
			},
			deleteProject,
		} as unknown as MarketClient;

		await expect(deleteLocalCapacityAcceptanceTeam(
			client,
			{ id: 'team-a', name: 'capacity-live-acceptance-a' },
		)).rejects.toThrow('active_job:job-a');
		expect(deleteProject).not.toHaveBeenCalled();
	});
});
