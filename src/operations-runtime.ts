import { spawnSync } from 'node:child_process';
import type {
	TreeseedAdapterResolver,
	TreeseedCommandContext,
	TreeseedHandlerResolver,
	TreeseedOperationRequest,
	TreeseedOperationResult,
	TreeseedOperationSpec,
	TreeseedSpawner,
	TreeseedWriter,
} from './operations-types.ts';
import { renderTreeseedHelp, renderUsage, suggestTreeseedCommands } from './operations-help.ts';
import { parseTreeseedInvocation, validateTreeseedInvocation } from './operations-parser.ts';
import { findTreeseedOperation, TRESEED_OPERATION_SPECS } from './operations-registry.ts';

function isHelpFlag(value: string | undefined) {
	return value === '--help' || value === '-h';
}

function defaultWrite(output: string, stream: 'stdout' | 'stderr' = 'stdout') {
	if (!output) return;
	(stream === 'stderr' ? process.stderr : process.stdout).write(`${output}\n`);
}

function defaultSpawn(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; stdio?: 'inherit' }) {
	return spawnSync(command, args, options);
}

function formatValidationError(spec: TreeseedOperationSpec, errors: string[]) {
	return [
		...errors,
		`Usage: ${renderUsage(spec)}`,
		`Run \`treeseed help ${spec.name}\` for details.`,
	].join('\n');
}

export function createTreeseedCommandContext(overrides: Partial<TreeseedCommandContext> = {}): TreeseedCommandContext {
	return {
		cwd: overrides.cwd ?? process.cwd(),
		env: overrides.env ?? process.env,
		write: overrides.write ?? (defaultWrite as TreeseedWriter),
		spawn: overrides.spawn ?? (defaultSpawn as TreeseedSpawner),
		outputFormat: overrides.outputFormat ?? 'human',
		prompt: overrides.prompt,
		confirm: overrides.confirm,
	};
}

export function writeTreeseedResult(result: TreeseedOperationResult | { exitCode?: number; stdout?: string[]; stderr?: string[]; report?: Record<string, unknown> | null }, context: TreeseedCommandContext) {
	if (context.outputFormat === 'json') {
		const payload = result.report ?? {
			ok: (result.exitCode ?? 0) === 0,
			stdout: result.stdout ?? [],
			stderr: result.stderr ?? [],
		};
		context.write(JSON.stringify(payload, null, 2), (result.exitCode ?? 0) === 0 ? 'stdout' : 'stderr');
		return result.exitCode ?? 0;
	}

	for (const line of result.stdout ?? []) {
		context.write(line, 'stdout');
	}
	for (const line of result.stderr ?? []) {
		context.write(line, 'stderr');
	}
	return result.exitCode ?? 0;
}

export type TreeseedOperationsSdkOptions = {
	resolveHandler?: TreeseedHandlerResolver;
	resolveAdapter?: TreeseedAdapterResolver;
};

export class TreeseedOperationsSdk {
	constructor(private readonly options: TreeseedOperationsSdkOptions = {}) {}

	listOperations() {
		return [...TRESEED_OPERATION_SPECS];
	}

	findOperation(name: string | null | undefined) {
		return findTreeseedOperation(name);
	}

	parseInvocation(spec: TreeseedOperationSpec, argv: string[]) {
		return parseTreeseedInvocation(spec, argv);
	}

	validateInvocation(spec: TreeseedOperationSpec, argv: string[]) {
		return validateTreeseedInvocation(spec, parseTreeseedInvocation(spec, argv));
	}

