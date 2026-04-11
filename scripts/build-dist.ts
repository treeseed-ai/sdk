import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { build } from 'esbuild';
import ts from 'typescript';
import { packageRoot } from './package-tools.ts';

const srcRoot = resolve(packageRoot, 'src');
const scriptsRoot = resolve(packageRoot, 'scripts');
const distRoot = resolve(packageRoot, 'dist');
const treeseedTemplateCatalogSourceRoot = resolve(srcRoot, 'treeseed', 'template-catalog');
const treeseedServicesSourceRoot = resolve(srcRoot, 'treeseed', 'services');

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
	return contents.replace(/(['"`])(\.[^'"`\n]+)\.(mjs|ts)\1/g, '$1$2.js$1');
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
	const outputFile = resolve(outputRoot, relativePath.replace(/\.(mjs|ts)$/u, '.js'));
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

function transpileScript(filePath) {
	if (basename(filePath).startsWith('.ts-run-')) {
		return;
	}
	const source = readFileSync(filePath, 'utf8');
	const relativePath = relative(scriptsRoot, filePath);
	if (relativePath === 'fixture-tools.ts') {
		return;
	}
	const outputFile = resolve(distRoot, 'scripts', relativePath.replace(/\.(mjs|ts)$/u, '.js'));
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

function emitDeclarations() {
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
			declarationDir: distRoot,
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

rmSync(distRoot, { recursive: true, force: true });

for (const filePath of walkFiles(srcRoot)) {
	if (filePath.startsWith(`${treeseedTemplateCatalogSourceRoot}/`)) {
		continue;
	}
	const extension = extname(filePath);
	if (isDeclarationAsset(filePath)) {
		copyAsset(filePath, srcRoot, distRoot);
		continue;
	}
	if (isTypeScriptSource(filePath)) {
		await compileModule(filePath, srcRoot, distRoot);
		continue;
	}

	if (COPY_EXTENSIONS.has(extension)) {
		copyAsset(filePath, srcRoot, distRoot);
	}
}

if (existsSync(treeseedTemplateCatalogSourceRoot)) {
	copyAssetTree(treeseedTemplateCatalogSourceRoot, resolve(distRoot, 'treeseed', 'template-catalog'));
}

if (existsSync(treeseedServicesSourceRoot)) {
	copyAssetTree(treeseedServicesSourceRoot, resolve(distRoot, 'treeseed', 'services'));
}

for (const filePath of walkFiles(scriptsRoot)) {
	const extension = extname(filePath);
	if (extension === '.ts' || extension === '.mjs') {
		transpileScript(filePath);
	}
}

emitDeclarations();

for (const filePath of walkFiles(distRoot)) {
	if (filePath.endsWith('.d.js')) {
		rmSync(filePath, { force: true });
	}
}

if (existsSync(resolve(packageRoot, 'README.md'))) {
	copyFileSync(resolve(packageRoot, 'README.md'), resolve(distRoot, '..', 'README.md'));
}
