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

function normalizedText(node: ts.Node, sourceFile: ts.SourceFile) {
	return node.getText(sourceFile).replace(/\s+/gu, ' ').trim();
}

function deprecated(node: ts.Node) {
	return ts.getJSDocTags(node).some((tag) => tag.tagName.text === 'deprecated');
}

function exported(node: ts.Node) {
	return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
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

function symbol(node: ts.Statement, sourceFile: ts.SourceFile): TypeScriptApiSymbol | null {
	if (!exported(node)) return null;
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

function extractEntrypoint(input: TypeScriptDeclarationEntrypointInput): TypeScriptApiEntrypoint {
	const sourceFile = ts.createSourceFile(input.declarationPath, input.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const symbols = sourceFile.statements.map((entry) => symbol(entry, sourceFile)).filter((entry): entry is TypeScriptApiSymbol => Boolean(entry))
		.sort((left, right) => left.name.localeCompare(right.name));
	return { specifier: input.specifier, declarationPath: input.declarationPath, symbols };
}

export function extractTypeScriptApi(input: TypeScriptDeclarationEntrypointInput[]): TypeScriptApiModel {
	return { schemaVersion: 1, entrypoints: input.map(extractEntrypoint).sort((left, right) => left.specifier.localeCompare(right.specifier)) };
}
