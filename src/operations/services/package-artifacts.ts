import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runTreeseedGitText } from './git-runner.ts';

export type TreeseedPackageArtifactManifest = {
	schemaVersion: 1;
	kind: 'treeseed.package-artifact';
	packageName: string;
	packageVersion: string;
	sourceSha: string;
	createdAt: string;
	file: string;
	sha256: string;
	size: number;
};

function readPackageJson(packageRoot: string) {
	const path = resolve(packageRoot, 'package.json');
	if (!existsSync(path)) throw new Error(`Package artifact build requires ${path}.`);
	return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function fileDigest(path: string) {
	const bytes = readFileSync(path);
	return {
		sha256: createHash('sha256').update(bytes).digest('hex'),
		size: bytes.byteLength,
	};
}

export function buildTreeseedPackageArtifact(input: { packageRoot: string; outputDir: string }) {
	const packageRoot = resolve(input.packageRoot);
	const outputDir = resolve(input.outputDir);
	const pkg = readPackageJson(packageRoot);
	const packageName = typeof pkg.name === 'string' ? pkg.name : '';
	const packageVersion = typeof pkg.version === 'string' ? pkg.version : '';
	if (!packageName || !packageVersion) throw new Error('Package artifact build requires package name and version.');
	mkdirSync(outputDir, { recursive: true });
	const result = spawnSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', outputDir], {
		cwd: packageRoot,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		env: process.env,
	});
	if ((result.status ?? 1) !== 0) throw new Error(`npm pack failed for ${packageName}.\n${result.stderr || result.stdout}`);
	const output = JSON.parse(result.stdout) as Array<{ filename?: string }>;
	const filename = output[0]?.filename;
	if (!filename) throw new Error(`npm pack did not report an artifact for ${packageName}.`);
	const artifactPath = resolve(outputDir, basename(filename));
	if (!existsSync(artifactPath)) throw new Error(`npm pack artifact is missing: ${artifactPath}`);
	const sourceSha = runTreeseedGitText(['rev-parse', 'HEAD'], { cwd: packageRoot, mode: 'read' }).trim();
	const digest = fileDigest(artifactPath);
	const manifest: TreeseedPackageArtifactManifest = {
		schemaVersion: 1,
		kind: 'treeseed.package-artifact',
		packageName,
		packageVersion,
		sourceSha,
		createdAt: new Date().toISOString(),
		file: basename(artifactPath),
		sha256: digest.sha256,
		size: digest.size,
	};
	const manifestPath = resolve(outputDir, 'manifest.json');
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
	return { artifactPath, manifestPath, manifest };
}

export function verifyTreeseedPackageArtifact(input: { manifestPath: string; artifactPath?: string }) {
	const manifestPath = resolve(input.manifestPath);
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as TreeseedPackageArtifactManifest;
	if (manifest.schemaVersion !== 1 || manifest.kind !== 'treeseed.package-artifact') {
		throw new Error(`Unsupported package artifact manifest: ${manifestPath}`);
	}
	const artifactPath = resolve(input.artifactPath ?? resolve(dirname(manifestPath), manifest.file));
	if (!existsSync(artifactPath)) throw new Error(`Package artifact is missing: ${artifactPath}`);
	const digest = fileDigest(artifactPath);
	if (digest.sha256 !== manifest.sha256 || digest.size !== manifest.size) {
		throw new Error(`Package artifact integrity check failed for ${artifactPath}.`);
	}
	return { ok: true as const, artifactPath, manifestPath, manifest };
}

export function hydrateTreeseedPackageArtifacts(input: { artifactsRoot: string; projectRoot: string }) {
	const artifactsRoot = resolve(input.artifactsRoot);
	const projectRoot = resolve(input.projectRoot);
	const manifests = readdirSync(artifactsRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(resolve(artifactsRoot, entry.name, 'manifest.json')))
		.map((entry) => verifyTreeseedPackageArtifact({ manifestPath: resolve(artifactsRoot, entry.name, 'manifest.json') }))
		.sort((left, right) => left.manifest.packageName.localeCompare(right.manifest.packageName));
	if (manifests.length === 0) throw new Error(`No package artifact manifests found under ${artifactsRoot}.`);
	const result = spawnSync('npm', [
		'install', '--no-save', '--ignore-scripts', '--package-lock=false', '--workspaces=false',
		...manifests.map((entry) => entry.artifactPath),
	], {
		cwd: projectRoot,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		env: process.env,
	});
	if ((result.status ?? 1) !== 0) throw new Error(`Candidate package artifact hydration failed.\n${result.stderr || result.stdout}`);
	for (const entry of manifests) {
		const installed = readPackageJson(resolve(projectRoot, 'node_modules', ...entry.manifest.packageName.split('/')));
		if (installed.version !== entry.manifest.packageVersion) {
			throw new Error(`Hydrated ${entry.manifest.packageName} version mismatch: expected ${entry.manifest.packageVersion}, observed ${String(installed.version)}.`);
		}
	}
	return { ok: true as const, projectRoot, artifactsRoot, packages: manifests.map((entry) => entry.manifest) };
}
