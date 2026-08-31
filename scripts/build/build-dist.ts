import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { build } from 'esbuild';
import ts from 'typescript';
import { packageRoot } from '../packages/package-tools.ts';

const srcRoot = resolve(packageRoot, 'src');
const distRoot = resolve(packageRoot, 'dist');
const distBuildRoot = resolve(packageRoot, `.treeseed-dist-build-${process.pid}`);
const buildLockRoot = resolve(packageRoot, '.treeseed-build-dist.lock');
const packageJsonPath = resolve(packageRoot, 'package.json');
const BUILD_LOCK_TIMEOUT_MS = 15 * 60 * 1000;
const BUILD_LOCK_STALE_MS = 20 * 60 * 1000;

function sleep(ms: number) {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function lockOwnerIsRunning() {
	let owner: { pid?: unknown };
	try {
		owner = JSON.parse(readFileSync(resolve(buildLockRoot, 'owner.json'), 'utf8')) as { pid?: unknown };
	} catch {
		return false;
	}

	if (typeof owner.pid !== 'number') {
		return false;
	}

	try {
		process.kill(owner.pid, 0);
		return true;
	} catch (error) {
		const code = typeof error === 'object' && error && 'code' in error ? (error as { code?: unknown }).code : null;
		return code === 'EPERM';
	}
}

function processIsRunning(pid: number) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		const code = typeof error === 'object' && error && 'code' in error ? (error as { code?: unknown }).code : null;
		return code === 'EPERM';
	}
}

function removeStaleBuildRoots() {
	for (const entry of readdirSync(packageRoot, { withFileTypes: true })) {
		const match = entry.isDirectory() ? /^\.treeseed-dist-build-(\d+)$/u.exec(entry.name) : null;
		if (!match?.[1]) continue;
		const pid = Number.parseInt(match[1], 10);
		if (pid === process.pid || processIsRunning(pid)) continue;
		rmSync(resolve(packageRoot, entry.name), { recursive: true, force: true });
	}
}

async function acquireBuildLock() {
	const startedAt = Date.now();
	while (true) {
		try {
			mkdirSync(buildLockRoot);
			writeFileSync(resolve(buildLockRoot, 'owner.json'), JSON.stringify({
				pid: process.pid,
				startedAt: new Date().toISOString(),
			}, null, 2));
			removeStaleBuildRoots();
			return () => rmSync(buildLockRoot, { recursive: true, force: true });
		} catch (error) {
			const ageMs = existsSync(buildLockRoot) ? Date.now() - statSync(buildLockRoot).mtimeMs : 0;
			if (!lockOwnerIsRunning() || ageMs > BUILD_LOCK_STALE_MS) {
				rmSync(buildLockRoot, { recursive: true, force: true });
				continue;
			}
			if (Date.now() - startedAt > BUILD_LOCK_TIMEOUT_MS) {
				throw new Error(`Timed out waiting for SDK dist build lock at ${buildLockRoot}.`);
			}
			await sleep(250);
		}
	}
}

function walkFiles(root) {
	const files = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const fullPath = join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...walkFiles(fullPath));
			continue;
		}
		files.push(fullPath);
	}
	return files;
}

function ensureDir(filePath) {
	mkdirSync(dirname(filePath), { recursive: true });
}

