import { existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { runDefaultAction, setLogLevel, type CliOptions, type PackResult } from 'repomix';
import { loadTreeseedDeployConfigFromPath, resolveTreeseedDeployConfigPathFromRoot } from '../../platform/deploy-config.ts';
import type { TreeseedDeployConfig } from '../../platform/contracts.ts';
import { findNearestTreeseedRoot } from './workspace-tools.ts';
import { currentBranch, repoRoot } from './workspace-save.ts';

export type TreeseedExportResult = {
	directory: string;
	tenantRoot: string;
	outputPath: string;
	branch: string;
	timestamp: string;
	includedBundlePaths: string[];
	ignorePatterns: string[];
	summary: {
		totalFiles: number;
		totalCharacters: number;
		totalTokens: number;
		outputFiles: string[];
	};
};

function ensureDirectory(directory: string) {
	if (!existsSync(directory)) {
		throw new Error(`Treeseed export directory does not exist: ${directory}`);
	}
	const stats = statSync(directory);
	if (!stats.isDirectory()) {
		throw new Error(`Treeseed export directory must be a directory: ${directory}`);
	}
}

function formatExportTimestamp(date = new Date()) {
	const year = date.getFullYear();
	const month = `${date.getMonth() + 1}`.padStart(2, '0');
	const day = `${date.getDate()}`.padStart(2, '0');
	const hours = `${date.getHours()}`.padStart(2, '0');
	const minutes = `${date.getMinutes()}`.padStart(2, '0');
	const seconds = `${date.getSeconds()}`.padStart(2, '0');
	return `${year}-${month}-${day}-${hours}-${minutes}-${seconds}`;
}

function sanitizeBranchSegment(branch: string | null | undefined) {
	const sanitized = String(branch ?? '')
		.trim()
		.replaceAll(/[\\/]+/g, '-')
		.replaceAll(/[^a-zA-Z0-9._-]+/g, '-')
		.replaceAll(/-+/g, '-')
		.replaceAll(/^-|-$/g, '');
	return sanitized || 'detached';
}

function resolveGitBranch(directory: string) {
	try {
		const gitRoot = repoRoot(directory);
		const branch = currentBranch(gitRoot);
		return sanitizeBranchSegment(branch);
	} catch {
		return 'detached';
	}
}

function resolveExportOutputPath(directory: string, branch: string, timestamp: string) {
	const exportsRoot = resolve(directory, '.treeseed', 'exports');
	mkdirSync(exportsRoot, { recursive: true });
	return resolve(exportsRoot, `${branch}-${timestamp}.md`);
}

function resolveConfiguredBundlePaths(directory: string, tenantRoot: string, config: TreeseedDeployConfig) {
	const includedBundlePaths: string[] = [];
	const seen = new Set<string>();
	for (const configuredPath of config.export?.bundledPaths ?? []) {
		const absolutePath = resolve(tenantRoot, configuredPath);
		if (!existsSync(absolutePath)) {
			continue;
		}
		const relativeToDirectory = relative(directory, absolutePath);
		if (!relativeToDirectory || (!relativeToDirectory.startsWith('..') && relativeToDirectory !== '.')) {
			continue;
		}
		if (seen.has(absolutePath)) {
			continue;
		}
		seen.add(absolutePath);
		includedBundlePaths.push(absolutePath);
	}
	return includedBundlePaths.sort((left, right) => left.localeCompare(right));
}

function resolveIgnorePatterns(config: TreeseedDeployConfig) {
	return [
		'.treeseed/exports',
		'.treeseed/exports/**',
		'**/.treeseed/exports',
		'**/.treeseed/exports/**',
		...(config.export?.ignore ?? []),
	];
}

function toRepomixDirectories(directory: string, includedBundlePaths: string[]) {
	return ['.', ...includedBundlePaths.map((bundlePath) => relative(directory, bundlePath) || '.')];
}

function normalizePackResultOutputFiles(packResult: PackResult, outputPath: string) {
	return packResult.outputFiles && packResult.outputFiles.length > 0
		? packResult.outputFiles
		: [outputPath];
}

async function withCleanNodeExecArgv<T>(action: () => Promise<T>) {
	const previousExecArgv = [...process.execArgv];
	process.execArgv = previousExecArgv.filter((arg) =>
		!arg.startsWith('--test')
		&& !arg.startsWith('--input-type')
		&& !arg.startsWith('--experimental-test')
		&& !arg.startsWith('--watch'),
	);
	try {
		return await action();
	} finally {
		process.execArgv = previousExecArgv;
	}
}

export async function exportTreeseedCodebase({
	directory = process.cwd(),
}: {
	directory?: string;
} = {}): Promise<TreeseedExportResult> {
	const resolvedDirectory = resolve(directory);
	ensureDirectory(resolvedDirectory);

	const tenantRoot = findNearestTreeseedRoot(resolvedDirectory);
	if (!tenantRoot) {
		throw new Error(`Treeseed export requires a Treeseed project. No ancestor containing treeseed.site.yaml was found from ${resolvedDirectory}.`);
	}

	const deployConfig = loadTreeseedDeployConfigFromPath(resolveTreeseedDeployConfigPathFromRoot(tenantRoot));
	const includedBundlePaths = resolveConfiguredBundlePaths(resolvedDirectory, tenantRoot, deployConfig);
	const ignorePatterns = resolveIgnorePatterns(deployConfig);
	const branch = resolveGitBranch(resolvedDirectory);
	const timestamp = formatExportTimestamp();
	const outputPath = resolveExportOutputPath(resolvedDirectory, branch, timestamp);
	const options: CliOptions = {
		output: outputPath,
		style: 'markdown',
		ignore: ignorePatterns.join(','),
		quiet: true,
		skipLocalConfig: true,
		copy: false,
		stdout: false,
	};

	setLogLevel(0 as never);
	const result = await withCleanNodeExecArgv(() =>
		runDefaultAction(toRepomixDirectories(resolvedDirectory, includedBundlePaths), resolvedDirectory, options),
	);
	const outputFiles = normalizePackResultOutputFiles(result.packResult, outputPath);

	return {
		directory: resolvedDirectory,
		tenantRoot,
		outputPath,
		branch,
		timestamp,
		includedBundlePaths,
		ignorePatterns,
		summary: {
			totalFiles: result.packResult.totalFiles,
			totalCharacters: result.packResult.totalCharacters,
			totalTokens: result.packResult.totalTokens,
			outputFiles,
		},
	};
}
