import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import ts from 'typescript';

function kebab(value: string) {
	return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase();
}

function withoutAccessModifiers(modifiers: ts.NodeArray<ts.ModifierLike> | undefined) {
	return modifiers?.filter((modifier) => ![
		ts.SyntaxKind.PrivateKeyword,
		ts.SyntaxKind.ProtectedKeyword,
		ts.SyntaxKind.OverrideKeyword,
		ts.SyntaxKind.AbstractKeyword,
	].includes(modifier.kind));
}

function adjustedImport(source: ts.SourceFile, statement: ts.ImportDeclaration) {
	if (!ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.startsWith('.')) return statement;
	return ts.factory.updateImportDeclaration(
		statement,
		statement.modifiers,
		statement.importClause,
		ts.factory.createStringLiteral(`../${statement.moduleSpecifier.text}`),
		statement.attributes,
	);
}

function declaredNames(statement: ts.Statement) {
	if (ts.isVariableStatement(statement)) {
		return statement.declarationList.declarations.flatMap((declaration) => ts.isIdentifier(declaration.name) ? [declaration.name.text] : []);
	}
	if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) {
		return statement.name && ts.isIdentifier(statement.name) ? [statement.name.text] : [];
	}
	return [];
}

function exportTopLevel(statement: ts.Statement) {
	if (statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword)) return statement;
	if (declaredNames(statement).length === 0) return statement;
	const exportModifier = ts.factory.createModifier(ts.SyntaxKind.ExportKeyword);
	const modifiers = ts.factory.createNodeArray([exportModifier, ...(statement.modifiers ?? [])]);
	if (ts.isVariableStatement(statement)) return ts.factory.updateVariableStatement(statement, modifiers, statement.declarationList);
	if (ts.isFunctionDeclaration(statement)) return ts.factory.updateFunctionDeclaration(statement, modifiers, statement.asteriskToken, statement.name, statement.typeParameters, statement.parameters, statement.type, statement.body);
	if (ts.isClassDeclaration(statement)) return ts.factory.updateClassDeclaration(statement, modifiers, statement.name, statement.typeParameters, statement.heritageClauses, statement.members);
	if (ts.isInterfaceDeclaration(statement)) return ts.factory.updateInterfaceDeclaration(statement, modifiers, statement.name, statement.typeParameters, statement.heritageClauses, statement.members);
	if (ts.isTypeAliasDeclaration(statement)) return ts.factory.updateTypeAliasDeclaration(statement, modifiers, statement.name, statement.typeParameters, statement.type);
	if (ts.isEnumDeclaration(statement)) return ts.factory.updateEnumDeclaration(statement, modifiers, statement.name, statement.members);
	return statement;
}

