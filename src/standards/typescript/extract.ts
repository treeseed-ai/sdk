import ts from 'typescript';
import type {
	TypeScriptApiEntrypoint,
	TypeScriptApiMember,
	TypeScriptApiModel,
	TypeScriptApiParameter,
	TypeScriptApiSymbol,
} from './contracts.ts';

export interface TypeScriptDeclarationEntrypointInput {
	specifier: string;
	declarationPath: string;
	source: string;
}

export interface TypeScriptExtractionOptions {
	unresolvedLocalSymbols?: 'error' | 'record';
}

function normalizedText(node: ts.Node, sourceFile: ts.SourceFile) {
	return node.getText(sourceFile).replace(/\s+/gu, ' ').trim();
}

function deprecated(node: ts.Node) {
	return ts.getJSDocTags(node).some((tag) => tag.tagName.text === 'deprecated');
}

function exported(node: ts.Node) {
	return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
}

function normalizeDeclarationPath(value: string) {
	const normalized: string[] = [];
	for (const segment of value.replaceAll('\\', '/').split('/')) {
		if (!segment || segment === '.') continue;
		if (segment === '..') normalized.pop();
		else normalized.push(segment);
	}
	return normalized.join('/');
}

function resolveLocalDeclaration(fromPath: string, specifier: string) {
	if (!specifier.startsWith('.')) return null;
	const directory = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
	const resolved = normalizeDeclarationPath(`${directory}/${specifier}`);
	if (/\.d\.(?:mts|cts|ts)$/u.test(resolved)) return resolved;
	if (/\.(?:mjs|cjs|js)$/u.test(resolved)) return resolved.replace(/\.(?:mjs|cjs|js)$/u, '.d.ts');
	return `${resolved}.d.ts`;
}

