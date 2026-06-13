import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function source(path: string) {
	return readFileSync(resolve(root, path), 'utf8');
}

function functionBody(fileSource: string, functionName: string) {
	const marker = `export async function ${functionName}`;
	const start = fileSource.indexOf(marker);
	expect(start, `${functionName} exists`).toBeGreaterThanOrEqual(0);
	const next = fileSource.indexOf('\nexport ', start + marker.length);
	return fileSource.slice(start, next === -1 ? undefined : next);
}

describe('hosting legacy mutation boundary', () => {
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

	it('keeps applyTreeseedHostingGraph as a reconcile-only compatibility facade', () => {
		const graph = source('packages/sdk/src/hosting/graph.ts');
		const body = functionBody(graph, 'applyTreeseedHostingGraph');
		expect(body).toContain('reconcileTreeseedTarget');
		for (const blocked of ['.host.apply', '.host.verify', 'deploySelectedRailwayServices', 'reconcilePublicTreeDxUnits']) {
			expect(body, `apply facade must not call ${blocked}`).not.toContain(blocked);
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
});
