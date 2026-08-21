import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { normalizeOpenApi } from '../../src/standards/openapi/index.ts';
import {
	extractTypeScriptApi,
	type TypeScriptDeclarationEntrypointInput,
	type TypeScriptExtractionOptions,
} from '../../src/standards/typescript/index.ts';

function typesTarget(value: unknown): string | null {
	if (typeof value === 'string') return value.endsWith('.d.ts') ? value : null;
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	return typesTarget(record.types) ?? Object.values(record).map(typesTarget).find(Boolean) ?? null;
}

function declarationFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		return entry.isDirectory() ? declarationFiles(path) : path.endsWith('.d.ts') ? [path] : [];
	});
}

export function buildContractModels(input: {
	packageRoot: string;
	openApiDocument: unknown;
	unresolvedLocalSymbols?: TypeScriptExtractionOptions['unresolvedLocalSymbols'];
}) {
	const packageJson = JSON.parse(readFileSync(resolve(input.packageRoot, 'package.json'), 'utf8')) as {
		name: string;
		version: string;
		exports: Record<string, unknown>;
	};
	const entrypoints: TypeScriptDeclarationEntrypointInput[] = Object.entries(packageJson.exports).map(([specifier, value]) => {
		const target = typesTarget(value);
		if (!target) throw new Error(`Public export ${specifier} has no declaration target.`);
		const declarationPath = target.replace(/^\.\//u, '');
		const absolutePath = resolve(input.packageRoot, declarationPath);
		if (!existsSync(absolutePath)) throw new Error(`Public export ${specifier} declaration is missing: ${declarationPath}.`);
		return { specifier, declarationPath, source: readFileSync(absolutePath, 'utf8') };
	});
	const declarations = Object.fromEntries(declarationFiles(resolve(input.packageRoot, 'dist')).map((path) => [
		relative(input.packageRoot, path).replaceAll('\\', '/'),
		readFileSync(path, 'utf8'),
	]));
	const typescript = extractTypeScriptApi(entrypoints, declarations, {
		unresolvedLocalSymbols: input.unresolvedLocalSymbols,
	});
	const openapi = normalizeOpenApi(input.openApiDocument);
	return {
		packageJson,
		models: { schemaVersion: 1 as const, packageVersion: packageJson.version, typescript, openapi },
	};
}
