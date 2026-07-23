import { resolveTreeseedSceneBaseUrl } from '../base-url.ts';
import { prepareTreeseedSceneEnvironment } from '../environment.ts';
import { resolveTreeseedSceneAuth } from '../auth.ts';
import { planOrApplyTreeseedSceneSeed } from '../seed.ts';
import { sceneErrorDiagnostic } from '../diagnostics.ts';
import { createBuiltInTreeseedSceneDiagramProvider } from '../diagram-providers.ts';
import { buildTreeseedSceneNarrationEntries } from '../training-transcript.ts';
import type {
	TreeseedSceneAssertionRunReport,
	TreeseedSceneDiagnostic,
	TreeseedScenePlugin,
	TreeseedSceneRuntimePluginContext,
	TreeseedSceneSelector,
} from '../types.ts';
import { assertionReport, extractConfirmationUrl, mailpitApiUrl, mailpitMessageBody, mailpitMessageId, mailpitMessageRecipients, mailpitMessageSubject, mailpitMessages, navigateScenePage, resolveMailpitConfirmationUrl, sceneRuntimeValue, sleep } from './duration.ts';

export function createBuiltInTreeseedScenePlugins(): TreeseedScenePlugin[] {
	return [
		{
			id: 'treeseed.scene.browser-actions',
			version: '1.0.0',
			phase: 4,
			status: 'available',
			summary: 'Browser actions for Playwright-backed scene execution.',
			actions: {
				goto: {
					id: 'goto',
					phase: 2,
					status: 'available',
					summary: 'Navigate to a route or absolute URL.',
					async run({ action, context }) {
						if (!('goto' in action)) return { ok: false, diagnostics: [sceneErrorDiagnostic('scene.invalid_action', 'Expected goto action.', 'workflow.action.goto')] };
						await navigateScenePage(context.session.page, context.resolveUrl(action.goto));
						return { ok: true, diagnostics: [] };
					},
				},
				click: {
					id: 'click',
					phase: 2,
					status: 'available',
					summary: 'Click a semantic selector.',
					async run({ action, context }) {
						if (!('click' in action)) return { ok: false, diagnostics: [sceneErrorDiagnostic('scene.invalid_action', 'Expected click action.', 'workflow.action.click')] };
						const locator = context.resolveSelector(action.click);
						await locator.waitFor({ state: 'visible', timeout: 10_000 });
						await locator.click();
						return { ok: true, diagnostics: [] };
					},
				},
				fill: {
					id: 'fill',
					phase: 2,
					status: 'available',
					summary: 'Fill a semantic selector with a value.',
					async run({ action, context }) {
						if (!('fill' in action)) return { ok: false, diagnostics: [sceneErrorDiagnostic('scene.invalid_action', 'Expected fill action.', 'workflow.action.fill')] };
						const locator = context.resolveSelector(action.fill);
						await locator.waitFor({ state: 'visible', timeout: 10_000 });
						await locator.fill(sceneRuntimeValue(action.fill.value, context));
						return { ok: true, diagnostics: [] };
					},
				},
				select: {
					id: 'select',
					phase: 2,
					status: 'available',
					summary: 'Select an option in a dropdown control.',
					async run({ action, context }) {
						if (!('select' in action)) return { ok: false, diagnostics: [sceneErrorDiagnostic('scene.invalid_action', 'Expected select action.', 'workflow.action.select')] };
						const locator = context.resolveSelector(action.select);
						await locator.waitFor({ state: 'visible', timeout: 10_000 });
						if (!locator.selectOption) return { ok: false, diagnostics: [sceneErrorDiagnostic('scene.unsupported_runtime_action', 'The active browser adapter does not support select actions.', 'workflow.action.select')] };
						await locator.selectOption(action.select.value ?? { label: action.select.label ?? '' });
						return { ok: true, diagnostics: [] };
					},
				},
				keyboard: {
					id: 'keyboard',
					phase: 2,
					status: 'available',
					summary: 'Send keyboard input.',
					async run({ action, context }) {
						if (!('keyboard' in action)) return { ok: false, diagnostics: [sceneErrorDiagnostic('scene.invalid_action', 'Expected keyboard action.', 'workflow.action.keyboard')] };
						await context.session.page.keyboard.press(action.keyboard);
						return { ok: true, diagnostics: [] };
					},
				},
				apiRequest: {
					id: 'apiRequest',
					phase: 4,
					status: 'deferred',
					summary: 'API request actions are reserved for the plugin-contract extension point.',
					async run() {
						return { ok: false, diagnostics: [sceneErrorDiagnostic('scene.unsupported_runtime_action', 'Action "apiRequest" is deferred until an API action plugin is available.', 'workflow.action.apiRequest')] };
					},
				},
				pause: {
					id: 'pause',
					phase: 5,
					status: 'available',
					summary: 'Pause execution for live demos and long workflow orchestration.',
					async run({ action, step, context }) {
						if (!('pause' in action)) return { ok: false, diagnostics: [sceneErrorDiagnostic('scene.invalid_action', 'Expected pause action.', `workflow.${step.id}.action.pause`)] };
						context.timeline.push('pause.waiting', { mode: action.pause.mode, prompt: action.pause.prompt ?? null }, step.id);
						context.progress?.push('pause.waiting', { mode: action.pause.mode, prompt: action.pause.prompt ?? null }, { stepId: step.id });
						if (action.pause.mode === 'timed') {
							await context.sleep((action.pause.durationSeconds ?? 0) * 1000);
							context.timeline.push('pause.resumed', { mode: 'timed' }, step.id);
							context.progress?.push('pause.resumed', { mode: 'timed' }, { stepId: step.id });
							return { ok: true, diagnostics: [] };
						}
						if (!context.interactive || !context.pauseController) {
							return { ok: false, diagnostics: [sceneErrorDiagnostic('scene.manual_pause_requires_tty', 'Manual pause steps require an interactive terminal.', `workflow.${step.id}.action.pause`)] };
						}
						const result = await context.pauseController({
							sceneId: context.scene.id,
							stepId: step.id,
							title: step.title,
							prompt: action.pause.prompt,
						});
						if (result.ok) {
							context.timeline.push('pause.resumed', { mode: 'manual' }, step.id);
							context.progress?.push('pause.resumed', { mode: 'manual' }, { stepId: step.id });
						}
						return result;
					},
				},
				mailpitConfirmLatest: {
					id: 'mailpitConfirmLatest',
					phase: 11,
					status: 'available',
					summary: 'Confirm the latest local Mailpit email by navigating the browser to its confirmation link.',
					async run({ action, step, context }) {
						if (!('mailpitConfirmLatest' in action)) return { ok: false, diagnostics: [sceneErrorDiagnostic('scene.invalid_action', 'Expected mailpitConfirmLatest action.', `workflow.${step.id}.action.mailpitConfirmLatest`)] };
						const raw = action.mailpitConfirmLatest;
						const mailpitUrl = sceneRuntimeValue(raw.mailpitUrl, context);
						const email = sceneRuntimeValue(raw.email, context);
						const subjectIncludes = raw.subjectIncludes ? sceneRuntimeValue(raw.subjectIncludes, context) : undefined;
						const { displayInboxSeconds, displayMessageSeconds } = raw;
						try {
							const listResponse = await fetch(mailpitApiUrl(mailpitUrl, '/api/v1/messages'));
							if (!listResponse.ok) {
								return { ok: false, diagnostics: [sceneErrorDiagnostic('scene.mailpit_unavailable', `Mailpit message list returned HTTP ${listResponse.status}.`, `workflow.${step.id}.action.mailpitConfirmLatest`)] };
							}
							const list = await listResponse.json() as unknown;
							const target = mailpitMessages(list).find((message) => {
								const recipients = mailpitMessageRecipients(message);
								const subject = mailpitMessageSubject(message);
								return recipients.some((recipient) => recipient.toLowerCase() === email.toLowerCase())
									&& (!subjectIncludes || subject.toLowerCase().includes(subjectIncludes.toLowerCase()));
							});
							const id = mailpitMessageId(target);
							if (!id) {
								return { ok: false, diagnostics: [sceneErrorDiagnostic('scene.mailpit_message_not_found', `No Mailpit message found for ${email}.`, `workflow.${step.id}.action.mailpitConfirmLatest.email`)] };
							}
							const messageResponse = await fetch(mailpitApiUrl(mailpitUrl, `/api/v1/message/${encodeURIComponent(id)}`));
							if (!messageResponse.ok) {
								return { ok: false, diagnostics: [sceneErrorDiagnostic('scene.mailpit_unavailable', `Mailpit message ${id} returned HTTP ${messageResponse.status}.`, `workflow.${step.id}.action.mailpitConfirmLatest`)] };
							}
							const message = await messageResponse.json() as unknown;
							const confirmationUrl = extractConfirmationUrl(mailpitMessageBody(message));
							if (!confirmationUrl) {
								return { ok: false, diagnostics: [sceneErrorDiagnostic('scene.mailpit_confirm_link_not_found', `No confirmation link was found in Mailpit message ${id}.`, `workflow.${step.id}.action.mailpitConfirmLatest`)] };
							}
							const resolvedUrl = resolveMailpitConfirmationUrl(confirmationUrl, context);
								const mailpitBase = mailpitUrl.endsWith('/') ? mailpitUrl : `${mailpitUrl}/`;
								if (displayInboxSeconds && displayInboxSeconds > 0) {
									const search = new URL('search', mailpitBase);
									search.searchParams.set('query', `to:${email}`);
									context.timeline.push('mailpit.inbox.open', { messageId: id, email, url: search.toString() }, step.id);
									context.progress?.push('mailpit.inbox.open', { messageId: id, email }, { stepId: step.id });
									await navigateScenePage(context.session.page, search.toString());
									await context.sleep(displayInboxSeconds * 1000);
								}
								if (displayMessageSeconds && displayMessageSeconds > 0) {
									const view = new URL(`view/${encodeURIComponent(id)}`, mailpitBase);
									context.timeline.push('mailpit.message.open', { messageId: id, email, url: view.toString() }, step.id);
									context.progress?.push('mailpit.message.open', { messageId: id, email }, { stepId: step.id });
									await navigateScenePage(context.session.page, view.toString());
									await context.sleep(displayMessageSeconds * 1000);
								}
								context.timeline.push('mailpit.confirm.open', { messageId: id, email, url: resolvedUrl }, step.id);
								await navigateScenePage(context.session.page, resolvedUrl);
								return { ok: true, diagnostics: [] };
						} catch (error) {
							return { ok: false, diagnostics: [sceneErrorDiagnostic('scene.mailpit_unavailable', error instanceof Error ? error.message : String(error ?? 'Mailpit confirmation failed.'), `workflow.${step.id}.action.mailpitConfirmLatest`)] };
						}
					},
				},
			},
		},
		{
			id: 'treeseed.scene.operation-actions',
			version: '1.0.0',
			phase: 4,
			status: 'available',
			summary: 'Operation wait actions for backend workflow proof.',
			actions: {
				waitForOperation: {
					id: 'waitForOperation',
					phase: 3,
					status: 'available',
					summary: 'Wait for a linked or explicit Treeseed platform operation.',
					async run({ action, step, context }) {
						if (!('waitForOperation' in action)) return { ok: false, diagnostics: [sceneErrorDiagnostic('scene.invalid_action', 'Expected waitForOperation action.', `workflow.${step.id}.action.waitForOperation`)] };
						context.timeline.push('operation.poll.start', { spec: action.waitForOperation }, step.id);
						const report = await context.operationWaiter({
							projectRoot: context.projectRoot,
							scene: context.scene,
							environment: context.environment,
							baseUrl: context.baseUrl,
							spec: action.waitForOperation,
							linkedOperationIds: context.linkedOperationIds,
							onUpdate: async (update) => {
								context.timeline.push('operation.poll.tick', { operationId: update.operationId, status: update.finalStatus }, step.id);
							},
						});
						context.timeline.push('operation.poll.end', { ok: report.ok, operationId: report.operationId, status: report.finalStatus }, step.id);
						context.operationReports.push(report);
						if (report.operationId && !context.linkedOperationIds.includes(report.operationId)) context.linkedOperationIds.push(report.operationId);
						return { ok: report.ok, operationReport: report, diagnostics: report.diagnostics };
					},
				},
			},
		},
		{
			id: 'treeseed.scene.browser-assertions',
			version: '1.0.0',
			phase: 4,
			status: 'available',
			summary: 'Browser assertions for Playwright-backed scene execution.',
			assertions: {
				visible: {
					id: 'visible',
					phase: 2,
					status: 'available',
					summary: 'Expect selectors to be visible.',
					async run({ value, step, context }) {
						const selectors = Array.isArray(value) ? value as TreeseedSceneSelector[] : [];
						const results = [];
						for (const selector of selectors) {
							results.push(await assertionReport('visible', async () => {
								const locator = context.resolveSelector(selector);
								await locator.waitFor({ state: 'visible', timeout: 10_000 });
								if (!(await locator.isVisible())) throw sceneErrorDiagnostic('scene.selector_not_found', 'Expected selector to be visible.', `workflow.${step.id}.expect.visible`);
							}, selector));
						}
						return results.find((result) => result.status === 'failed') ?? results[0] ?? await assertionReport('visible', async () => undefined);
					},
				},
				text: {
					id: 'text',
					phase: 2,
					status: 'available',
					summary: 'Expect text to appear.',
					async run({ value, step, context }) {
						const text = String(value ?? '');
						const selector: TreeseedSceneSelector = { text };
						return assertionReport('text', async () => {
							const textLocator = context.session.page.getByText(text);
							const locator = textLocator.first ? textLocator.first() : textLocator;
							await locator.waitFor({ state: 'visible', timeout: 10_000 });
							if (!(await locator.isVisible())) throw sceneErrorDiagnostic('scene.text_not_found', `Expected text to be visible: ${text}.`, `workflow.${step.id}.expect.text`);
						}, selector);
					},
				},
				urlIncludes: {
					id: 'urlIncludes',
					phase: 2,
					status: 'available',
					summary: 'Expect the URL to include a fragment.',
					async run({ value, step, context }) {
						const expected = String(value ?? '');
						return assertionReport('urlIncludes', async () => {
							const timeoutMs = 10_000;
							const deadline = Date.now() + timeoutMs;
							let current = context.session.page.url();
							while (!current.includes(expected) && Date.now() < deadline) {
								await context.sleep(250);
								current = context.session.page.url();
							}
							if (!current.includes(expected)) {
								throw sceneErrorDiagnostic('scene.url_mismatch', `Expected URL to include "${expected}", got "${current}".`, `workflow.${step.id}.expect.urlIncludes`);
							}
						});
					},
				},
			},
		},
		{
			id: 'treeseed.scene.operation-assertions',
			version: '1.0.0',
			phase: 4,
			status: 'available',
			summary: 'Operation assertions for backend workflow proof.',
			assertions: {
				operation: {
					id: 'operation',
					phase: 3,
					status: 'available',
					summary: 'Expect a Treeseed platform operation to reach an accepted status.',
					async run({ value, step, context }) {
						return assertionReport('operation', async () => {
							context.timeline.push('operation.poll.start', { spec: value }, step.id);
							const report = await context.operationWaiter({
								projectRoot: context.projectRoot,
								scene: context.scene,
								environment: context.environment,
								baseUrl: context.baseUrl,
								spec: value as any,
								linkedOperationIds: context.linkedOperationIds,
								onUpdate: async (update) => {
									context.timeline.push('operation.poll.tick', { operationId: update.operationId, status: update.finalStatus }, step.id);
								},
							});
							context.timeline.push('operation.poll.end', { ok: report.ok, operationId: report.operationId, status: report.finalStatus }, step.id);
							context.operationReports.push(report);
							if (report.operationId && !context.linkedOperationIds.includes(report.operationId)) context.linkedOperationIds.push(report.operationId);
							if (!report.ok) throw report.diagnostics[0] ?? sceneErrorDiagnostic('scene.operation_failed', 'Operation assertion failed.', `workflow.${step.id}.expect.operation`);
						});
					},
				},
			},
		},
		{
			id: 'treeseed.scene.environment',
			version: '1.0.0',
			phase: 4,
			status: 'available',
			summary: 'Treeseed environment preparation, auth, seed, and base URL integration.',
			environment: {
				prepare: prepareTreeseedSceneEnvironment,
				resolveAuth: resolveTreeseedSceneAuth,
				prepareSeed: planOrApplyTreeseedSceneSeed,
				resolveBaseUrl: resolveTreeseedSceneBaseUrl,
			},
		},
		{
			id: 'treeseed.scene.capture.playwright',
			version: '1.0.0',
			phase: 4,
			status: 'available',
			summary: 'Built-in Playwright capture providers exposed through the plugin registry.',
			captures: Object.fromEntries(['playwright-trace', 'playwright-video', 'playwright-screenshots', 'playwright-console', 'playwright-network', 'operation-id-detection'].map((id) => [id, { id, phase: 4 as const, status: 'available' as const, summary: `Built-in capture provider: ${id}.` }])),
		},
		{
			id: 'treeseed.scene.artifacts.default',
			version: '1.0.0',
			phase: 4,
			status: 'available',
			summary: 'Default scene artifact writers exposed through the plugin registry.',
			artifacts: Object.fromEntries(['json-run', 'json-timeline', 'json-plan', 'json-normalized-scene', 'markdown-report', 'setup-json', 'managed-dev-logs'].map((id) => [id, { id, phase: 4 as const, status: 'available' as const, summary: `Built-in artifact writer: ${id}.` }])),
		},
		{
			id: 'treeseed.scene.renderer.remotion',
			version: '1.0.0',
			phase: 6,
			status: 'available',
			summary: 'Render scene timelines and browser artifacts through Remotion.',
			renderers: {
				remotion: { id: 'remotion', phase: 6, status: 'available', summary: 'Render demo, training, chapter, and failure-review videos from scene run artifacts.' },
			},
		},
		{
			id: 'treeseed.scene.diagrams.remotion',
			version: '1.0.0',
			phase: 7,
			status: 'available',
			summary: 'Built-in typed Remotion diagram providers for scene videos.',
			diagrams: {
				'treeseed-remotion-diagrams': createBuiltInTreeseedSceneDiagramProvider(),
			},
		},
		{
			id: 'treeseed.scene.training.deterministic',
			version: '1.0.0',
			phase: 8,
			status: 'available',
			summary: 'Deterministic captions, transcripts, narration scripts, glossary, and chapter clip manifests.',
			narration: {
				'deterministic-narration': {
					id: 'deterministic-narration',
					phase: 8,
					status: 'available',
					summary: 'Generate deterministic scene narration scripts from transcript entries.',
					generate({ scene, run, transcript, style }) {
						return buildTreeseedSceneNarrationEntries({ scene, run, transcript, style });
					},
				},
			},
			artifacts: Object.fromEntries(['training-json', 'training-markdown', 'training-captions', 'training-chapter-clips'].map((id) => [id, { id, phase: 8 as const, status: 'available' as const, summary: `Built-in training artifact writer: ${id}.` }])),
		},
	];
}
