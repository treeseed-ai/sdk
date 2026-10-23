import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { ControlPlaneClient } from '../../../../src/entrypoints/clients/control-plane-client.ts';
import { CONTROL_PLANE_OPERATIONS } from '../../../../src/operator-contracts/index.ts';

// The public client, request schemas and HTTP transport are real. Server replies
// are controlled inputs, not workday admission, authentication or agent usage.
it('native manual and scheduled workday requests preserve group-derived scope and deny an unscoped audience before HTTP', async () => {
	const requests: Array<{ path?: string; body: unknown }> = []; let status = 200;
	const server = createServer(async (request, response) => {
		let bytes = ''; for await (const chunk of request) bytes += String(chunk);
		requests.push({ path: request.url, body: JSON.parse(bytes) });
		response.writeHead(status, { 'content-type': 'application/json' });
		response.end(JSON.stringify(status === 200 ? { data: { marker: 'controlled-public-response' } }
			: { title: 'Controlled upstream denial', code: 'group_workday_denied', status }));
	});
	try {
		await new Promise<void>((resolve,reject)=>{ server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
		const address = server.address(); if (!address || typeof address === 'string') throw new Error('Native HTTP address required');
		const client = new ControlPlaneClient({ profile: { serverId: 'local', label: 'Local', baseUrl: `http://127.0.0.1:${address.port}` } });
		const base = { profileId: 'default', projects: ['ui','admin'], startsAt: '2030-01-01T00:00:00Z', durationSeconds: 600 };
		for (const scheduled of [false,true]) {
			const invoke = (intent: Record<string,unknown>) => client.invoke(scheduled ? CONTROL_PLANE_OPERATIONS.workdays.createSchedule
				: CONTROL_PLANE_OPERATIONS.workdays.preflight, { path: { teamId: 'portfolio' }, query: {},
					body: scheduled ? { intent, cadenceSeconds: 3600 } : intent });
			const count = requests.length;
			for (const unscoped of [base, { ...base, projects: 'all' }, { ...base, agentSelection: { activityTypes: ['planning'] } }]) {
				const held = structuredClone(unscoped); await expect(invoke(unscoped)).rejects.toThrow('Select shared groups');
				expect(unscoped).toEqual(held); expect(requests).toHaveLength(count);
			}
			for (const field of ['groupIds','proposalIds','decisionIds']) {
				const scoped = { ...base, [field]: ['portfolio-runtime'] }, held = structuredClone(scoped);
				await expect(invoke(scoped)).resolves.toEqual({ data: { marker: 'controlled-public-response' } });
				expect(requests.at(-1)).toEqual({ path: scheduled ? '/v1/teams/portfolio/workday-schedules' : '/v1/teams/portfolio/workday-runs/preflight',
					body: scheduled ? { intent: scoped, cadenceSeconds: 3600 } : scoped });
				expect(scoped).toEqual(held);
			}
			const scoped = { ...base, groupIds: ['portfolio-runtime'] };
			status = 403; await expect(invoke(scoped)).rejects.toMatchObject({ status: 403, problem: { code: 'group_workday_denied' } });
			const denied = structuredClone(requests); status = 200; await expect(invoke(scoped)).resolves.toMatchObject({ data: { marker: 'controlled-public-response' } });
			expect(requests.slice(0,-1)).toEqual(denied);
		}
		expect(requests).toHaveLength(10);
	} finally { server.closeAllConnections(); if (server.listening) await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())); }
	expect(server.listening).toBe(false);
});
