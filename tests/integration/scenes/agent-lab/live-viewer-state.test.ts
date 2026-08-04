import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { expect,it } from 'vitest';
import {
	BUILT_IN_AGENT_LAB_PRESENTATIONS,
	initialAgentLabSnapshot,
	startAgentLabLiveReport,
	type AgentLabSnapshot,
} from '../../../../src/scenes/index.ts';

function viewerSnapshot(): AgentLabSnapshot {
	const snapshot = initialAgentLabSnapshot({
		sceneId: 'guide-steward-agent-lab', runId: 'viewer-state', presentation: 'race-control',
		timeZone: 'America/New_York', repositories: ['market'], workdays: [{ id: 'guide', agentTests: ['guide-steward'] }],
	});
	snapshot.status = 'running';
	snapshot.agents = [{
		id: 'guide-steward', title: 'Guide Steward', classId: 'editorial', description: 'Maintains Guide direction.',
		identity: {}, capabilities: ['content:read'], activityProfiles: [{ activityType: 'planning', handlerId: 'writer', enabled: true }],
	}];
	const day = snapshot.workdays[0]!;
	day.status = 'running';
	day.startedAt = '2026-08-03T14:00:00.000Z';
	day.activity = Array.from({ length: 24 }, (_, index) => ({
		id: `event-${index}`, sequence: index + 1, sourceEventId: `source-${index}`,
		timestamp: new Date(Date.parse(day.startedAt!) + index * 1_000).toISOString(), teamId: 'team', projectId: 'project',
		workdayId: 'workday', assignmentId: 'assignment', modeRunId: 'mode', executionRunId: 'execution',
		agentId: 'guide-steward', agentClassId: 'editorial', activityType: 'planning', handlerId: 'writer',
		capacityProviderId: 'provider', providerManagerId: 'manager', runnerId: 'runner', executionProviderId: 'codex',
		eventType: 'provider.execution.message', severity: 'info' as const, summary: `Provider message ${index}`,
		transcriptRef: 'mode-run://mode', artifactRefs: [], contextPackDigest: null, usageDelta: {}, durationMs: null,
		errorCategory: null, recoveryState: null, redactionStatus: 'sanitized' as const, payloadDigest: `digest-${index}`,
	}));
	day.assignments = [{
		id: 'assignment', status: 'leased', mode: 'planning', agentId: 'guide-steward', handlerId: 'writer',
		createdAt: day.startedAt, leaseState: 'leased', leaseExpiresAt: '2026-08-03T14:10:00.000Z',
		decisionInput: { input: { title: 'Plan the Guide update', activityType: 'planning', objective: 'Prepare governed Guide work.' }, metadata: { planningInputsStatus: 'ready' } },
		capacityEnvelope: { requiredCapabilities: ['content:read'], reservedCredits: 1 }, allowedOutputs: ['planning_note'],
	}, {
		id: 'assignment-pending', status: 'pending', mode: 'estimating', agentId: 'guide-steward', handlerId: 'writer',
		createdAt: '2026-08-03T14:00:05.000Z', leaseState: 'unleased', decisionInput: { input: { title: 'Estimate Guide work', activityType: 'estimating' } },
		capacityEnvelope: { requiredCapabilities: ['content:read'], reservedCredits: 2 }, allowedOutputs: ['estimate'],
	}] as never;
	day.accounting = { totals: { assignments: { completed: 0 }, modeRuns: { queued: 0, running: 2 } }, settlement: { warnings: [] } } as never;
	day.governance = [{ id: 'proposal-1', title: 'Authorize Guide work', status: 'accepted', summary: 'Bounded work only.',
		votes: [{ vote: 'support', reason: 'Operator authorization.' }], decision: { status: 'accepted' },
		events: [{ id: 'governance-event-1', eventType: 'proposal.voted', actorType: 'user', nextState: 'support', message: 'Operator authorization.', createdAt: day.startedAt }] }];
	day.executions = [{
		id: 'execution', assignmentId: 'assignment', modeRunId: 'mode', agentId: 'guide-steward', agentClassId: 'editorial',
		activityType: 'planning', handlerId: 'writer', projectId: 'project', status: 'running', startedAt: day.startedAt,
		finishedAt: null, providerId: 'provider', providerManagerId: 'manager', runnerId: 'runner', executionProviderId: 'codex',
		transcript: [], evidence: [{
			id: 'context-pack', timestamp: day.startedAt, kind: 'context-pack', label: 'TreeDX context pack', status: 'recorded', summary: 'Two files assembled.',
			detail: { statistics: { fileCount: 2, resultCount: 2, totalBytes: 3000, totalCharacters: 2900, tokenEstimate: 725 }, queries: [{ model: 'objective' }], files: [{ path: 'src/content/objectives/core.md', mediaType: 'text/markdown', bytes: 3000, characters: 2900, tokenEstimate: 725 }] },
		}, {
			id: 'treedx-call', timestamp: day.startedAt, kind: 'treedx-call', label: 'TreeDX query', status: 'completed', summary: 'Context query completed.', detail: { operation: 'query' },
		}, ...Array.from({ length: 18 }, (_, index) => ({
			id: `evidence-${index}`, timestamp: new Date(Date.parse(day.startedAt!) + index * 1_000).toISOString(),
			kind: 'agent-message', label: `Agent message ${index}`, status: 'recorded', summary: `Evidence ${index}`,
			detail: { message: `Complete provider-emitted message ${index}` },
		}))], signals: [{ code: 'evidence-ready', severity: 'info' }], artifacts: [], usage: {}, error: null,
		assignment: { title: 'Plan the Guide update', decisionInput: { activityType: 'planning' } },
		credits: { estimated: 1, requested: 1, reserved: 1, actual: 0, released: 0, refunded: 0, overrun: 0 },
	}];
	return snapshot;
}