	private async executeHandler(spec: TreeseedOperationSpec, argv: string[], context: TreeseedCommandContext) {
		try {
			const invocation = parseTreeseedInvocation(spec, argv);
			const errors = validateTreeseedInvocation(spec, invocation);
			const handlerContext: TreeseedCommandContext = {
				...context,
				outputFormat: invocation.args.json === true ? 'json' : (context.outputFormat ?? 'human'),
			};
			if (errors.length > 0) {
				return writeTreeseedResult({
					exitCode: 1,
					stderr: [formatValidationError(spec, errors)],
					report: {
						command: spec.name,
						ok: false,
						error: errors.join(' '),
						errors,
						usage: renderUsage(spec),
					},
				}, handlerContext);
			}

			const handlerName = spec.handlerName;
			if (!handlerName) {
				return writeTreeseedResult({ exitCode: 1, stderr: [`Treeseed command \`${spec.name}\` is missing a handler binding.`] }, handlerContext);
			}
			const handler = this.options.resolveHandler?.(handlerName) ?? null;
			if (!handler) {
				return writeTreeseedResult({
					exitCode: 1,
					stderr: [`Treeseed command \`${spec.name}\` is not executable in this runtime.`],
					report: {
						command: spec.name,
						ok: false,
						error: `No handler registered for ${handlerName}.`,
					},
				}, handlerContext);
			}
			const result = await handler(invocation, handlerContext);
			return writeTreeseedResult(result, handlerContext);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const wantsJson = argv.includes('--json');
			return writeTreeseedResult({
				exitCode: 1,
				stderr: [message, `Run \`treeseed help ${spec.name}\` for details.`],
				report: {
					command: spec.name,
					ok: false,
					error: message,
					hint: `treeseed help ${spec.name}`,
				},
			}, { ...context, outputFormat: wantsJson ? 'json' : (context.outputFormat ?? 'human') });
		}
	}

	private executeAdapter(spec: TreeseedOperationSpec, argv: string[], context: TreeseedCommandContext) {
		const resolved = this.options.resolveAdapter?.(spec, context.cwd);
		if (!resolved) {
			return writeTreeseedResult({
				exitCode: 1,
				stderr: [`Treeseed command \`${spec.name}\` is not executable in this runtime.`],
			}, context);
		}
		if ('error' in resolved) {
			return writeTreeseedResult({ exitCode: 1, stderr: [resolved.error] }, context);
		}

		const rewritten = resolved.rewriteArgs ? resolved.rewriteArgs(argv) : argv;
		const result = context.spawn(process.execPath, [resolved.scriptPath, ...resolved.extraArgs, ...rewritten], {
			cwd: context.cwd,
			env: { ...context.env },
			stdio: 'inherit',
		});
		return result.status ?? 1;
	}

	private executeAgents(argv: string[], context: TreeseedCommandContext) {
		if (argv.some(isHelpFlag)) {
			context.write([
				'agents  Run the Treeseed agents entrypoint.',
				'',
				'Usage',
				'  treeseed agents [args...]',
				'',
				'Notes',
				'  - Delegates directly to the installed treeseed-agents command.',
			].join('\n'), 'stdout');
			return 0;
		}

		const command = process.platform === 'win32' ? 'treeseed-agents.cmd' : 'treeseed-agents';
		const result = context.spawn(command, argv, {
			cwd: context.cwd,
			env: { ...context.env },
			stdio: 'inherit',
		});
		return result.status ?? 1;
	}

	async executeOperation(request: TreeseedOperationRequest, overrides: Partial<TreeseedCommandContext> = {}) {
		const context = createTreeseedCommandContext(overrides);
		const argv = request.argv ?? [];
		const commandName = request.commandName;

		if (commandName === 'agents') {
			return this.executeAgents(argv, context);
		}

		const spec = findTreeseedOperation(commandName);
		if (!spec) {
			const suggestions = suggestTreeseedCommands(commandName);
			const lines = [`Unknown treeseed command: ${commandName}`];
			if (suggestions.length > 0) {
				lines.push(`Did you mean: ${suggestions.map((value) => `\`${value}\``).join(', ')}?`);
			}
			lines.push('Run `treeseed help` to see the full command list.');
			return writeTreeseedResult({ exitCode: 1, stderr: [lines.join('\n')] }, context);
		}

		if (argv.some(isHelpFlag)) {
			context.write(renderTreeseedHelp(spec.name), 'stdout');
			return 0;
		}

		return spec.executionMode === 'adapter'
			? this.executeAdapter(spec, argv, context)
			: this.executeHandler(spec, argv, context);
	}

	async run(argv: string[], overrides: Partial<TreeseedCommandContext> = {}) {
		const context = createTreeseedCommandContext(overrides);
		const [firstArg, ...restArgs] = argv;

		if (!firstArg || isHelpFlag(firstArg) || firstArg === 'help') {
			const commandName = firstArg === 'help' ? (restArgs[0] ?? null) : null;
			const helpText = renderTreeseedHelp(commandName);
			context.write(helpText, 'stdout');
			return commandName && helpText.startsWith('Unknown treeseed command:') ? 1 : 0;
		}

		return this.executeOperation({ commandName: firstArg, argv: restArgs }, context);
	}
}
