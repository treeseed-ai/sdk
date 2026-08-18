import { describe, expect, it } from 'vitest';
import { readTestSource, resolveTestRoot, sourceFunctionBody } from '../../support/workspace-test-root.ts';

const testRoot = resolveTestRoot(import.meta.url);

function source(path: string) {
	const result = readTestSource(testRoot, path);
	expect(result, `${path} exists`).not.toBeNull();
	return result ?? '';
}

function functionBody(fileSource: string, functionName: string) {
	const marker = `export async function ${functionName}`;
	const start = fileSource.indexOf(marker);
	expect(start, `${functionName} exists`).toBeGreaterThanOrEqual(0);
	const next = fileSource.indexOf('\nexport ', start + marker.length);
	return fileSource.slice(start, next === -1 ? undefined : next);
}

function anyFunctionBody(fileSource: string, functionName: string) {
	const exportMarker = `export async function ${functionName}`;
	const asyncMarker = `async function ${functionName}`;
	const functionMarker = `function ${functionName}`;
	const start = [exportMarker, asyncMarker, functionMarker]
		.map((marker) => fileSource.indexOf(marker))
		.filter((index) => index >= 0)
		.sort((a, b) => a - b)[0] ?? -1;
	expect(start, `${functionName} exists`).toBeGreaterThanOrEqual(0);
	const open = fileSource.indexOf('{', start);
	expect(open, `${functionName} has a body`).toBeGreaterThanOrEqual(0);
	let depth = 0;
	for (let index = open; index < fileSource.length; index += 1) {
		const char = fileSource[index];
		if (char === '{') depth += 1;
		if (char === '}') {
			depth -= 1;
			if (depth === 0) {
				return fileSource.slice(start, index + 1);
			}
		}
	}
	throw new Error(`Could not locate the end of ${functionName}.`);
}

describe('hosting legacy mutation boundary', () => {
	it('keeps direct Railway GraphQL strictly query-only', () => {
		for (const path of [
			'packages/sdk/src/operations/services/hosting/railway/railway-api.ts',
			'packages/sdk/src/operations/services/hosting/railway/railway-deploy.ts',
			'packages/sdk/src/reconcile/support/acceptance/live-acceptance.ts',
		]) {
			const contents = source(path);
			expect(contents, `${path} must not contain a Railway GraphQL mutation document`).not.toMatch(/^\s*mutation\s+/gmu);
		}
	});

	it('does not keep old Railway and TreeDX mutation helpers in the hosting graph', () => {
		const graph = source('packages/sdk/src/hosting/graph.ts');
		for (const blocked of [
			'deploySelectedRailwayServices',
			'reconcilePublicTreeDxUnits',
			'treeDxStage',
			'scaleDownPublicTreeDxUnits',
			'deployRailwayServiceInstance',
			'ensureRailwayServiceVolume',
			'deleteRailwayService',
		]) {
			expect(graph, `hosting graph must not contain ${blocked}`).not.toContain(blocked);
		}
	});

	it('prevents the legacy Cloudflare hosting adapter from mutating providers', () => {
		const builtins = source('packages/sdk/src/hosting/builtins.ts');
		for (const blocked of [
			'deployCloudflarePages',
			'runCloudflarePagesBuild',
			'ensureCloudflarePagesProject',
			'ensureCloudflarePagesDomain',
			'ensureCloudflarePagesDns',
			'verifyCloudflarePagesPostconditions',
			"spawnSync('bash'",
			'pages\',\n\t\t\'deploy',
			'pages\',\n\t\t\'project\',\n\t\t\'create',
		]) {
			expect(builtins, `Cloudflare compatibility adapter must not contain ${blocked}`).not.toContain(blocked);
		}
		const applyIndex = builtins.indexOf('apply(input) {');
		expect(applyIndex).toBeGreaterThanOrEqual(0);
		const applyBody = builtins.slice(applyIndex, builtins.indexOf('\n\t\t\tverify(input)', applyIndex));
		expect(applyBody).toContain('reconciler-owned');
		expect(applyBody).not.toContain('deployCloudflarePages(input)');
	});

	it('refuses Railway service delete-and-recreate repair paths in normal reconciliation', () => {
		const railwayApi = source('packages/sdk/src/operations/services/hosting/railway/railway-api.ts');
		const builtins = source('packages/sdk/src/reconcile/reconciliation/builtin-adapters.ts');

		for (const [label, body] of [
			['ensureRailwayService', functionBody(railwayApi, 'ensureRailwayService')],
			['ensureRailwayPostgresService', functionBody(railwayApi, 'ensureRailwayPostgresService')],
			['resolveRailwayTopologyForScope', anyFunctionBody(builtins, 'resolveRailwayTopologyForScope')],
			['syncRailwayEnvironmentForScope', anyFunctionBody(builtins, 'syncRailwayEnvironmentForScope')],
			['reconcileStaleOperationsRunnerResourcesForProject', anyFunctionBody(builtins, 'reconcileStaleOperationsRunnerResourcesForProject')],
		] as const) {
			for (const blocked of [
				'deleteRailwayService',
				'deleteRailwayVolume',
				'waitForRailwayServiceDeleted',
				'waitForRailwayVolumeDeleted',
				'TREESEED_RAILWAY_ALLOW_SERVICE_REPLACEMENT',
				'TREESEED_RAILWAY_FORCE_IMAGE_SOURCE_UPDATE',
				'replace-image-service',
				'replaced: true',
			]) {
				expect(body, `${label} must not contain ${blocked}`).not.toContain(blocked);
			}
		}
	});

	it('routes Railway hosting provisioning through the SDK IaC project adapter only', () => {
		const builtins = source('packages/sdk/src/reconcile/reconciliation/builtin-adapters.ts');
		const sync = sourceFunctionBody(builtins, 'syncRailwayEnvironmentForScope');
		expect(sync).not.toBe('');

		expect(sync).toContain('renderRailwayIacProject');
		expect(sync).toContain('planRailwayIacProject');
		expect(sync).toContain('validateRailwayIacChangeSet');
		expect(sync).toContain('applyRailwayIacProject');
		for (const blocked of [
			'ensureRailwayService(',
			'ensureRailwayPostgresService(',
			'ensureRailwayServiceVolume(',
			'updateRailwayServiceGitSource(',
			'updateRailwayServiceImageSource(',
			'deployRailwayServiceInstance(',
			'deployRailwayServiceInstanceWithSourceRepair(',
			'deployRailwayServiceBySourceUpload(',
			'upsertRailwayVariables(',
		]) {
			expect(sync, `syncRailwayEnvironmentForScope must not call ${blocked}`).not.toContain(blocked);
		}
		expect(builtins).not.toContain('function shouldDeployRailwayServiceBySourceUpload');
		expect(builtins).not.toContain('function deployRailwayServiceBySourceUpload');
		expect(builtins).not.toContain('function ensureRailwayMarketDatabaseForScope');
		expect(builtins).not.toContain('function reconcileAccidentalMarketDatabaseServices');
	});
});
