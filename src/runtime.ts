import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_FIXTURE_ID = 'treeseed-working-site';

function resolveSharedFixtureRoot(start: string) {
	const fixturesRoot = process.env.TREESEED_FIXTURES_ROOT
		? path.resolve(process.env.TREESEED_FIXTURES_ROOT)
		: path.join(start, '.fixtures', 'treeseed-fixtures');
	const requestedFixtureId = process.env.TREESEED_FIXTURE_ID?.trim() || DEFAULT_FIXTURE_ID;
	const directRoot = path.join(fixturesRoot, 'sites', 'working-site');
	const directManifestPath = path.join(directRoot, 'fixture.manifest.json');

	if (existsSync(path.join(directRoot, 'src', 'content')) && existsSync(directManifestPath)) {
		return directRoot;
	}

	const sitesRoot = path.join(fixturesRoot, 'sites');
	if (!existsSync(sitesRoot)) {
		return null;
	}

	for (const entry of readdirSync(sitesRoot, { withFileTypes: true }).filter((item) => item.isDirectory()).map((item) => item.name)) {
		const fixtureRoot = path.join(sitesRoot, entry);
		const manifestPath = path.join(fixtureRoot, 'fixture.manifest.json');
		if (!existsSync(manifestPath)) {
			continue;
		}

		try {
			const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { id?: string; root?: string };
			if (manifest.id === requestedFixtureId) {
				const root = path.resolve(fixtureRoot, manifest.root ?? '.');
				if (existsSync(path.join(root, 'src', 'content'))) {
					return root;
				}
			}
		} catch {
			continue;
		}
	}

	return null;
}

function findContentRoot(start: string) {
	let current = path.resolve(start);
	for (;;) {
		const sharedFixtureRoot = resolveSharedFixtureRoot(current);
		if (sharedFixtureRoot) {
			return sharedFixtureRoot;
		}
		if (existsSync(path.join(current, 'src', 'content'))) {
			return current;
		}
		if (existsSync(path.join(current, 'docs', 'src', 'content'))) {
			return path.join(current, 'docs');
		}

		const parent = path.dirname(current);
		if (parent === current) {
			return null;
		}
		current = parent;
	}
}

export function resolveSdkRepoRoot(repoRoot?: string) {
	if (repoRoot) {
		return path.resolve(repoRoot);
	}

	if (process.env.TREESEED_SDK_CONTENT_ROOT) {
		return path.resolve(process.env.TREESEED_SDK_CONTENT_ROOT);
	}

	if (process.env.TREESEED_SDK_REPO_ROOT) {
		return path.resolve(process.env.TREESEED_SDK_REPO_ROOT);
	}

	return findContentRoot(process.cwd()) ?? process.cwd();
}