function split(path: string, requestedClass?: string) {
	const text = readFileSync(path, 'utf8');
	const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const classNode = source.statements.find((statement): statement is ts.ClassDeclaration =>
		ts.isClassDeclaration(statement) && Boolean(statement.name) && (!requestedClass || statement.name?.text === requestedClass));
	if (!classNode?.name) throw new Error(`${path}: class not found`);
	const className = classNode.name.text;
	const methods = classNode.members.filter((member): member is ts.MethodDeclaration =>
		ts.isMethodDeclaration(member)
		&& Boolean(member.body)
		&& !member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)
		&& ts.isIdentifier(member.name));
	if (methods.length === 0) throw new Error(`${path}: no extractable methods found`);

	const stem = basename(path, '.ts');
	const outputDir = join(dirname(path), stem);
	mkdirSync(outputDir, { recursive: true });
	const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
	const imports = source.statements.filter(ts.isImportDeclaration);
	const localNames = source.statements.flatMap(declaredNames);
	const methodModuleImports: string[] = [];
	const methodInstallations: string[] = [];
	const interfaceMembers: ts.TypeElement[] = [];
	const assignments: ts.Statement[] = [];

	for (const method of methods) {
		const methodName = (method.name as ts.Identifier).text;
		const fileStem = kebab(methodName);
		const functionName = `${methodName}Method`;
		const thisParameter = ts.factory.createParameterDeclaration(undefined, undefined, 'this', undefined, ts.factory.createTypeReferenceNode(className), undefined);
		const functionNode = ts.factory.createFunctionDeclaration(
			[ts.factory.createModifier(ts.SyntaxKind.ExportKeyword), ...(method.modifiers?.filter((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? [])],
			method.asteriskToken,
			functionName,
			method.typeParameters,
			[thisParameter, ...method.parameters],
			method.type,
			method.body,
		);
		const supportImport = ts.factory.createImportDeclaration(
			undefined,
			ts.factory.createImportClause(false, undefined, ts.factory.createNamedImports(localNames.map((name) => ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier(name))))),
			ts.factory.createStringLiteral(`../${stem}.ts`),
			undefined,
		);
		const methodSource = [
			...imports.map((statement) => adjustedImport(source, statement)),
			supportImport,
			functionNode,
		].map((node) => printer.printNode(ts.EmitHint.Unspecified, node, source)).join('\n');
		if (methodSource.split('\n').length > 500) throw new Error(`${path}: method ${methodName} generates ${methodSource.split('\n').length} lines`);
		writeFileSync(join(outputDir, `${fileStem}.ts`), `${methodSource}\n`, 'utf8');
		methodModuleImports.push(`import { ${functionName} } from './${fileStem}.ts';`);
		methodInstallations.push(`\tprototype.${methodName} = ${functionName};`);
		interfaceMembers.push(ts.factory.createMethodSignature(
			undefined,
			method.name,
			method.questionToken,
			method.typeParameters,
			method.parameters.map((parameter) => ts.factory.updateParameterDeclaration(parameter, parameter.modifiers, parameter.dotDotDotToken, parameter.name, parameter.questionToken ?? (parameter.initializer ? ts.factory.createToken(ts.SyntaxKind.QuestionToken) : undefined), parameter.type, undefined)),
			method.type,
		));
	}
	writeFileSync(join(outputDir, 'methods.ts'), `import type { ${className} } from '../${stem}.ts';\n${methodModuleImports.join('\n')}\n\nexport function install${className}Methods(prototype: ${className}) {\n${methodInstallations.join('\n')}\n}\n`, 'utf8');
	const methodImport = ts.factory.createImportDeclaration(
		undefined,
		ts.factory.createImportClause(false, undefined, ts.factory.createNamespaceImport(ts.factory.createIdentifier('extractedMethods'))),
		ts.factory.createStringLiteral(`./${stem}/methods.ts`),
		undefined,
	);
	const interfaceImport = ts.factory.createImportDeclaration(undefined, undefined, ts.factory.createStringLiteral(`./${stem}/interface.ts`), undefined);

	const retainedMembers = classNode.members
		.filter((member) => !methods.includes(member as ts.MethodDeclaration))
		.map((member) => {
			if (ts.isPropertyDeclaration(member)) return ts.factory.updatePropertyDeclaration(member, withoutAccessModifiers(member.modifiers), member.name, member.questionToken ?? member.exclamationToken, member.type, member.initializer);
			if (ts.isConstructorDeclaration(member)) {
				const parameters = member.parameters.map((parameter) => ts.factory.updateParameterDeclaration(parameter, withoutAccessModifiers(parameter.modifiers), parameter.dotDotDotToken, parameter.name, parameter.questionToken, parameter.type, parameter.initializer));
				return ts.factory.updateConstructorDeclaration(member, withoutAccessModifiers(member.modifiers), parameters, member.body);
			}
			return member;
		});
	const updatedClass = ts.factory.updateClassDeclaration(classNode, classNode.modifiers, classNode.name, classNode.typeParameters, classNode.heritageClauses, retainedMembers);
	const interfaceNode = ts.factory.createInterfaceDeclaration(
		[ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
		className,
		classNode.typeParameters,
		undefined,
		interfaceMembers,
	);
	const interfaceText = `${imports.map((statement) => printer.printNode(ts.EmitHint.Unspecified, adjustedImport(source, statement), source)).join('\n')}\n\ndeclare module '../${stem}.ts' {\n${printer.printNode(ts.EmitHint.Unspecified, interfaceNode, source).replace(/^export /u, '').split('\n').map((line) => `\t${line}`).join('\n')}\n}\n\nexport {};\n`;
	if (interfaceText.split('\n').length > 500) throw new Error(`${path}: extracted interface remains ${interfaceText.split('\n').length} lines`);
	writeFileSync(join(outputDir, 'interface.ts'), interfaceText, 'utf8');
	assignments.push(ts.factory.createExpressionStatement(ts.factory.createCallExpression(
		ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('extractedMethods'), `install${className}Methods`),
		undefined,
		[ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(className), 'prototype')],
	)));
	const statements: ts.Statement[] = [];
	for (const statement of source.statements) {
		if (ts.isImportDeclaration(statement)) {
			statements.push(statement);
			continue;
		}
		if (statement === classNode) {
			statements.push(methodImport, interfaceImport, updatedClass, ...assignments);
			continue;
		}
		statements.push(exportTopLevel(statement));
	}
	const output = printer.printFile(ts.factory.updateSourceFile(source, statements));
	if (output.split('\n').length > 500) throw new Error(`${path}: class shell remains ${output.split('\n').length} lines`);
	writeFileSync(path, output, 'utf8');
	console.log(`${path}: extracted ${methods.length} ${className} methods`);
}

const [path, className] = process.argv.slice(2);
if (!path) throw new Error('Usage: split-class-methods.ts <path> [ClassName]');
split(path, className);