function rewriteRuntimeSpecifiers(contents) {
	return contents.replace(/(['"`])(\.[^'"`\n]+?)(?<!\.d)\.(mjs|ts)\1/g, '$1$2.js$1');
}

function isTypeScriptSource(filePath) {
	return filePath.endsWith('.ts') && !filePath.endsWith('.d.ts');
}

async function compileModule(filePath, sourceRoot, outputRoot) {
	const relativePath = relative(sourceRoot, filePath);
	const outputFile = resolve(outputRoot, relativePath.replace(/\.ts$/u, '.js'));
	ensureDir(outputFile);

	await build({
		entryPoints: [filePath],
		outfile: outputFile,
		platform: 'node',
		format: 'esm',
		bundle: false,
		logLevel: 'silent',
	});

	const builtSource = readFileSync(outputFile, 'utf8');
	writeFileSync(outputFile, rewriteRuntimeSpecifiers(builtSource), 'utf8');
}

function listRelativeFiles(root) {
	if (!existsSync(root)) {
		return [];
	}

	return walkFiles(root).map((filePath) => relative(root, filePath));
}

function removeEmptyDirectories(root) {
	if (!existsSync(root)) {
		return;
	}

	const entries = readdirSync(root, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}
		removeEmptyDirectories(resolve(root, entry.name));
	}

	if (root !== distRoot && readdirSync(root).length === 0) {
		rmdirSync(root);
	}
}

function publishDistBuild() {
	if (!existsSync(distRoot)) {
		renameSync(distBuildRoot, distRoot);
		return;
	}

	const nextFiles = new Set(listRelativeFiles(distBuildRoot));
	for (const relativeFile of nextFiles) {
		const sourceFile = resolve(distBuildRoot, relativeFile);
		const targetFile = resolve(distRoot, relativeFile);
		ensureDir(targetFile);
		renameSync(sourceFile, targetFile);
	}

	for (const relativeFile of listRelativeFiles(distRoot)) {
		if (nextFiles.has(relativeFile)) {
			continue;
		}
		rmSync(resolve(distRoot, relativeFile), { force: true });
	}
	removeEmptyDirectories(distRoot);
}

function exportedSourceRoots() {
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { exports?: Record<string, unknown> };
	const targets: string[] = [];
	const collect = (value: unknown) => {
		if (typeof value === 'string') {
			targets.push(value);
			return;
		}
		if (value && typeof value === 'object' && !Array.isArray(value)) Object.values(value).forEach(collect);
	};
	collect(packageJson.exports ?? {});
	return [...new Set(targets.filter((target) => target.startsWith('./dist/') && target.endsWith('.js'))
		.map((target) => resolve(srcRoot, target.slice('./dist/'.length).replace(/\.js$/u, '.ts'))))]
		.filter((target) => existsSync(target));
}

function sourceProgram(rootNames: string[]) {
	return ts.createProgram({
		rootNames,
		options: {
			allowImportingTsExtensions: true,
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			target: ts.ScriptTarget.ES2022,
			strict: true,
			skipLibCheck: true,
			types: ['node'],
		},
	});
}

function reachableSourceFiles(rootNames: string[]) {
	return sourceProgram(rootNames).getSourceFiles()
		.map((sourceFile) => sourceFile.fileName)
		.filter((filePath) => filePath.startsWith(`${srcRoot}/`) && isTypeScriptSource(filePath));
}

function emitDeclarations(outputRoot, rootNames: string[]) {
	const program = ts.createProgram({
		rootNames,
		options: {
			allowImportingTsExtensions: true,
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			target: ts.ScriptTarget.ES2022,
			strict: true,
			skipLibCheck: true,
			types: ['node'],
			declaration: true,
			emitDeclarationOnly: true,
			declarationDir: outputRoot,
			rootDir: srcRoot,
			noEmit: false,
		},
	});

	const result = program.emit();
	if (result.emitSkipped) {
		const diagnostics = ts.formatDiagnosticsWithColorAndContext(result.diagnostics, {
			getCanonicalFileName: (fileName) => fileName,
			getCurrentDirectory: () => process.cwd(),
			getNewLine: () => '\n',
		});
		throw new Error(`Declaration build failed.\n${diagnostics}`);
	}
}

function rewriteDeclarations(outputRoot) {
	for (const filePath of walkFiles(outputRoot)) {
		if (!filePath.endsWith('.d.ts')) continue;
		const contents = readFileSync(filePath, 'utf8');
		writeFileSync(filePath, rewriteRuntimeSpecifiers(contents), 'utf8');
	}
}

const releaseBuildLock = await acquireBuildLock();
try {
	rmSync(distBuildRoot, { recursive: true, force: true });
	const rootNames = exportedSourceRoots();
	if (!rootNames.length) throw new Error('SDK package exports do not resolve to any TypeScript source roots.');
	const reachableSources = reachableSourceFiles(rootNames);

	for (const filePath of reachableSources) await compileModule(filePath, srcRoot, distBuildRoot);

	emitDeclarations(distBuildRoot, rootNames);
	rewriteDeclarations(distBuildRoot);

	for (const filePath of walkFiles(distBuildRoot)) {
		if (filePath.endsWith('.d.js')) {
			rmSync(filePath, { force: true });
		}
	}

	publishDistBuild();
	const marker = resolve(distRoot, '.treeseed-build-complete.json'), temporaryMarker = `${marker}.new`;
	writeFileSync(temporaryMarker, `${JSON.stringify({ completedAt: new Date().toISOString() })}\n`);
	renameSync(temporaryMarker, marker);
} finally {
	rmSync(distBuildRoot, { recursive: true, force: true });
	releaseBuildLock();
}
