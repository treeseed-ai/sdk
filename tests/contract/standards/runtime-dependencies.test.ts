import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('declares every handwritten SDK runtime import as a production dependency', () => {
	const root = resolve(import.meta.dirname, '../../..');
	const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
	const allowed = new Set([manifest.name, ...Object.keys(manifest.dependencies ?? {}),
		...Object.keys(manifest.peerDependencies ?? {}), ...Object.keys(manifest.optionalDependencies ?? {})]);
	const missing = new Set<string>();
	for (const entry of readdirSync(resolve(root, 'src'), { recursive: true, withFileTypes: true })) {
		if (!entry.isFile() || !/\.tsx?$/u.test(entry.name) || entry.name.endsWith('.d.ts')) continue;
		const path = resolve(entry.parentPath, entry.name);
		const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
		const check = (specifier: string) => {
			if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) return;
			const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!;
			if (!allowed.has(name)) missing.add(`${name}: ${path.slice(root.length + 1)}`);
		};
		const visit = (node: ts.Node) => {
			if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
				const clause = node.importClause;
				const allTypes = clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
					&& !clause.name && clause.namedBindings.elements.every(item => item.isTypeOnly);
				if (!clause?.isTypeOnly && !allTypes) check(node.moduleSpecifier.text);
			} else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
				check(node.moduleSpecifier.text);
			} else if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])
				&& (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
				check(node.arguments[0].text);
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
	}
	expect([...missing].sort()).toEqual([]);
});