function memberName(node: ts.NamedDeclaration, sourceFile: ts.SourceFile) {
	return node.name ? normalizedText(node.name, sourceFile).replace(/^['"]|['"]$/gu, '') : null;
}

function member(node: ts.TypeElement | ts.ClassElement, sourceFile: ts.SourceFile): TypeScriptApiMember | null {
	if (!ts.isPropertySignature(node) && !ts.isPropertyDeclaration(node) && !ts.isMethodSignature(node) && !ts.isMethodDeclaration(node)) return null;
	const name = memberName(node, sourceFile);
	if (!name) return null;
	const type = ts.isMethodSignature(node) || ts.isMethodDeclaration(node)
		? normalizedText(node, sourceFile).replace(/^[^(]+/u, '')
		: node.type ? normalizedText(node.type, sourceFile) : 'unknown';
	return {
		name,
		type,
		optional: Boolean(node.questionToken),
		readonly: ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword) === true,
		deprecated: deprecated(node),
	};
}

function parameter(node: ts.ParameterDeclaration, sourceFile: ts.SourceFile): TypeScriptApiParameter {
	return {
		name: normalizedText(node.name, sourceFile),
		type: node.type ? normalizedText(node.type, sourceFile) : 'unknown',
		optional: Boolean(node.questionToken || node.initializer),
		rest: Boolean(node.dotDotDotToken),
	};
}

function symbol(node: ts.Statement, sourceFile: ts.SourceFile, requireExport = true): TypeScriptApiSymbol | null {
	if (requireExport && !exported(node)) return null;
	if (ts.isFunctionDeclaration(node) && node.name) return {
		name: node.name.text, kind: 'function', deprecated: deprecated(node), members: [],
		parameters: node.parameters.map((entry) => parameter(entry, sourceFile)),
		returnType: node.type ? normalizedText(node.type, sourceFile) : 'unknown', definition: null,
	};
	if (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) {
		const declarationName = node.name?.text;
		if (!declarationName) return null;
		return {
			name: declarationName, kind: ts.isInterfaceDeclaration(node) ? 'interface' : 'class', deprecated: deprecated(node),
			members: node.members.map((entry) => member(entry, sourceFile)).filter((entry): entry is TypeScriptApiMember => Boolean(entry))
				.sort((left, right) => left.name.localeCompare(right.name)),
			parameters: [], returnType: null, definition: null,
		};
	}
	if (ts.isTypeAliasDeclaration(node)) return {
		name: node.name.text, kind: 'type', deprecated: deprecated(node), members: [], parameters: [], returnType: null,
		definition: normalizedText(node.type, sourceFile),
	};
	if (ts.isEnumDeclaration(node)) return {
		name: node.name.text, kind: 'enum', deprecated: deprecated(node), members: [], parameters: [], returnType: null,
		definition: node.members.map((entry) => normalizedText(entry, sourceFile)).join('|'),
	};
	if (ts.isVariableStatement(node)) {
		const declaration = node.declarationList.declarations[0];
		if (!declaration || !ts.isIdentifier(declaration.name)) return null;
		return {
			name: declaration.name.text, kind: 'variable', deprecated: deprecated(node), members: [], parameters: [], returnType: null,
			definition: declaration.type ? normalizedText(declaration.type, sourceFile) : 'unknown',
		};
	}
	return null;
}

function externalReexport(moduleName: string, exportedName: string): TypeScriptApiSymbol {
	return {
		name: exportedName,
		kind: 'variable',
		deprecated: false,
		members: [],
		parameters: [],
		returnType: null,
		definition: `external-reexport:${moduleName}`,
	};
}

function extractEntrypoint(
	input: TypeScriptDeclarationEntrypointInput,
	declarations: Readonly<Record<string, string>>,
	options: TypeScriptExtractionOptions,
): TypeScriptApiEntrypoint {
	const cache = new Map<string, Map<string, TypeScriptApiSymbol>>();
	const active = new Set<string>();

	function extractFile(declarationPath: string) {
		const normalizedPath = normalizeDeclarationPath(declarationPath);
		const cached = cache.get(normalizedPath);
		if (cached) return cached;
		if (active.has(normalizedPath)) return new Map<string, TypeScriptApiSymbol>();
		const source = declarations[normalizedPath];
		if (source === undefined) throw new Error(`Unresolved local public declaration: ${normalizedPath}.`);
		active.add(normalizedPath);
		const sourceFile = ts.createSourceFile(normalizedPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
		const collected = new Map<string, TypeScriptApiSymbol>();
		const local = new Map<string, TypeScriptApiSymbol>();
		const imported = new Map<string, { moduleName: string; sourceName: string; localTarget: string | null }>();
		for (const statement of sourceFile.statements) {
			if (ts.isImportDeclaration(statement) && statement.importClause && ts.isStringLiteral(statement.moduleSpecifier)) {
				const moduleName = statement.moduleSpecifier.text;
				const localTarget = resolveLocalDeclaration(normalizedPath, moduleName);
				if (statement.importClause.name) {
					imported.set(statement.importClause.name.text, { moduleName, sourceName: 'default', localTarget });
				}
				const bindings = statement.importClause.namedBindings;
				if (bindings && ts.isNamespaceImport(bindings)) {
					imported.set(bindings.name.text, { moduleName, sourceName: '*', localTarget });
				} else if (bindings) {
					for (const element of bindings.elements) {
						imported.set(element.name.text, {
							moduleName,
							sourceName: element.propertyName?.text ?? element.name.text,
							localTarget,
						});
					}
				}
			}
			const localSymbol = symbol(statement, sourceFile, false);
			if (localSymbol) local.set(localSymbol.name, localSymbol);
			const publicSymbol = symbol(statement, sourceFile);
			if (publicSymbol) collected.set(publicSymbol.name, publicSymbol);
		}
		for (const statement of sourceFile.statements) {
			if (!ts.isExportDeclaration(statement)) continue;
			const moduleName = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
				? statement.moduleSpecifier.text
				: null;
			const localTarget = moduleName ? resolveLocalDeclaration(normalizedPath, moduleName) : null;
			const targetSymbols = localTarget
				? extractFile(localTarget)
				: moduleName ? null : local;
			if (!statement.exportClause) {
				if (targetSymbols) {
					for (const [name, exportedSymbol] of targetSymbols) if (name !== 'default') collected.set(name, exportedSymbol);
				} else if (moduleName) {
					collected.set(`* from ${moduleName}`, externalReexport(moduleName, `* from ${moduleName}`));
				}
				continue;
			}
			if (ts.isNamespaceExport(statement.exportClause)) {
				const name = statement.exportClause.name.text;
				collected.set(name, externalReexport(moduleName ?? normalizedPath, name));
				continue;
			}
			for (const element of statement.exportClause.elements) {
				const sourceName = element.propertyName?.text ?? element.name.text;
				const exportedName = element.name.text;
				let target = targetSymbols?.get(sourceName);
				if (!target && !moduleName) {
					const importedBinding = imported.get(sourceName);
					if (importedBinding?.localTarget) {
						target = extractFile(importedBinding.localTarget).get(importedBinding.sourceName);
					} else if (importedBinding) {
						target = externalReexport(importedBinding.moduleName, exportedName);
					}
				}
				if (target) collected.set(exportedName, { ...target, name: exportedName });
				else if (moduleName && !localTarget) collected.set(exportedName, externalReexport(moduleName, exportedName));
				else if (options.unresolvedLocalSymbols === 'record') collected.set(exportedName, {
					...externalReexport(normalizedPath, exportedName),
					definition: `unresolved-local-reexport:${normalizedPath}:${sourceName}`,
				});
				else throw new Error(`Unresolved public symbol ${sourceName} in ${normalizedPath}.`);
			}
		}
		active.delete(normalizedPath);
		cache.set(normalizedPath, collected);
		return collected;
	}

	const symbols = [...extractFile(input.declarationPath).values()].sort((left, right) => left.name.localeCompare(right.name));
	return { specifier: input.specifier, declarationPath: normalizeDeclarationPath(input.declarationPath), symbols };
}

export function extractTypeScriptApi(
	input: TypeScriptDeclarationEntrypointInput[],
	declarations: Readonly<Record<string, string>> = Object.fromEntries(input.map((entry) => [normalizeDeclarationPath(entry.declarationPath), entry.source])),
	options: TypeScriptExtractionOptions = {},
): TypeScriptApiModel {
	return { schemaVersion: 1, entrypoints: input.map((entry) => extractEntrypoint(entry, declarations, options)).sort((left, right) => left.specifier.localeCompare(right.specifier)) };
}
