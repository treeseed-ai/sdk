import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { build } from 'esbuild';
import ts from 'typescript';
import { packageRoot } from './package-tools.ts';

const srcRoot = resolve(packageRoot, 'src');
const scriptsRoot = resolve(packageRoot, 'scripts');
const distRoot = resolve(packageRoot, 'dist');
const distBuildRoot = resolve(packageRoot, `.treeseed-dist-build-${process.pid}`);
const buildLockRoot = resolve(packageRoot, '.treeseed-build-dist.lock');
const treeseedTemplateCatalogSourceRoot = resolve(srcRoot, 'treeseed', 'template-catalog');
const treeseedServicesSourceRoot = resolve(srcRoot, 'treeseed', 'services');
const BIN_ENTRYPOINTS = new Set(['verification.ts']);
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

const COPY_EXTENSIONS = new Set(['.json', '.md', '.js', '.d.ts', '.yaml', '.yml']);

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

function rewriteScriptRuntimeSpecifiers(contents) {
	return rewriteRuntimeSpecifiers(contents)
		.replace(/(['"`])\.\.\/src\//g, '$1../')
		.replace(/(['"`])\.\/src\//g, '$1./');
}

function isTypeScriptSource(filePath) {
	return filePath.endsWith('.ts') && !filePath.endsWith('.d.ts');
}

function isDeclarationAsset(filePath) {
	return filePath.endsWith('.d.ts');
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
	const rewritten = rewriteRuntimeSpecifiers(builtSource);
	const executableSource = BIN_ENTRYPOINTS.has(relativePath)
		? `${rewritten.startsWith('#!') ? '' : '#!/usr/bin/env node\n'}${rewritten}`
		: rewritten;
	writeFileSync(outputFile, executableSource, 'utf8');
	if (BIN_ENTRYPOINTS.has(relativePath)) {
		chmodSync(outputFile, 0o755);
	}
}

function copyAsset(filePath, sourceRoot, outputRoot) {
	const outputFile = resolve(outputRoot, relative(sourceRoot, filePath));
	ensureDir(outputFile);
	copyFileSync(filePath, outputFile);

	if (outputFile.endsWith('.d.ts') || outputFile.endsWith('.js')) {
		const contents = readFileSync(outputFile, 'utf8');
		writeFileSync(outputFile, rewriteRuntimeSpecifiers(contents), 'utf8');
	}
}

function copyAssetTree(sourceRoot, outputRoot) {
	for (const filePath of walkFiles(sourceRoot)) {
		copyAsset(filePath, sourceRoot, outputRoot);
	}
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

function transpileScript(filePath, outputRoot) {
	const source = readFileSync(filePath, 'utf8');
	const relativePath = relative(scriptsRoot, filePath);
	if (relativePath === 'fixture-tools.ts') {
		return;
	}
	const outputFile = resolve(outputRoot, 'scripts', relativePath.replace(/\.ts$/u, '.js'));
	const transformed = extname(filePath) === '.ts'
		? ts.transpileModule(source, {
				compilerOptions: {
					module: ts.ModuleKind.ESNext,
					target: ts.ScriptTarget.ES2022,
				},
			}).outputText
		: source;

	ensureDir(outputFile);
	writeFileSync(outputFile, rewriteScriptRuntimeSpecifiers(transformed), 'utf8');
}

function emitDeclarations(outputRoot) {
	const rootNames = walkFiles(srcRoot).filter(isTypeScriptSource);
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

	for (const filePath of walkFiles(srcRoot)) {
		if (filePath.startsWith(`${treeseedTemplateCatalogSourceRoot}/`)) {
			continue;
		}
		const extension = extname(filePath);
		if (isDeclarationAsset(filePath)) {
			copyAsset(filePath, srcRoot, distBuildRoot);
			continue;
		}
		if (isTypeScriptSource(filePath)) {
			await compileModule(filePath, srcRoot, distBuildRoot);
			continue;
		}

		if (COPY_EXTENSIONS.has(extension)) {
			copyAsset(filePath, srcRoot, distBuildRoot);
		}
	}

	if (existsSync(treeseedTemplateCatalogSourceRoot)) {
		copyAssetTree(treeseedTemplateCatalogSourceRoot, resolve(distBuildRoot, 'treeseed', 'template-catalog'));
	}

	if (existsSync(treeseedServicesSourceRoot)) {
		copyAssetTree(treeseedServicesSourceRoot, resolve(distBuildRoot, 'treeseed', 'services'));
	}

	for (const filePath of walkFiles(scriptsRoot)) {
		const extension = extname(filePath);
		if (extension === '.ts') {
			transpileScript(filePath, distBuildRoot);
		}
	}

	emitDeclarations(distBuildRoot);
	rewriteDeclarations(distBuildRoot);

	for (const filePath of walkFiles(distBuildRoot)) {
		if (filePath.endsWith('.d.js')) {
			rmSync(filePath, { force: true });
		}
	}

	if (existsSync(resolve(packageRoot, 'README.md'))) {
		copyFileSync(resolve(packageRoot, 'README.md'), resolve(distBuildRoot, '..', 'README.md'));
	}

	publishDistBuild();
} finally {
	rmSync(distBuildRoot, { recursive: true, force: true });
	releaseBuildLock();
}
