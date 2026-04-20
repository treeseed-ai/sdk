import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve, relative } from 'node:path';
import { cliPackageVersion, corePackageVersion, sdkPackageVersion } from './runtime-paths.ts';

export interface KnowledgeCoopPackageManifest {
	schemaVersion: 1;
	kind: 'template' | 'knowledge_pack';
	id: string;
	title: string;
	summary: string | null;
	version: string;
	generatedAt: string;
	projectSlug: string;
	sourceProjectRoot: string;
	payloadRoot: string;
	files: string[];
	compatibility: {
		minCliVersion: string;
		minCoreVersion: string;
		minSdkVersion: string;
	};
	sourceSelection: {
		includedPaths: string[];
	};
	market: {
		publisherId: string | null;
		publisherName: string | null;
		publishMetadata: Record<string, unknown>;
	};
}

export interface KnowledgeCoopPackageBuildResult {
	outputRoot: string;
	payloadRoot: string;
	manifestPath: string;
	files: string[];
	manifest: KnowledgeCoopPackageManifest;
}

export interface KnowledgeCoopKnowledgePackImportResult {
	manifest: KnowledgeCoopPackageManifest;
	manifestPath: string;
	payloadRoot: string;
	importedPaths: string[];
}

const TEMPLATE_IGNORES = [
	'.git',
	'.github',
	'.astro',
	'.wrangler',
	'node_modules',
	'dist',
	'.treeseed/state',
	'.treeseed/generated',
];

const KNOWLEDGE_PACK_DEFAULT_PATHS = [
	'src/content/objectives',
	'src/content/questions',
	'src/content/notes',
	'src/content/proposals',
	'src/content/decisions',
	'src/content/knowledge',
	'src/content/pages',
];

function nowStamp(date = new Date()) {
	const year = date.getUTCFullYear();
	const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
	const day = `${date.getUTCDate()}`.padStart(2, '0');
	const hour = `${date.getUTCHours()}`.padStart(2, '0');
	const minute = `${date.getUTCMinutes()}`.padStart(2, '0');
	const second = `${date.getUTCSeconds()}`.padStart(2, '0');
	return `${year}${month}${day}${hour}${minute}${second}`;
}

function slugify(value: string, fallback = 'package') {
	return String(value ?? '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80) || fallback;
}

function ensureDir(path: string) {
	mkdirSync(path, { recursive: true });
}

function shouldIgnore(relativePath: string, ignorePatterns: string[]) {
	return ignorePatterns.some((pattern) => relativePath === pattern || relativePath.startsWith(`${pattern}/`));
}

function listFiles(root: string, relativeRoot = '', ignorePatterns: string[] = []): string[] {
	if (!existsSync(root)) {
		return [];
	}

	const entries = readdirSync(root, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const nextRelative = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
		if (shouldIgnore(nextRelative, ignorePatterns)) {
			continue;
		}
		const nextAbsolute = resolve(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...listFiles(nextAbsolute, nextRelative, ignorePatterns));
			continue;
		}
		files.push(nextRelative);
	}
	return files.sort((left, right) => left.localeCompare(right));
}

function writeManifest(outputRoot: string, manifest: KnowledgeCoopPackageManifest) {
	const manifestPath = resolve(outputRoot, 'manifest.json');
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
	return manifestPath;
}

