import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
	buildExecutionGraphReport,
	parseUiFeatureContract,
	runGuarantees,
	unexpectedUiSceneRuntimeDiagnostics,
	validateSceneDeviceEvidence,
} from '../../../../src/guarantees/index.ts';

describe('UI guarantee evidence trust', () => {
	it('rejects the historical mobile-as-desktop evidence shape', () => {
		const diagnostics = validateSceneDeviceEvidence({
			requestedDevice: 'mobile_chromium',
			requestedBrowser: 'chromium',
			expected: {
				id: 'mobile_chromium',
				viewport: { width: 390, height: 844 },
				deviceScaleFactor: 2,
				isMobile: true,
				hasTouch: true,
			},
			actual: {
				id: 'desktop_chromium',
				viewport: { width: 1600, height: 900 },
				deviceScaleFactor: 1,
				isMobile: false,
				hasTouch: false,
			},
			actualBrowser: 'chromium',
		});
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.code).toBe('guarantee.scene_device_mismatch');
		expect(diagnostics[0]?.message).toContain('actual device was "desktop_chromium"');
	});

	it('records positive and forbidden-actor scenes as distinct per-device graph nodes', () => {
		const report = buildExecutionGraphReport({
			runId: 'trust-run',
			environment: 'local',
			plan: [{
				id: 'guarantee.team.team.edit.014',
				status: 'active',
				selected: true,
				dependency: false,
				depth: 0,
				dependsOn: [],
				dependencyReasons: [],
				devices: ['mobile_chromium'],
				sceneManifest: 'edit.scene.yaml',
				sceneExecutionKey: 'team.edit',
				negativeScenes: [{
					id: 'contributor-denied',
					actor: 'contributor',
					manifest: 'negative.scene.yaml',
					executionKey: 'team.edit.contributor-denied',
					producesState: [],
					consumesState: ['team.created'],
				}],
				producesState: ['team.updated'],
				consumesState: ['team.created'],
			} as any],
			results: [{
				id: 'guarantee.team.team.edit.014',
				status: 'passed',
				steps: [
					{ id: 'scene', deviceResults: [{ requestedDevice: 'mobile_chromium', status: 'passed', evidence: ['positive.json'] }] },
					{ id: 'negative-scene:contributor-denied', deviceResults: [{ requestedDevice: 'mobile_chromium', status: 'failed', evidence: ['negative.json'] }] },
				],
			} as any],
		});
		expect(report.nodes).toHaveLength(2);
		expect(report.nodes.find((node) => node.executionKey === 'team.edit')).toMatchObject({
			status: 'passed',
			evidence: ['positive.json'],
		});
		expect(report.nodes.find((node) => node.executionKey.endsWith('contributor-denied'))).toMatchObject({
			status: 'failed',
			evidence: ['negative.json'],
			consumesState: ['team.created'],
		});
	});

	it('parses the canonical feature contract and rejects incomplete schema identity', () => {
		expect(parseUiFeatureContract({
			schemaVersion: 'treeseed.ui-feature/v1',
			id: 'admin.team-management',
			ownerPackage: '@treeseed/admin',
			routes: ['/app/teams'],
			devices: ['desktop_chromium'],
			states: ['success'],
			capabilities: [],
			requiredGuarantees: [],
			requirements: {
				accessibility: true, console: true, network: true,
				visual: true, durableState: true, cleanup: true,
			},
		})?.id).toBe('admin.team-management');
		expect(parseUiFeatureContract({ schemaVersion: 'treeseed.ui-feature/v0' })).toBeNull();
	});

	it('rejects console, transport, and server failures while allowing asserted client denials', () => {
		const diagnostics = unexpectedUiSceneRuntimeDiagnostics({
			steps: [{
				id: 'submit',
				consoleErrors: [
					{ message: 'ReferenceError: document is not defined' },
					{ message: 'Failed to load resource: the server responded with a status of 409 (Conflict)' },
					{ message: 'Failed to load resource: the server responded with a status of 500 (Internal Server Error)' },
				],
				networkErrors: [
					{ method: 'POST', url: '/v1/teams', status: 409, message: 'HTTP 409' },
					{ method: 'GET', url: '/v1/teams', status: 503, message: 'HTTP 503' },
					{ method: 'GET', url: '/app/teams', message: 'net::ERR_FAILED' },
				],
			}],
		});
		expect(diagnostics.map((entry) => entry.code)).toEqual([
			'guarantee.scene_unexpected_console_error',
			'guarantee.scene_unexpected_console_error',
			'guarantee.scene_unexpected_network_error',
			'guarantee.scene_unexpected_network_error',
		]);
	});

	it('fails release evidence when a required guarantee remains blocked', async () => {
		const root = resolve(tmpdir(), `guarantee-release-trust-${process.pid}-${Date.now()}`);
		const guaranteeRoot = resolve(root, 'guarantees/team/team');
		mkdirSync(guaranteeRoot, { recursive: true });
		writeFileSync(resolve(root, 'package.json'), JSON.stringify({ name: '@treeseed/market' }));
		writeFileSync(resolve(guaranteeRoot, 'blocked.guarantee.yaml'), `
schemaVersion: treeseed.guarantee/v1
id: guarantee.team.team.blocked-release.900
journeyIndex: 900
type: team
subtype: team
journey: Blocked Release
ownerPackage: "@treeseed/market"
surface: api-control-plane
summary: A blocked release promise.
status: blocked
run:
  requiredForRelease: true
dependencies: { journeys: [], guarantees: [] }
actors: { allowed: [team_owner], forbidden: [anonymous_user] }
devices: { required: [] }
gates: [release]
preconditions: { fixtures: [] }
scene: { required: false }
api: { required: false, verifierRefs: [] }
content: { required: false, verifierRefs: [] }
audit: { required: false, verifierRefs: [] }
negativeCases: []
evidence: { required: [guarantee_report] }
`);
		const report = await runGuarantees({
			workspaceRoot: root,
			failOnSkippedReleaseGuarantees: true,
			now: new Date('2026-01-01T00:00:00.000Z'),
		});
		expect(report.ok).toBe(false);
		expect(report.counts.releaseBlockingFailures).toBe(1);
	});

	it('invalidates passing release evidence when its source closure changes during execution', async () => {
		const root = resolve(tmpdir(), `guarantee-source-drift-${process.pid}-${Date.now()}`);
		const guaranteeRoot = resolve(root, 'guarantees/team/team');
		const scenePath = resolve(guaranteeRoot, 'source.scene.yaml');
		const guaranteePath = resolve(guaranteeRoot, 'source.guarantee.yaml');
		mkdirSync(guaranteeRoot, { recursive: true });
		writeFileSync(resolve(root, 'package.json'), JSON.stringify({ name: '@treeseed/market' }));
		writeFileSync(scenePath, 'schemaVersion: treeseed.scene/v1\nid: source-drift\n');
		writeFileSync(guaranteePath, `
schemaVersion: treeseed.guarantee/v1
id: guarantee.team.team.source-drift.901
journeyIndex: 901
type: team
subtype: team
journey: Source Drift
ownerPackage: "@treeseed/market"
surface: api-control-plane
summary: Evidence belongs to one exact source closure.
status: active
run: { requiredForRelease: true }
dependencies: { journeys: [], guarantees: [] }
actors: { allowed: [team_owner], forbidden: [] }
devices: { required: [desktop_chromium] }
gates: [release]
preconditions: { fixtures: [] }
scene:
  required: true
  manifest: source.scene.yaml
  executionKey: source-drift
  expectedEvidence: [playwright_trace]
api: { required: false, verifierRefs: [] }
content: { required: false, verifierRefs: [] }
audit: { required: false, verifierRefs: [] }
negativeCases: []
evidence: { required: [playwright_trace] }
`);
		const report = await runGuarantees({
			workspaceRoot: root,
			now: new Date('2026-01-01T00:00:00.000Z'),
			sceneExecutor: async () => {
				writeFileSync(scenePath, 'schemaVersion: treeseed.scene/v1\nid: changed-source\n');
				return { status: 'passed', evidence: ['trace.zip'] };
			},
		});
		expect(report.sourceClosure?.matches).toBe(false);
		expect(report.results[0]?.status).toBe('failed');
		expect(report.diagnostics).toContainEqual(expect.objectContaining({
			code: 'guarantee.source_closure_drift',
		}));
	});
});
