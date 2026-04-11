import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { build } from 'esbuild';
import ts from 'typescript';
import { packageRoot } from './package-tools.ts';

const srcRoot = resolve(packageRoot, 'src');
const scriptsRoot = resolve(packageRoot, 'scripts');
const distRoot = resolve(packageRoot, 'dist');
const templateCatalogSourceRoot = resolve(srcRoot, 'template-catalog');

const COPY_EXTENSIONS = new Set(['.json', '.md']);

function walkFiles(root) {
	const files = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const fullPath = join(root, entry.name);
		if (entry.isDirectory()) files.push(...walkFiles(fullPath));
		else files.push(fullPath);
	}
	return files;
}

function ensureDir(filePath) {
	mkdirSync(dirname(filePath), { recursive: true });
}

function rewriteRuntimeSpecifiers(contents, outputFile = null) {
	let rewritten = contents
		.replace(/(['"`])(\.[^'"`\n]+)\.(mjs|ts)\1/g, '$1$2.js$1')
		.replace(/(['"`])\.\.\/src\//g, '$1../');

	if (!outputFile || outputFile.includes(`${resolve(distRoot, 'scripts')}`)) {
		return rewritten;
	}

	rewritten = rewritten.replace(/(['"`])((?:\.\.\/)+scripts\/([^'"`\n]+))\1/g, (_match, quote, _specifier, scriptPath) => {
		const targetPath = resolve(distRoot, 'scripts', scriptPath);
		let relativeSpecifier = relative(dirname(outputFile), targetPath).replaceAll('\\', '/');
		if (!relativeSpecifier.startsWith('.')) {
			relativeSpecifier = `./${relativeSpecifier}`;
		}
		return `${quote}${relativeSpecifier}${quote}`;
	});

	return rewritten;
}

function isTypeScriptSource(filePath) {
	return filePath.endsWith('.ts') && !filePath.endsWith('.d.ts');
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
	writeFileSync(outputFile, rewriteRuntimeSpecifiers(builtSource, outputFile), 'utf8');
}

function copyAsset(filePath, sourceRoot, outputRoot) {
	const outputFile = resolve(outputRoot, relative(sourceRoot, filePath));
	ensureDir(outputFile);
	copyFileSync(filePath, outputFile);
	if (outputFile.endsWith('.d.ts')) {
		writeFileSync(outputFile, rewriteRuntimeSpecifiers(readFileSync(outputFile, 'utf8')), 'utf8');
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
	const outputFile = resolve(distRoot, 'scripts', relativePath.replace(/\.(mjs|ts)$/u, '.js'));
	const transformed = extname(filePath) === '.ts'
		? ts.transpileModule(source, {
				compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
			}).outputText
		: source;
	ensureDir(outputFile);
	writeFileSync(outputFile, rewriteRuntimeSpecifiers(transformed, outputFile), 'utf8');
	chmodSync(outputFile, 0o755);
}

function emitDeclarations() {
	const rootNames = walkFiles(srcRoot).filter(isTypeScriptSource);
	const program = ts.createProgram({
		rootNames,
		options: {
			allowImportingTsExtensions: true,
			target: ts.ScriptTarget.ES2022,
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			strict: true,
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
		throw new Error('Declaration build failed.');
	}
}

rmSync(distRoot, { recursive: true, force: true });

for (const filePath of walkFiles(srcRoot)) {
	if (filePath.startsWith(`${templateCatalogSourceRoot}/`)) {
		continue;
	}
	const extension = extname(filePath);
	if (isTypeScriptSource(filePath)) await compileModule(filePath, srcRoot, distRoot);
	else if (COPY_EXTENSIONS.has(extension)) copyAsset(filePath, srcRoot, distRoot);
}

if (existsSync(templateCatalogSourceRoot)) {
	copyAssetTree(templateCatalogSourceRoot, resolve(distRoot, 'template-catalog'));
}

for (const filePath of walkFiles(scriptsRoot)) {
	const extension = extname(filePath);
	if (extension === '.ts' || extension === '.mjs') transpileScript(filePath);
}

emitDeclarations();

if (existsSync(resolve(packageRoot, 'README.md'))) {
	copyFileSync(resolve(packageRoot, 'README.md'), resolve(distRoot, '..', 'README.md'));
}
