import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { ControlPlaneClient, ControlPlaneClientError, normalizeControlPlaneServerRegistry, resolveControlPlaneServer } from '../../src/entrypoints/clients/control-plane-client.ts';
import { CONTROL_PLANE_OPERATIONS, encodeConfirmationState } from '../../src/operator-contracts/index.ts';

describe('ControlPlaneClient', () => {
	it('normalizes decision permutations into identical direct and nested request bytes while preserving independent controls', async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ data: { marker: 'controlled-response' } }), { status: 200, headers: { 'content-type': 'application/json' } }));
		const client = new ControlPlaneClient({ profile: { serverId: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:3002' }, fetchImpl });
		const base = { schemaVersion: 'treeseed.workday-intent/v1' as const, teamId: 'team', profileId: 'default', projects: ['sdk'], startsAt: '2026-09-16T12:00:00Z', durationSeconds: 3600,
			proposalIds: ['proposal-original'], agentSelection: { agentSlugs: ['configured-arbitrary-agent'], activityTypes: ['planning'] }, allocation: { planningPercent: 20, allocationWeight: 2 } };
		const normalized = ['A', 'Z', 'a', 'a-1', 'a.1', 'a/1', 'a:1'];
		for (const nested of [false, true]) {
			for (const planningOnly of [false, true]) {
				for (const decisionIds of [undefined, normalized.map(id => ` ${id} `), [...normalized].reverse(), [normalized[3]!, normalized[6]!, normalized[0]!, normalized[5]!, normalized[2]!, normalized[4]!, normalized[1]!]]) {
					const intent = { ...base, planningOnly, ...(decisionIds === undefined ? {} : { decisionIds }) };
					const body = nested ? { intent, cadenceSeconds: 3600 } : intent;
					const before = structuredClone(body);
					await expect(client.invoke(nested ? CONTROL_PLANE_OPERATIONS.workdays.createSchedule : CONTROL_PLANE_OPERATIONS.workdays.preflight, { path: { teamId: 'team' }, query: {}, body })).resolves.toEqual({ data: { marker: 'controlled-response' } });
					const expectedIntent = { ...base, planningOnly, ...(decisionIds === undefined ? {} : { decisionIds: normalized }) };
					const expected = nested ? { intent: expectedIntent, cadenceSeconds: 3600 } : expectedIntent;
					const call = fetchImpl.mock.calls.at(-1)!;
					expect(call[0]).toBe(`http://127.0.0.1:3002/v1/teams/team/${nested ? 'workday-schedules' : 'workday-runs/preflight'}`);
					expect(call[1]!.body).toBe(JSON.stringify(expected));
					expect(body).toEqual(before);
					const serialized = JSON.parse(String(call[1]!.body));
					const transmittedIntent = nested ? serialized.intent : serialized;
					expect(Object.hasOwn(transmittedIntent, 'intentDigest')).toBe(false);
					expect(Object.hasOwn(transmittedIntent, 'preflightDigest')).toBe(false);
				}
			}
		}
		expect(fetchImpl).toHaveBeenCalledTimes(16);
	});

	it('rejects malformed decisions and all named derived identities before either workday transport without stripping caller evidence', async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'content-type': 'application/json' } }));
		const client = new ControlPlaneClient({ profile: { serverId: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:3002' }, fetchImpl });
		const base = { schemaVersion: 'treeseed.workday-intent/v1' as const, teamId: 'team', profileId: 'default', projects: 'all' as const, startsAt: '2026-09-16T12:00:00Z', durationSeconds: 3600 };
		const invalid = [
			...[[], [''], [' \t\n '], ['one', ' one '], ['same', 'same'], [null], [1], 'one', null, Array.from({ length: 65 }, (_, i) => `decision-${i}`), ['x'.repeat(201)], ['é'], ['e\u0301'], ['\uE000'], ['\u{10000}'], ['decision?']].map(decisionIds => Object.assign({}, base, { decisionIds })),
			...['executionPlanId', 'capacityPlanId', 'executionInputId', 'demandSetId'].flatMap(field => [undefined, null, '', 'derived-identity'].map(value => Object.assign({}, base, { [field]: value }))),
		];
		for (const nested of [false, true]) {
			for (const intent of invalid) {
				const body = nested ? { intent, cadenceSeconds: 3600 } : intent;
				const before = structuredClone(body);
				await expect(client.invoke(nested ? CONTROL_PLANE_OPERATIONS.workdays.createSchedule : CONTROL_PLANE_OPERATIONS.workdays.preflight, { path: { teamId: 'team' }, query: {}, body })).rejects.toThrow();
				expect(fetchImpl).not.toHaveBeenCalled();
				expect(body).toEqual(before);
			}
		}
	});

	it('native HTTP carries canonical decision bytes through concurrent calls denial retry and abort without transmitting invalid intent', async () => {
		// Only the response is a controlled input. The original SDK client and global
		// fetch own serialization and real loopback HTTP; this is not API admission.
		const received: { path: string | undefined; method: string | undefined; body: string; contentType: string | undefined }[] = [];
		let status = 200;
		const server = createServer(async (request, response) => {
			const chunks: Buffer[] = [];
			for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
			received.push({ path: request.url, method: request.method, body: Buffer.concat(chunks).toString('utf8'), contentType: request.headers['content-type'] });
			response.writeHead(status, { 'content-type': status === 200 ? 'application/json' : 'application/problem+json' });
			response.end(JSON.stringify(status === 200 ? { data: { marker: 'controlled-response' } } : { type: 'about:blank', title: 'Controlled denial', status, code: 'controlled_denial' }));
		});
		try {
			server.listen(0, '127.0.0.1');
			await once(server, 'listening');
			const address = server.address();
			if (!address || typeof address === 'string') throw new Error('Expected allocated loopback TCP address');
			const client = new ControlPlaneClient({ profile: { serverId: 'local', label: 'Local', baseUrl: `http://127.0.0.1:${address.port}` } });
			const base = { schemaVersion: 'treeseed.workday-intent/v1' as const, teamId: 'team', profileId: 'default', projects: ['sdk'], startsAt: '2026-09-16T12:00:00Z', durationSeconds: 3600,
				proposalIds: ['proposal-original'], agentSelection: { agentSlugs: ['configured-arbitrary-agent'], activityTypes: ['planning'] }, allocation: { planningPercent: 20, allocationWeight: 2 } };
			const normalized = ['A', 'Z', 'a', 'a-1', 'a.1', 'a/1', 'a:1'];
			for (const nested of [false, true]) {
				for (const planningOnly of [false, true]) {
					const binding = nested ? CONTROL_PLANE_OPERATIONS.workdays.createSchedule : CONTROL_PLANE_OPERATIONS.workdays.preflight;
					const intents = [normalized.map(id => ` ${id} `), [...normalized].reverse()].map(decisionIds => ({ ...base, planningOnly, decisionIds }));
					const bodies = intents.map(intent => nested ? { intent, cadenceSeconds: 3600 } : intent);
					const before = structuredClone(bodies);
					const expectedIntent = { ...base, planningOnly, decisionIds: normalized };
					const expected = JSON.stringify(nested ? { intent: expectedIntent, cadenceSeconds: 3600 } : expectedIntent);
					const offset = received.length;
					const results = await Promise.all(bodies.map(body => client.invoke(binding, { path: { teamId: 'team' }, query: {}, body })));
					expect(results).toEqual([{ data: { marker: 'controlled-response' } }, { data: { marker: 'controlled-response' } }]);
					expect(received.slice(offset)).toEqual(Array.from({ length: 2 }, () => ({ path: `/v1/teams/team/${nested ? 'workday-schedules' : 'workday-runs/preflight'}`, method: 'POST', body: expected, contentType: 'application/json' })));
					for (const deniedStatus of [403, 503]) {
						status = deniedStatus;
						const count = received.length;
						await expect(client.invoke(binding, { path: { teamId: 'team' }, query: {}, body: bodies[0] })).rejects.toMatchObject({ status: deniedStatus, problem: { code: 'controlled_denial' } });
						expect(received.length).toBe(count + 1);
						expect(received.at(-1)!.body).toBe(expected);
						status = 200;
						await expect(client.invoke(binding, { path: { teamId: 'team' }, query: {}, body: bodies[0] })).resolves.toEqual({ data: { marker: 'controlled-response' } });
						expect(received.length).toBe(count + 2);
						expect(received.at(-1)!.body).toBe(expected);
					}
					const abort = new AbortController(); abort.abort();
					const count = received.length;
					await expect(client.invoke(binding, { path: { teamId: 'team' }, query: {}, body: bodies[0] }, { signal: abort.signal })).rejects.toThrow();
					expect(received.length).toBe(count);
					expect(bodies).toEqual(before);
					const omittedIntent = { ...base, planningOnly };
					const omittedBody = nested ? { intent: omittedIntent, cadenceSeconds: 3600 } : omittedIntent;
					const omittedBefore = structuredClone(omittedBody);
					await expect(client.invoke(binding, { path: { teamId: 'team' }, query: {}, body: omittedBody })).resolves.toEqual({ data: { marker: 'controlled-response' } });
					expect(received.length).toBe(count + 1);
					expect(received.at(-1)!.body).toBe(JSON.stringify(omittedBody));
					expect(omittedBody).toEqual(omittedBefore);
				}
				const binding = nested ? CONTROL_PLANE_OPERATIONS.workdays.createSchedule : CONTROL_PLANE_OPERATIONS.workdays.preflight;
				const invalid = [
					...[null, [], '', true, { unknown: 1 }, ...[null, '', [''], [' '], ['same', 'same'], [null], [1],
						['x'.repeat(201)], ['provider?']].map(providerIds => ({ providerIds })),
						...[null, '', '1', 0, -1, 0.5, true, Number.NaN, Number.POSITIVE_INFINITY].map(maxConcurrency => ({ maxConcurrency }))]
						.map(operatorConstraints => Object.assign({}, base, { operatorConstraints })),
					...[undefined, null, [], '', 'sdk', 1, true, [null], [[]], [{}], [''], [' '], ['sdk', 'sdk'],
						['sdk', ' sdk '], ['sdk', null], ['x'.repeat(201)], ['sdk?']].map(projects => Object.assign({}, base, { projects })),
					...[[], [''], [' \t\n '], ['one', ' one '], ['same', 'same'], [null], [1], 'one', null, Array.from({ length: 65 }, (_, i) => `decision-${i}`), ['x'.repeat(201)], ['é'], ['e\u0301'], ['\uE000'], ['\u{10000}'], ['decision?']].map(decisionIds => Object.assign({}, base, { decisionIds })),
					...['teamId', 'profileId', 'objectiveFilters', 'proposalIds'].flatMap(field => ['é', 'id?', 'x'.repeat(201)].map(identity => Object.assign({}, base, { [field]: field === 'objectiveFilters' || field === 'proposalIds' ? [identity] : identity }))),
					...['executionPlanId', 'capacityPlanId', 'executionInputId', 'demandSetId'].flatMap(field => [undefined, null, '', 'derived-identity'].map(value => Object.assign({}, base, { [field]: value }))),
				];
				for (const intent of invalid) {
					const body = nested ? { intent, cadenceSeconds: 3600 } : intent;
					const before = structuredClone(body);
					const count = received.length;
					await expect(client.invoke(binding, { path: { teamId: 'team' }, query: {}, body })).rejects.toThrow();
					expect(received.length).toBe(count);
					expect(body).toEqual(before);
				}
			}
		expect(received).toHaveLength(28);
		for (const nested of [false, true]) {
			const intent = { schemaVersion: 'treeseed.workday-intent/v1', teamId: 'team', profileId: 'default', projects: 'all', startsAt: '2026-09-16T12:00:00Z', decisionIds: ['x'.repeat(200)] };
			const body = nested ? { intent, cadenceSeconds: 3600 } : intent, held = structuredClone(body);
			const address = server.address(); if (!address || typeof address === 'string') throw new Error('Native TCP binding required.');
			const client = new ControlPlaneClient({ profile: { serverId: 'local', label: 'Local', baseUrl: `http://127.0.0.1:${address.port}` } });
			await expect(client.invoke(nested ? CONTROL_PLANE_OPERATIONS.workdays.createSchedule : CONTROL_PLANE_OPERATIONS.workdays.preflight, { path: { teamId: 'team' }, query: {}, body })).resolves.toEqual({ data: { marker: 'controlled-response' } });
			expect(received.at(-1)!.body).toBe(JSON.stringify(body)); expect(body).toEqual(held);
		}
		expect(received).toHaveLength(30);
		} finally {
			await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
		}
		expect(server.listening).toBe(false);
	});
	it('sends authority and concurrency headers and accepts standard envelopes', async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: { id: 'project_1' } }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		}));
		const client = new ControlPlaneClient({ profile: { serverId: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:3002/' }, accessToken: 'test-token', fetchImpl });
		await expect(client.invoke(CONTROL_PLANE_OPERATIONS.providers.reportUsage, {
			path: { assignmentId: 'assignment 1' }, query: {}, body: { name: 'Example' },
		}, { idempotencyKey: 'request_1', ifMatch: '"generation_1"' }))
			.resolves.toEqual({ data: { id: 'project_1' } });
		expect(String(fetchImpl.mock.calls[0]![0])).toBe('http://127.0.0.1:3002/v1/provider/assignments/assignment%201/usage');
		const request = fetchImpl.mock.calls[0]![1]!;
		const headers = new Headers(request.headers);
		expect(headers.get('authorization')).toBe('Bearer test-token');
		expect(headers.get('idempotency-key')).toBe('request_1');
		expect(headers.get('if-match')).toBe('"generation_1"');
	});

	it('preserves only exact concurrency and contract response evidence in metadata', async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: { items: [] }, meta: { cursor: 'next' } }), {
			status: 200, headers: { 'content-type': 'application/json', etag: '"revision-7"', 'x-treeseed-contract-digest': `sha256:${'b'.repeat(64)}`, 'set-cookie': 'secret=value' },
		}));
		const client = new ControlPlaneClient({ profile: { serverId: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:3002' }, fetchImpl });
		await expect(client.invoke(CONTROL_PLANE_OPERATIONS.projects.list, { path: {}, query: {}, body: undefined })).resolves.toEqual({
			data: { items: [] }, meta: { cursor: 'next', etag: '"revision-7"', contractDigest: `sha256:${'b'.repeat(64)}` },
		});
	});

	it('projects RFC 9457 failures as typed errors', async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
			type: 'https://treeseed.dev/problems/denied', title: 'Denied', status: 403, code: 'authorization_denied',
		}), { status: 403, headers: { 'content-type': 'application/problem+json' } }));
		const client = new ControlPlaneClient({ profile: { serverId: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:3002' }, fetchImpl });
		await expect(client.invoke(CONTROL_PLANE_OPERATIONS.projects.list, {
			path: {}, query: { teamId: 'team 1', limit: 20 }, body: undefined,
		})).rejects.toMatchObject({ status: 403, problem: { code: 'authorization_denied' } });
		expect(String(fetchImpl.mock.calls[0]![0])).toBe('http://127.0.0.1:3002/v1/projects?teamId=team+1&limit=20');
	});

	it('rejects caller-constructed endpoint bindings before network access', async () => {
		const fetchImpl = vi.fn<typeof fetch>();
		const client = new ControlPlaneClient({ profile: { serverId: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:3002' }, fetchImpl });
		const forged = { ...CONTROL_PLANE_OPERATIONS.projects.list };
		await expect(client.invoke(forged, { path: {}, query: {}, body: undefined })).rejects.toThrow(/authoritative catalog binding/u);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('normalizes caller-owned server profiles without performing local persistence', () => {
		const registry = normalizeControlPlaneServerRegistry({
			version: 1,
			activeServerId: 'missing',
			servers: [{ serverId: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:3002/' }],
		});
		expect(registry.activeServerId).toBe('local');
		expect(resolveControlPlaneServer(undefined, registry)).toEqual({ serverId: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:3002' });
	});

	it('uses RFC 8628 form encoding for device authorization', async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ device_code: 'device', user_code: 'ABCD', verification_uri: 'http://local/activate', expires_in: 600, interval: 5 }), { status: 200, headers: { 'content-type': 'application/json' } }));
		const client = new ControlPlaneClient({ profile: { serverId: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:3002' }, fetchImpl });
		await expect(client.authorizeDevice('trsd', ['treeseed:read'])).resolves.toMatchObject({ deviceCode: 'device', userCode: 'ABCD' });
		expect(String(fetchImpl.mock.calls[0]![1]!.body)).toContain('client_id=trsd');
		expect(new Headers(fetchImpl.mock.calls[0]![1]!.headers).get('content-type')).toBe('application/x-www-form-urlencoded');
	});

	it('preserves OAuth protocol error codes for device polling', async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: 'authorization_pending', error_description: 'Authorization is pending.' }), { status: 400, headers: { 'content-type': 'application/json' } }));
		const client = new ControlPlaneClient({ profile: { serverId: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:3002' }, fetchImpl });
		await expect(client.exchangeDeviceCode('trsd', 'device')).rejects.toMatchObject({ status: 400, problem: { code: 'authorization_pending', detail: 'Authorization is pending.' } });
	});

	it('preserves signed input-required state for an exact confirmation retry', async () => {
		const confirmation = { schemaVersion: 'treeseed.confirmation-state/v1' as const, principalId: 'user_1', clientId: 'trsd', operationId: 'workdays.start', argumentsDigest: `sha256:${'a'.repeat(64)}` as const, expiresAt: '2030-01-01T00:00:00.000Z', nonce: 'nonce', signature: 'signature' };
		const inputRequired = { type: 'input_required', requestId: 'request_1', prompt: 'Confirm exact input.', confirmation };
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ type: 'about:blank', title: 'Confirmation required', status: 409, code: 'confirmation_required', inputRequired }), { status: 409, headers: { 'content-type': 'application/problem+json' } }));
		const client = new ControlPlaneClient({ profile: { serverId: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:3002' }, fetchImpl });
		await expect(client.invoke(CONTROL_PLANE_OPERATIONS.workdays.start, { path: { teamId: 'team_1' }, query: {}, body: {} }, { idempotencyKey: 'idempotency_1' })).rejects.toMatchObject({ problem: { code: 'confirmation_required', inputRequired } });
		expect(JSON.parse(Buffer.from(encodeConfirmationState(confirmation), 'base64url').toString('utf8'))).toEqual(confirmation);
	});
});
