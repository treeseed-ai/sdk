import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBuiltInTreeseedScenePluginRegistry } from '../../../src/scenes/index.ts';

const servers: Server[] = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))));
});

async function listen(handler: Parameters<typeof createServer>[0]) {
	const server = createServer(handler);
	servers.push(server);
	return new Promise<string>((resolvePromise) => {
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') throw new Error('bad address');
			resolvePromise(`http://127.0.0.1:${address.port}`);
		});
	});
}

function locator(visible = true) {
	return {
		waitFor: vi.fn(async () => undefined),
		click: vi.fn(async () => undefined),
		fill: vi.fn(async () => undefined),
		selectOption: vi.fn(async () => undefined),
		isVisible: vi.fn(async () => visible),
		first() {
			return this;
		},
	};
}

function context(overrides: Partial<any> = {}) {
	const timelineEvents: Array<{ event: string; data: unknown; stepId?: string }> = [];
	const progressEvents: Array<{ event: string; data: unknown; meta?: unknown }> = [];
	const page = {
		goto: vi.fn(async (url: string) => ({ status: () => 200, url: () => url })),
		keyboard: { press: vi.fn(async () => undefined) },
		getByText: vi.fn(() => locator(true)),
		url: vi.fn(() => 'http://local/app'),
	};
	return {
		projectRoot: process.cwd(),
		scene: { id: 'scene-a' },
		environment: 'local',
		baseUrl: 'http://local',
		runId: 'Run 123',
		session: { page },
		resolveUrl: (value: string) => value.startsWith('http') ? value : `http://local${value}`,
		resolveSelector: vi.fn(() => locator(true)),
		sleep: vi.fn(async () => undefined),
		timeline: { push: vi.fn((event: string, data: unknown, stepId?: string) => timelineEvents.push({ event, data, stepId })) },
		progress: { push: vi.fn((event: string, data: unknown, meta?: unknown) => progressEvents.push({ event, data, meta })) },
		operationReports: [],
		linkedOperationIds: [],
		operationWaiter: vi.fn(async (input: any) => {
			await input.onUpdate?.({ operationId: 'op-1', finalStatus: 'completed' });
			return { ok: true, operationId: 'op-1', finalStatus: 'completed', diagnostics: [] };
		}),
		interactive: true,
		pauseController: vi.fn(async () => ({ ok: true, diagnostics: [] })),
		...overrides,
	};
}

const step = { id: 'step-a', title: 'Step A' };