it('keeps user navigation, modal dismissal, focus, disclosures, and scroll stable across live revisions', async () => {
	const previousPort = process.env.TREESEED_AGENT_SIMULATOR_PORT;
	process.env.TREESEED_AGENT_SIMULATOR_PORT = '14760';
	const initial = viewerSnapshot();
	const report = await startAgentLabLiveReport({
		path: resolve(mkdtempSync(resolve(tmpdir(), 'agent-lab-viewer-')), 'report.html'),
		adapter: BUILT_IN_AGENT_LAB_PRESENTATIONS[0]!, initial,
	});
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
		await page.goto(report.url);
		expect(await page.locator('.page-tabs a').allTextContents()).toEqual(['Monitor','Execution providers','Events','Assignments','Artifacts']);
		expect(await page.locator('a.metric').count()).toBe(9);
		await page.locator('a.metric[href*="metric=assignments"]').click();
		await expect.poll(() => page.locator('.trend').count()).toBe(1);
		await expect.poll(() => page.locator('[data-list-filters]').count()).toBe(1);
		expect(await page.locator('[data-open-entity="assignment"]').count()).toBe(2);
		await page.locator('[data-entity-id="assignment-pending"]').click();
		await expect.poll(() => page.locator('#dialog-content').textContent()).toContain('Estimate Guide work');
		await page.locator('.dialog-close').click();
		await page.locator('[data-entity-id="assignment"]').click();
		await expect.poll(() => page.locator('#command-dialog').evaluate((dialog: HTMLDialogElement) => dialog.open)).toBe(true);
		expect(await page.locator('#dialog-title').textContent()).toBe('assignment');
		expect(await page.locator('#dialog-content').textContent()).toContain('Context window');
		expect(await page.locator('#dialog-content').textContent()).toContain('3000 bytes');

		const firstEvidence = page.locator('#dialog-content details.evidence').first();
		await firstEvidence.locator(':scope > summary').click();
		await firstEvidence.locator(':scope > summary').focus();
		await page.locator('#dialog-content').evaluate((content) => { content.scrollTop = 180; });
		const beforeModalScroll = await page.locator('#dialog-content').evaluate((content) => content.scrollTop);
		const update = structuredClone(initial);
		update.generatedAt = new Date(Date.parse(initial.generatedAt) + 1_000).toISOString();
		update.workdays[0]!.executions[0]!.evidence.push({
			id: 'evidence-late', timestamp: update.generatedAt, kind: 'tool-result', label: 'Late tool result',
			status: 'recorded', summary: 'New evidence', detail: { result: 'preserved' },
		});
		await report.publish(update);
		await expect.poll(() => page.locator('html').getAttribute('data-revision')).toBe('1');
		expect(await firstEvidence.getAttribute('open')).not.toBeNull();
		expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('SUMMARY');
		expect(await page.locator('#dialog-content').evaluate((content) => content.scrollTop)).toBe(beforeModalScroll);

		await page.locator('.dialog-close').click();
		await expect.poll(() => page.locator('#command-dialog').evaluate((dialog: HTMLDialogElement) => dialog.open)).toBe(false);
		expect(new URLSearchParams(new URL(await page.url()).hash.slice(1)).has('entityId')).toBe(false);
		const closedUpdate = structuredClone(update);
		closedUpdate.generatedAt = new Date(Date.parse(update.generatedAt) + 1_000).toISOString();
		closedUpdate.workdays[0]!.activity.push({ ...closedUpdate.workdays[0]!.activity.at(-1)!, id: 'event-late', sequence: 25 });
		await report.publish(closedUpdate);
		await expect.poll(() => page.locator('html').getAttribute('data-revision')).toBe('2');
		expect(await page.locator('#command-dialog').evaluate((dialog: HTMLDialogElement) => dialog.open)).toBe(false);
		expect(new URLSearchParams(new URL(await page.url()).hash.slice(1)).has('entityId')).toBe(false);

		const query = page.locator('[data-filter="query"]');
		await query.fill('plan');
		await query.focus();
		await page.evaluate(() => { (window as any).__navigationNode = document.querySelector('#navigation-region'); window.scrollTo(0,400); });
		const beforePageScroll = await page.evaluate(() => window.scrollY);
		const focusedUpdate = structuredClone(closedUpdate);
		focusedUpdate.generatedAt = new Date(Date.parse(closedUpdate.generatedAt) + 1_000).toISOString();
		await report.publish(focusedUpdate);
		await expect.poll(() => page.locator('html').getAttribute('data-revision')).toBe('3');
		expect(await query.inputValue()).toBe('plan');
		expect(await page.evaluate(() => document.activeElement?.getAttribute('data-filter'))).toBe('query');
		expect(await page.evaluate(() => (window as any).__navigationNode === document.querySelector('#navigation-region'))).toBe(true);
		expect(Math.abs(await page.evaluate(() => window.scrollY) - beforePageScroll)).toBeLessThan(3);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
		await page.goto(report.url + '#page=providers&workday=guide');
		await expect.poll(() => page.locator('[data-open-entity="provider"]').count()).toBeGreaterThanOrEqual(20);
		expect(await page.locator('.entity-list').textContent()).toContain('context-pack');
		expect(await page.locator('.entity-list').textContent()).toContain('treedx-call');
		await page.goto(report.url + '#page=events&workday=guide');
		expect(await page.locator('.entity-list').textContent()).toContain('proposal.voted');
		await page.locator('[data-open-entity="governance"]').click();
		expect(await page.locator('#dialog-content').textContent()).toContain('Operator authorization');
		await page.goto(report.url + '#page=metric&metric=agents&workday=guide');
		await page.locator('[data-open-entity="agent"]').click();
		expect(await page.locator('#dialog-content').textContent()).toContain('enabled Handlers');
		expect(await page.locator('#dialog-content').textContent()).toContain('writer');
	} finally {
		await browser.close();
		await report.close();
		if (previousPort === undefined) delete process.env.TREESEED_AGENT_SIMULATOR_PORT;
		else process.env.TREESEED_AGENT_SIMULATOR_PORT = previousPort;
	}
}, 30_000);