function normalizeVersion(value: string | null | undefined, fallback = '0.1.0') {
	return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function loadProjectPackageVersion(projectRoot: string) {
	try {
		const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as { version?: string };
		return normalizeVersion(packageJson.version, '0.1.0');
	} catch {
		return '0.1.0';
	}
}

function copySelectedPaths(projectRoot: string, payloadRoot: string, relativePaths: string[], ignorePatterns: string[] = []) {
	const copied: string[] = [];
	for (const relativePath of relativePaths) {
		const sourcePath = resolve(projectRoot, relativePath);
		if (!existsSync(sourcePath)) {
			continue;
		}
		const targetPath = resolve(payloadRoot, relativePath);
		const stats = statSync(sourcePath);
		if (stats.isDirectory()) {
			for (const file of listFiles(sourcePath, relativePath, ignorePatterns)) {
				const absoluteSource = resolve(projectRoot, file);
				const absoluteTarget = resolve(payloadRoot, file);
				ensureDir(dirname(absoluteTarget));
				cpSync(absoluteSource, absoluteTarget, { force: true });
				copied.push(file);
			}
			continue;
		}
		ensureDir(dirname(targetPath));
		cpSync(sourcePath, targetPath, { force: true });
		copied.push(relativePath);
	}
	return copied.sort((left, right) => left.localeCompare(right));
}

function defaultTemplatePaths(projectRoot: string) {
	const preferred = [
		'package.json',
		'astro.config.ts',
		'tsconfig.json',
		'treeseed.site.yaml',
		'src',
		'public',
	];
	return preferred.filter((relativePath) => existsSync(resolve(projectRoot, relativePath)));
}

function buildManifest(
	projectRoot: string,
	input: {
		kind: KnowledgeCoopPackageManifest['kind'];
		id: string;
		title: string;
		summary?: string | null;
		projectSlug: string;
		files: string[];
		sourceSelection: string[];
		market?: KnowledgeCoopPackageManifest['market'];
	},
): KnowledgeCoopPackageManifest {
	return {
		schemaVersion: 1,
		kind: input.kind,
		id: input.id,
		title: input.title,
		summary: input.summary ?? null,
		version: loadProjectPackageVersion(projectRoot),
		generatedAt: new Date().toISOString(),
		projectSlug: input.projectSlug,
		sourceProjectRoot: projectRoot,
		payloadRoot: 'payload',
		files: [...input.files],
		compatibility: {
			minCliVersion: normalizeVersion(cliPackageVersion),
			minCoreVersion: normalizeVersion(corePackageVersion),
			minSdkVersion: normalizeVersion(sdkPackageVersion),
		},
		sourceSelection: {
			includedPaths: [...input.sourceSelection],
		},
		market: input.market ?? {
			publisherId: null,
			publisherName: null,
			publishMetadata: {},
		},
	};
}

export function resolveKnowledgeCoopPackageOutputRoot(projectRoot: string, kind: 'template' | 'knowledge_pack', slug: string) {
	return resolve(projectRoot, '.treeseed', 'packages', kind, `${slug}-${nowStamp()}`);
}

export function buildKnowledgeCoopTemplatePackage(projectRoot: string, input: {
	id?: string;
	title?: string;
	summary?: string | null;
	outputRoot?: string | null;
	projectSlug?: string | null;
	market?: KnowledgeCoopPackageManifest['market'];
} = {}): KnowledgeCoopPackageBuildResult {
	const projectSlug = slugify(input.projectSlug ?? basename(projectRoot), 'project');
	const packageId = slugify(input.id ?? `${projectSlug}-template`, 'template');
	const outputRoot = resolve(input.outputRoot ?? resolveKnowledgeCoopPackageOutputRoot(projectRoot, 'template', packageId));
	const payloadRoot = resolve(outputRoot, 'payload');
	ensureDir(payloadRoot);
	const files = copySelectedPaths(projectRoot, payloadRoot, defaultTemplatePaths(projectRoot), TEMPLATE_IGNORES);
	const manifest = buildManifest(projectRoot, {
		kind: 'template',
		id: packageId,
		title: input.title ?? `${projectSlug} template`,
		summary: input.summary ?? null,
		projectSlug,
		files,
		sourceSelection: defaultTemplatePaths(projectRoot),
		market: input.market,
	});
	const manifestPath = writeManifest(outputRoot, manifest);
	return {
		outputRoot,
		payloadRoot,
		manifestPath,
		files,
		manifest,
	};
}

export function buildKnowledgeCoopKnowledgePackPackage(projectRoot: string, input: {
	id?: string;
	title?: string;
	summary?: string | null;
	outputRoot?: string | null;
	projectSlug?: string | null;
	includePaths?: string[];
	market?: KnowledgeCoopPackageManifest['market'];
} = {}): KnowledgeCoopPackageBuildResult {
	const projectSlug = slugify(input.projectSlug ?? basename(projectRoot), 'project');
	const packageId = slugify(input.id ?? `${projectSlug}-knowledge-pack`, 'knowledge-pack');
	const outputRoot = resolve(input.outputRoot ?? resolveKnowledgeCoopPackageOutputRoot(projectRoot, 'knowledge_pack', packageId));
	const payloadRoot = resolve(outputRoot, 'payload');
	ensureDir(payloadRoot);
	const includePaths = (input.includePaths ?? KNOWLEDGE_PACK_DEFAULT_PATHS).filter((relativePath) => existsSync(resolve(projectRoot, relativePath)));
	const files = copySelectedPaths(projectRoot, payloadRoot, includePaths);
	const manifest = buildManifest(projectRoot, {
		kind: 'knowledge_pack',
		id: packageId,
		title: input.title ?? `${projectSlug} knowledge pack`,
		summary: input.summary ?? null,
		projectSlug,
		files,
		sourceSelection: includePaths,
		market: input.market,
	});
	const manifestPath = writeManifest(outputRoot, manifest);
	return {
		outputRoot,
		payloadRoot,
		manifestPath,
		files,
		manifest,
	};
}

export function importKnowledgeCoopKnowledgePack(targetRoot: string, sourcePath: string): KnowledgeCoopKnowledgePackImportResult {
	const resolvedSource = resolve(sourcePath);
	const manifestPath = statSync(resolvedSource).isDirectory()
		? resolve(resolvedSource, 'manifest.json')
		: resolvedSource;
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as KnowledgeCoopPackageManifest;
	const sourceRoot = dirname(manifestPath);
	const payloadRoot = resolve(sourceRoot, manifest.payloadRoot || 'payload');
	if (!existsSync(payloadRoot)) {
		throw new Error(`Knowledge pack payload directory is missing: ${payloadRoot}`);
	}
	const importedPaths: string[] = [];
	for (const file of manifest.files) {
		const sourceFile = resolve(payloadRoot, file);
		if (!existsSync(sourceFile)) {
			continue;
		}
		const targetFile = resolve(targetRoot, file);
		ensureDir(dirname(targetFile));
		cpSync(sourceFile, targetFile, { recursive: true, force: true });
		importedPaths.push(file);
	}
	return {
		manifest,
		manifestPath,
		payloadRoot,
		importedPaths: importedPaths.sort((left, right) => left.localeCompare(right)),
	};
}

export function relativePackageFiles(outputRoot: string) {
	return listFiles(outputRoot).map((entry) => relative(outputRoot, resolve(outputRoot, entry)) || basename(entry));
}