describe('built-in scene plugin handlers', () => {
	it('runs browser actions and invalid action diagnostics', async () => {
		const registry = createBuiltInTreeseedScenePluginRegistry();
		const ctx = context();
		expect((await registry.actions.get('goto')!.run({ action: { goto: '/app' }, step, context: ctx } as never)).ok).toBe(true);
		const retryCtx = context({
			session: {
				page: {
					goto: vi.fn()
						.mockRejectedValueOnce(new Error('ECONNRESET'))
						.mockResolvedValueOnce({ status: () => 200, url: () => 'http://local/retry' }),
					keyboard: { press: vi.fn(async () => undefined) },
				},
			},
			sleep: vi.fn(async () => undefined),
		});
		expect((await registry.actions.get('goto')!.run({ action: { goto: '/retry' }, step, context: retryCtx } as never)).ok).toBe(true);
		const httpErrorCtx = context({
			session: {
				page: {
					goto: vi.fn(async () => ({ status: () => 503, url: () => 'http://local/down' })),
					keyboard: { press: vi.fn(async () => undefined) },
				},
			},
		});
		await expect(registry.actions.get('goto')!.run({ action: { goto: '/down' }, step, context: httpErrorCtx } as never)).rejects.toMatchObject({ code: 'scene.navigation_http_error' });
		const fallbackHttpCtx = context({
			session: { page: { goto: vi.fn(async () => ({ status: () => 502, url: () => undefined })), keyboard: { press: vi.fn(async () => undefined) } } },
			sleep: vi.fn(async () => undefined),
		});
		await expect(registry.actions.get('goto')!.run({ action: { goto: '/fallback-url' }, step, context: fallbackHttpCtx } as never)).rejects.toMatchObject({
			code: 'scene.navigation_http_error',
			message: expect.stringContaining('http://local/fallback-url'),
		});
		const nullFailureCtx = context({
			session: { page: { goto: vi.fn(async () => Promise.reject(null)), keyboard: { press: vi.fn(async () => undefined) } } },
		});
		await expect(registry.actions.get('goto')!.run({ action: { goto: '/null-failure' }, step, context: nullFailureCtx } as never)).rejects.toThrow('Navigation failed');
		expect((await registry.actions.get('click')!.run({ action: { click: { role: 'button', name: 'Save' } }, step, context: ctx } as never)).ok).toBe(true);
		expect((await registry.actions.get('click')!.run({ action: {}, step, context: ctx } as never)).diagnostics[0]?.code).toBe('scene.invalid_action');
		expect((await registry.actions.get('fill')!.run({ action: { fill: { label: 'Name', value: 'Value {{runShort}}' } }, step, context: ctx } as never)).ok).toBe(true);
		expect((await registry.actions.get('fill')!.run({ action: {}, step, context: ctx } as never)).diagnostics[0]?.code).toBe('scene.invalid_action');
		expect(ctx.resolveSelector().fill).toBeDefined();
		expect((await registry.actions.get('select')!.run({ action: { select: { label: 'Mode', value: 'auto' } }, step, context: ctx } as never)).ok).toBe(true);
		expect((await registry.actions.get('select')!.run({ action: { select: { css: 'select[name="mode"]', internal: true, label: 'Automatic' } }, step, context: ctx } as never)).ok).toBe(true);
		expect((await registry.actions.get('select')!.run({ action: { select: { label: 'Mode' } }, step, context: ctx } as never)).ok).toBe(true);
		expect((await registry.actions.get('select')!.run({ action: { select: { label: 'Mode' } }, step, context: { ...ctx, resolveSelector: () => ({ waitFor: async () => undefined }) } } as never)).ok).toBe(false);
		expect((await registry.actions.get('select')!.run({ action: {}, step, context: ctx } as never)).diagnostics[0]?.code).toBe('scene.invalid_action');
		expect((await registry.actions.get('keyboard')!.run({ action: { keyboard: 'Tab' }, step, context: ctx } as never)).ok).toBe(true);
		expect((await registry.actions.get('keyboard')!.run({ action: {}, step, context: ctx } as never)).diagnostics[0]?.code).toBe('scene.invalid_action');
		expect((await registry.actions.get('apiRequest')!.run({ action: {}, step, context: ctx } as never)).ok).toBe(false);
		expect((await registry.actions.get('goto')!.run({ action: {}, step, context: ctx } as never)).diagnostics[0]?.code).toBe('scene.invalid_action');
	});

	it('runs pause and operation action branches', async () => {
		const registry = createBuiltInTreeseedScenePluginRegistry();
		const timedContext = context();
		expect((await registry.actions.get('pause')!.run({ action: { pause: { mode: 'timed', durationSeconds: 0.01 } }, step, context: timedContext } as never)).ok).toBe(true);
		expect((await registry.actions.get('pause')!.run({ action: { pause: { mode: 'timed' } }, step, context: timedContext } as never)).ok).toBe(true);
		expect((await registry.actions.get('pause')!.run({ action: { pause: { mode: 'manual', prompt: 'Continue?' } }, step, context: context() } as never)).ok).toBe(true);
		expect((await registry.actions.get('pause')!.run({ action: { pause: { mode: 'manual' } }, step, context: context({ interactive: false, pauseController: null }) } as never)).ok).toBe(false);
		expect((await registry.actions.get('pause')!.run({ action: {}, step, context: context() } as never)).ok).toBe(false);
		const opContext = context();
		const op = await registry.actions.get('waitForOperation')!.run({ action: { waitForOperation: { operationId: 'op-1' } }, step, context: opContext } as never);
		expect(op.ok).toBe(true);
		expect(opContext.linkedOperationIds).toContain('op-1');
		expect((await registry.actions.get('waitForOperation')!.run({ action: {}, step, context: opContext } as never)).ok).toBe(false);
	});

	it('runs browser and operation assertions', async () => {
		const registry = createBuiltInTreeseedScenePluginRegistry();
		expect((await registry.assertions.get('visible')!.run({ value: [{ text: 'Hello' }], step, context: context() } as never)).status).toBe('passed');
		expect((await registry.assertions.get('visible')!.run({ value: [], step, context: context() } as never)).status).toBe('passed');
		expect((await registry.assertions.get('visible')!.run({ value: null, step, context: context() } as never)).status).toBe('passed');
		expect((await registry.assertions.get('visible')!.run({ value: [{ text: 'Missing' }], step, context: context({ resolveSelector: () => locator(false) }) } as never)).status).toBe('failed');
		expect((await registry.assertions.get('text')!.run({ value: 'Hello', step, context: context() } as never)).status).toBe('passed');
		expect((await registry.assertions.get('text')!.run({ value: 'Missing', step, context: context({ session: { page: { getByText: () => locator(false), url: () => 'http://local' } } }) } as never)).status).toBe('failed');
		expect((await registry.assertions.get('text')!.run({ value: null, step, context: context() } as never)).status).toBe('passed');
		const nullAssertion = await registry.assertions.get('visible')!.run({
			value: [{ text: 'Null failure' }], step,
			context: context({ resolveSelector: () => ({ ...locator(), waitFor: async () => Promise.reject(null) }) }),
		} as never);
		expect(nullAssertion).toMatchObject({ status: 'failed', message: 'Assertion failed.' });
		expect((await registry.assertions.get('urlIncludes')!.run({ value: '/app', step, context: context() } as never)).status).toBe('passed');
		const now = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(10_000);
		expect((await registry.assertions.get('urlIncludes')!.run({ value: '/missing', step, context: context({ session: { page: { url: () => 'http://local/app' } } }) } as never)).status).toBe('failed');
		now.mockRestore();
		const opContext = context();
		expect((await registry.assertions.get('operation')!.run({ value: { operationId: 'op-1' }, step, context: opContext } as never)).status).toBe('passed');
		expect((await registry.assertions.get('operation')!.run({ value: { operationId: 'op-2' }, step, context: context({ operationWaiter: async () => ({ ok: false, operationId: 'op-2', finalStatus: 'failed', diagnostics: [] }) }) } as never)).status).toBe('failed');
	});

	it('confirms Mailpit links, handles display branches, and reports failures', async () => {
		const registry = createBuiltInTreeseedScenePluginRegistry();
		const baseUrl = await listen((request, response) => {
			response.setHeader('content-type', 'application/json');
			if (request.url === '/api/v1/messages') {
				response.end(JSON.stringify({ messages: [{ ID: 'message-1', Subject: 'Confirm Run 123', To: [{ Address: 'user@example.test' }] }] }));
				return;
			}
			if (request.url === '/api/v1/message/message-1') {
				response.end(JSON.stringify({ HTML: '<a href="http://api.local/auth/confirm-email?token=abc">Confirm</a>' }));
				return;
			}
			response.statusCode = 404;
			response.end(JSON.stringify({ ok: false }));
		});
		const ctx = context();
		const result = await registry.actions.get('mailpitConfirmLatest')!.run({
			action: { mailpitConfirmLatest: { mailpitUrl: baseUrl, email: 'user@example.test', subjectIncludes: '{{runId}}', displayInboxSeconds: 0.01, displayMessageSeconds: 0.01 } },
			step,
			context: ctx,
		} as never);
		expect(result.ok).toBe(true);
		expect(ctx.session.page.goto).toHaveBeenCalledWith('http://local/auth/confirm-email?token=abc', expect.anything());
		expect((await registry.actions.get('mailpitConfirmLatest')!.run({ action: {}, step, context: ctx } as never)).ok).toBe(false);

		const missingMessageUrl = await listen((_request, response) => {
			response.setHeader('content-type', 'application/json');
			response.end(JSON.stringify({ messages: [] }));
		});
		expect((await registry.actions.get('mailpitConfirmLatest')!.run({ action: { mailpitConfirmLatest: { mailpitUrl: missingMessageUrl, email: 'none@example.test' } }, step, context: context() } as never)).diagnostics[0]?.code).toBe('scene.mailpit_message_not_found');

		const unavailableUrl = await listen((_request, response) => {
			response.statusCode = 500;
			response.end('nope');
		});
		expect((await registry.actions.get('mailpitConfirmLatest')!.run({ action: { mailpitConfirmLatest: { mailpitUrl: unavailableUrl, email: 'user@example.test' } }, step, context: context() } as never)).diagnostics[0]?.code).toBe('scene.mailpit_unavailable');

		const noLinkUrl = await listen((request, response) => {
			response.setHeader('content-type', 'application/json');
			if (request.url === '/api/v1/messages') {
				response.end(JSON.stringify({ Messages: [{ Id: 'message-2', subject: 'Confirm', recipients: ['user@example.test'] }] }));
				return;
			}
			response.end(JSON.stringify({ text: 'No link here' }));
		});
		expect((await registry.actions.get('mailpitConfirmLatest')!.run({ action: { mailpitConfirmLatest: { mailpitUrl: `${noLinkUrl}/`, email: 'user@example.test' } }, step, context: context() } as never)).diagnostics[0]?.code).toBe('scene.mailpit_confirm_link_not_found');

		const malformedUrl = await listen((_request, response) => {
			response.setHeader('content-type', 'application/json');
			response.end(JSON.stringify({ messages: [null, { To: ['user@example.test'], Subject: 'Confirm' }] }));
		});
		expect((await registry.actions.get('mailpitConfirmLatest')!.run({ action: { mailpitConfirmLatest: { mailpitUrl: malformedUrl, email: 'user@example.test' } }, step, context: context() } as never)).diagnostics[0]?.code).toBe('scene.mailpit_message_not_found');

		const primitivePayloadUrl = await listen((request, response) => {
			response.setHeader('content-type', 'application/json');
			if (request.url === '/api/v1/messages') {
				response.end(JSON.stringify({ messages: [null, { ID: 'primitive', Subject: 'Confirm', To: [null, 42, { Email: 'user@example.test' }] }] }));
				return;
			}
			response.end(JSON.stringify('not-an-object'));
		});
		expect((await registry.actions.get('mailpitConfirmLatest')!.run({ action: { mailpitConfirmLatest: { mailpitUrl: primitivePayloadUrl, email: 'user@example.test' } }, step, context: context() } as never)).diagnostics[0]?.code).toBe('scene.mailpit_confirm_link_not_found');

		const primitiveListUrl = await listen((_request, response) => {
			response.setHeader('content-type', 'application/json');
			response.end(JSON.stringify(null));
		});
		expect((await registry.actions.get('mailpitConfirmLatest')!.run({ action: { mailpitConfirmLatest: { mailpitUrl: primitiveListUrl, email: 'user@example.test' } }, step, context: context() } as never)).diagnostics[0]?.code).toBe('scene.mailpit_message_not_found');
	});

	it('handles Mailpit recipient/body variants and message fetch failures', async () => {
		const registry = createBuiltInTreeseedScenePluginRegistry();
		const inviteUrl = await listen((request, response) => {
			response.setHeader('content-type', 'application/json');
			if (request.url === '/api/v1/messages') {
				response.end(JSON.stringify({
					Messages: [
						{ id: 'ignored', subject: 'Other', recipients: [{ email: 'other@example.test' }] },
						{ id: 'invite-1', subject: 'Invite Run 123', Recipients: [{ email: 'user@example.test' }] },
					],
				}));
				return;
			}
			if (request.url === '/api/v1/message/invite-1') {
				response.end(JSON.stringify({ Html: 'Accept &amp; join <a href="/team-invites/team-1/accept">Accept</a>', Text: 'fallback' }));
				return;
			}
			response.statusCode = 404;
			response.end(JSON.stringify({ ok: false }));
		});
		const ctx = context();
		const invite = await registry.actions.get('mailpitConfirmLatest')!.run({
			action: { mailpitConfirmLatest: { mailpitUrl: inviteUrl, email: 'user@example.test', subjectIncludes: 'Run 123' } },
			step,
			context: ctx,
		} as never);
		expect(invite.ok).toBe(true);
		expect(ctx.session.page.goto).toHaveBeenCalledWith('http://local/team-invites/team-1/accept', expect.anything());

		const badMessagesUrl = await listen((_request, response) => {
			response.setHeader('content-type', 'application/json');
			response.end(JSON.stringify({ messages: 'not-an-array' }));
		});
		expect((await registry.actions.get('mailpitConfirmLatest')!.run({ action: { mailpitConfirmLatest: { mailpitUrl: badMessagesUrl, email: 'user@example.test' } }, step, context: context() } as never)).diagnostics[0]?.code).toBe('scene.mailpit_message_not_found');

		const missingDetailUrl = await listen((request, response) => {
			response.setHeader('content-type', 'application/json');
			if (request.url === '/api/v1/messages') {
				response.end(JSON.stringify({ messages: [{ ID: 'message-500', Subject: 'Confirm', To: [{ address: 'user@example.test' }] }] }));
				return;
			}
			response.statusCode = 500;
			response.end(JSON.stringify({ ok: false }));
		});
		expect((await registry.actions.get('mailpitConfirmLatest')!.run({ action: { mailpitConfirmLatest: { mailpitUrl: missingDetailUrl, email: 'user@example.test' } }, step, context: context() } as never)).diagnostics[0]?.message).toContain('message message-500 returned HTTP 500');

		const thrownNavigation = context({
			session: {
				page: {
					goto: vi.fn(async () => { throw 'ECONNRESET'; }),
					keyboard: { press: vi.fn(async () => undefined) },
				},
			},
		});
		await expect(registry.actions.get('goto')!.run({ action: { goto: '/reset' }, step, context: thrownNavigation } as never)).rejects.toThrow('ECONNRESET');
	});

	it('exposes deterministic narration generation', () => {
		const registry = createBuiltInTreeseedScenePluginRegistry();
		const narration = registry.narration.get('deterministic-narration')!;
		const entries = narration.generate({
			scene: { id: 'scene-a', title: 'Scene A' },
			run: { steps: [{ id: 'open', title: 'Open', status: 'passed' }] },
			transcript: [{ stepId: 'open', text: 'Open the app.' }],
			style: 'concise',
		} as never);
		expect(entries.length).toBeGreaterThan(0);
	});
});
