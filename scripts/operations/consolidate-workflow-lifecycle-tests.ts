import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import ts from 'typescript';

const paths = process.argv.slice(2);
if (paths.length < 2) throw new Error('Pass the split workflow lifecycle test files to consolidate.');

type GroupName = 'branch-worktree' | 'recovery' | 'release' | 'save-stage';
type Scenario = { source: ts.SourceFile; statement: ts.Statement; title: string };

function callName(statement: ts.Statement) {
	if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return null;
	const expression = statement.expression.expression;
	return ts.isIdentifier(expression) ? expression.text : null;
}

function describeBody(statement: ts.Statement) {
	if (callName(statement) !== 'describe' || !ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return null;
	const callback = statement.expression.arguments[1];
	return callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) && ts.isBlock(callback.body)
		? callback.body.statements
		: null;
}

function titleOf(statement: ts.Statement) {
	if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return '';
	const title = statement.expression.arguments[0];
	return title && (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title)) ? title.text : '';
}

function groupFor(title: string): GroupName {
	if (/release|production image|starter templates|hosted gate/u.test(title)) return 'release';
	if (/recover|resume|failed save|workflow lock|partial recursive|dirty staging work/u.test(title)) return 'recovery';
	if (/switch|worktree|close|detached|package staging history|branch checkout/u.test(title)) return 'branch-worktree';
	return 'save-stage';
}

const parsed = paths.map((path) => {
	const text = readFileSync(path, 'utf8');
	return { path, source: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) };
});
const first = parsed[0]!;
const firstDescribe = first.source.statements.find((statement) => callName(statement) === 'describe');
if (!firstDescribe) throw new Error('The first input has no describe suite.');
const firstBody = describeBody(firstDescribe);
if (!firstBody) throw new Error('The first describe suite has no block body.');

const prefix = first.source.statements
	.filter((statement) => statement !== firstDescribe)
	.map((statement) => statement.getFullText(first.source).trim())
	.join('\n');
const shared = firstBody
	.filter((statement) => !['it', 'test', 'describe'].includes(callName(statement) ?? ''))
	.map((statement) => statement.getFullText(first.source).trim())
	.join('\n\n');
const grouped = new Map<GroupName, Scenario[]>([
	['save-stage', []],
	['branch-worktree', []],
	['recovery', []],
	['release', []],
]);

for (const { source } of parsed) {
	const suite = source.statements.find((statement) => callName(statement) === 'describe');
	const body = suite ? describeBody(suite) : null;
	if (!body) throw new Error(`${source.fileName}: expected a describe block`);
	for (const statement of body) {
		if (!['it', 'test', 'describe'].includes(callName(statement) ?? '')) continue;
		const title = titleOf(statement);
		grouped.get(groupFor(title))!.push({ source, statement, title });
	}
}

for (const [group, scenarios] of grouped) {
	const scenarioText = scenarios
		.sort((left, right) => left.title.localeCompare(right.title))
		.map(({ source, statement }) => statement.getFullText(source).trim())
		.join('\n\n');
	const output = `${prefix}\n\ndescribe('treeseed workflow lifecycle: ${group}', () => {\n${shared}\n\n${scenarioText}\n});\n`;
	if (output.split('\n').length > 500) throw new Error(`${group} output exceeds 500 lines`);
	writeFileSync(join(dirname(first.path), `workflow-lifecycle.${group}.test.ts`), output);
}

for (const { path } of parsed) {
	if (/workflow-lifecycle\.(?:branch-worktree|recovery|release|save-stage)\.test\.ts$/u.test(basename(path))) continue;
	unlinkSync(path);
}
