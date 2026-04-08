import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { packageRoot } from './package-tools.ts';

type FixtureManifest = {
	id?: string;
	root?: string;
};

export const DEFAULT_FIXTURE_ID = 'treeseed-working-site';

function resolveRequestedFixtureId() {
	return process.env.TREESEED_FIXTURE_ID?.trim() || DEFAULT_FIXTURE_ID;
}

export function resolveFixturesRepoRoot() {
	if (process.env.TREESEED_FIXTURES_ROOT?.trim()) {
		return resolve(process.env.TREESEED_FIXTURES_ROOT);
	}

	return resolve(packageRoot, '.fixtures', 'treeseed-fixtures');
}

export function resolveSharedFixtureRoot() {
	const fixturesRepoRoot = resolveFixturesRepoRoot();
	const sitesRoot = join(fixturesRepoRoot, 'sites');
	if (!existsSync(sitesRoot)) {
		return null;
	}

	const requestedFixtureId = resolveRequestedFixtureId();
	for (const entry of readdirSync(sitesRoot, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue;
		}

		const fixtureRoot = join(sitesRoot, entry.name);
		const manifestPath = join(fixtureRoot, 'fixture.manifest.json');
		if (!existsSync(manifestPath)) {
			continue;
		}

		try {
			const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as FixtureManifest;
			if (manifest.id !== requestedFixtureId) {
				continue;
			}

			const root = resolve(fixtureRoot, manifest.root ?? '.');
			if (existsSync(join(root, 'src', 'content'))) {
				return root;
			}
		} catch {
			continue;
		}
	}

	return null;
}

export function requireSharedFixtureRoot() {
	const fixtureRoot = resolveSharedFixtureRoot();
	if (!fixtureRoot) {
		throw new Error(
			`Unable to resolve shared fixture "${resolveRequestedFixtureId()}". Initialize the submodule with "git submodule update --init --recursive".`,
		);
	}

	return fixtureRoot;
}

export function checkSharedFixture() {
	const fixtureRoot = requireSharedFixtureRoot();
	if (!existsSync(join(fixtureRoot, 'src', 'content'))) {
		throw new Error(`Shared fixture is missing src/content at ${fixtureRoot}.`);
	}

	return fixtureRoot;
}

function runCli(command: string) {
	switch (command) {
		case 'resolve':
			console.log(requireSharedFixtureRoot());
			return;
		case 'check':
			console.log(`Fixture check passed (${checkSharedFixture()})`);
			return;
		default:
			throw new Error(`Unknown fixture-tools command "${command}". Use resolve or check.`);
	}
}

if (process.argv[1] && /fixture-tools\.(?:ts|js|mjs)$/.test(process.argv[1])) {
	runCli(process.argv[2] ?? 'resolve');
}
