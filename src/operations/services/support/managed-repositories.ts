import { existsSync, readFileSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { currentBranch, gitStatusPorcelain, originRemoteUrl, repoRoot } from '../treedx/workspaces/workspace-save.ts';
import { hasCompletePackageCheckout, sortWorkspacePackages, workspacePackages } from '../treedx/workspaces/workspace-tools.ts';
import { discoverPackageAdapters } from '../reconciliation/package-adapters.ts';

export type ManagedRepositoryKind = 'root' | 'package' | 'template' | 'fixture' | 'project';

export type TemplateRepositoryManifest = {
	id: string;
	name: string;
	category: string;
	repository: string | null;
	version: string | null;
	versionSource: string;
	manifestPath: string | null;
	verify: {
		fast: string | null;
		local: string | null;
		release: string | null;
	};
	release: {
		tagPrefix: string;
		recordPath: string;
	};
};

export type ManagedRepository = {
	id: string;
	name: string;
	kind: ManagedRepositoryKind;
	dir: string;
	relativeDir: string;
	branchName: string | null;
	dirty: boolean;
	detached: boolean;
	hasOriginRemote: boolean;
	remoteUrl: string | null;
	templateManifest: TemplateRepositoryManifest | null;
};

function readJsonFile(filePath: string) {
	try {
		return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function readStructuredFile(filePath: string) {
	try {
		const source = readFileSync(filePath, 'utf8');
		return filePath.endsWith('.yaml') || filePath.endsWith('.yml')
			? parseYaml(source) as Record<string, unknown>
			: JSON.parse(source) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function stringValue(value: unknown) {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function parseGitmodulesPaths(root: string) {
	const gitmodulesPath = resolve(root, '.gitmodules');
	if (!existsSync(gitmodulesPath)) return [] as string[];
	const source = readFileSync(gitmodulesPath, 'utf8');
	return [...source.matchAll(/^\s*path\s*=\s*(.+?)\s*$/gmu)]
		.map((match) => match[1]!.replaceAll('\\', '/').trim())
		.filter(Boolean);
}

function isIndependentGitRepo(repoDir: string) {
	try {
		return resolve(repoRoot(repoDir)) === resolve(repoDir);
	} catch {
		return false;
	}
}

function branchName(repoDir: string) {
	return currentBranch(repoDir) || null;
}

function hasOriginRemote(repoDir: string) {
	try {
		originRemoteUrl(repoDir);
		return true;
	} catch {
		return false;
	}
}

function remoteUrl(repoDir: string) {
	try {
		return originRemoteUrl(repoDir);
	} catch {
		return null;
	}
}

function templateManifestPath(repoDir: string) {
	for (const name of ['treeseed.template.yaml', 'treeseed.template.yml', 'treeseed.template.json']) {
		const candidate = resolve(repoDir, name);
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

function defaultTemplateConfigPath(repoDir: string) {
	const candidate = resolve(repoDir, 'template.config.json');
	return existsSync(candidate) ? candidate : null;
}

function templateVersion(repoDir: string, manifest: Record<string, unknown> | null, config: Record<string, unknown> | null) {
	const versionSource = stringValue(manifest?.versionSource) ?? 'template.config.json';
	const configured = stringValue(manifest?.version) ?? stringValue(config?.templateVersion);
	if (configured) return { version: configured, versionSource };
	const sourcePath = resolve(repoDir, versionSource);
	const source = readJsonFile(sourcePath);
	return {
		version: stringValue(source?.templateVersion) ?? stringValue(source?.version),
		versionSource,
	};
}

export function readTemplateRepositoryManifest(repoDir: string): TemplateRepositoryManifest | null {
	const manifestPath = templateManifestPath(repoDir);
	const configPath = defaultTemplateConfigPath(repoDir);
	const manifest = manifestPath ? readStructuredFile(manifestPath) : null;
	const config = configPath ? readStructuredFile(configPath) : null;
	if (!manifest && !config) return null;
	const id = stringValue(manifest?.id) ?? stringValue(config?.id) ?? basename(repoDir);
	const release = manifest?.release && typeof manifest.release === 'object' && !Array.isArray(manifest.release)
		? manifest.release as Record<string, unknown>
		: {};
	const verify = manifest?.verify && typeof manifest.verify === 'object' && !Array.isArray(manifest.verify)
		? manifest.verify as Record<string, unknown>
		: {};
	const version = templateVersion(repoDir, manifest, config);
	return {
		id,
		name: stringValue(manifest?.name) ?? stringValue(config?.displayName) ?? id,
		category: stringValue(manifest?.category) ?? stringValue(config?.category) ?? 'starter',
		repository: stringValue(manifest?.repository) ?? remoteUrl(repoDir),
		version: version.version,
		versionSource: version.versionSource,
		manifestPath: manifestPath ?? configPath,
		verify: {
			fast: stringValue(verify.fast),
			local: stringValue(verify.local) ?? stringValue((config?.testing as Record<string, unknown> | undefined)?.buildCommand),
			release: stringValue(verify.release) ?? stringValue(verify.local) ?? stringValue((config?.testing as Record<string, unknown> | undefined)?.buildCommand),
		},
		release: {
			tagPrefix: stringValue(release.tagPrefix) ?? 'template/',
			recordPath: stringValue(release.recordPath) ?? `.treeseed/templates/${id}/latest-release.json`,
		},
	};
}

function classifyManagedRepo(root: string, relativeDir: string, repoDir: string): ManagedRepositoryKind {
	if (relativeDir === '.') return 'root';
	if (/^starters\/[^/]+$/u.test(relativeDir) || readTemplateRepositoryManifest(repoDir)) return 'template';
	if (/(^|\/)\.fixtures\/treeseed-fixtures$/u.test(relativeDir)) return 'fixture';
	if (/^packages\/[^/]+$/u.test(relativeDir)) return 'package';
	return 'project';
}

function addRecursiveSubmodules(root: string, relativeDir: string, repoDir: string, repos: Map<string, string>) {
	for (const submodulePath of parseGitmodulesPaths(repoDir)) {
		const childDir = resolve(repoDir, submodulePath);
		const childRelativeDir = relative(root, childDir).replaceAll('\\', '/') || '.';
		if (!existsSync(childDir) || !isIndependentGitRepo(childDir)) continue;
		if (!repos.has(childRelativeDir)) {
			repos.set(childRelativeDir, childDir);
		}
		addRecursiveSubmodules(root, childRelativeDir, childDir, repos);
	}
}

export function discoverManagedRepositories(root: string): ManagedRepository[] {
	const gitRoot = repoRoot(root);
	const repos = new Map<string, string>();
	repos.set('.', gitRoot);

	if (hasCompletePackageCheckout(root)) {
		for (const pkg of workspacePackages(root).filter((pkg) => pkg.name?.startsWith('@treeseed/'))) {
			if (existsSync(resolve(pkg.dir, '.git')) && isIndependentGitRepo(pkg.dir)) {
				repos.set(pkg.relativeDir, pkg.dir);
			}
		}
	}
	for (const adapter of discoverPackageAdapters(root)) {
		if (existsSync(resolve(adapter.dir, '.git')) && isIndependentGitRepo(adapter.dir)) {
			repos.set(adapter.relativeDir, adapter.dir);
		}
	}
	addRecursiveSubmodules(root, '.', gitRoot, repos);

	return [...repos.entries()]
		.map(([relativeDir, dir]) => {
			const kind = classifyManagedRepo(root, relativeDir, dir);
			const templateManifest = kind === 'template' ? readTemplateRepositoryManifest(dir) : null;
			const name = kind === 'root'
				? '@treeseed/market'
				: kind === 'template'
					? `template:${templateManifest?.id ?? basename(dir)}`
					: kind === 'fixture'
						? `fixture:${relativeDir}`
						: readJsonFile(resolve(dir, 'package.json'))?.name as string | undefined ?? basename(dir);
			const branch = branchName(dir);
			return {
				id: relativeDir,
				name,
				kind,
				dir,
				relativeDir,
				branchName: branch,
				dirty: gitStatusPorcelain(dir).length > 0,
				detached: branch == null,
				hasOriginRemote: hasOriginRemote(dir),
				remoteUrl: remoteUrl(dir),
				templateManifest,
			} satisfies ManagedRepository;
		})
		.sort((left, right) => sortWorkspacePackages([
			{ name: left.name, dir: left.dir, relativeDir: left.relativeDir, packageJson: {} },
			{ name: right.name, dir: right.dir, relativeDir: right.relativeDir, packageJson: {} },
		])[0]?.name === left.name ? -1 : 1);
}

export function checkedOutManagedWorkflowRepos(root: string) {
	return discoverManagedRepositories(root).filter((repo) => repo.kind !== 'root');
}

export function checkedOutTemplateRepositories(root: string) {
	return discoverManagedRepositories(root).filter((repo) => repo.kind === 'template' && repo.templateManifest);
}
