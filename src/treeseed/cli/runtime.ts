import { packageScriptPath } from '../scripts/package-tools.ts';
import { findNearestTreeseedRoot, findNearestTreeseedWorkspaceRoot, isWorkspaceRoot } from '../scripts/workspace-tools.ts';
import {
	TreeseedOperationsSdk,
	createTreeseedCommandContext,
	writeTreeseedResult,
	type TreeseedCommandContext,
	type TreeseedCommandSpec,
	type TreeseedSpawner,
	type TreeseedWriter,
} from '../../operations.ts';
import { COMMAND_HANDLERS } from './registry.js';
import { renderUsage } from './help.js';

function formatWorkspaceError(spec: TreeseedCommandSpec) {
	return [
		`Treeseed command \`${spec.name}\` must be run inside a Treeseed workspace.`,
		`Usage: ${renderUsage(spec)}`,
		`Run \`treeseed help ${spec.name}\` for details.`,
	].join('\n');
}

function formatProjectError(spec: TreeseedCommandSpec) {
	return [
		`Treeseed command \`${spec.name}\` must be run inside a Treeseed project.`,
		'No ancestor directory containing `treeseed.site.yaml` was found.',
		`Usage: ${renderUsage(spec)}`,
		`Run \`treeseed help ${spec.name}\` for details.`,
	].join('\n');
}

function commandNeedsProjectRoot(spec: TreeseedCommandSpec) {
	return spec.name !== 'init';
}

export function resolveTreeseedCommandCwd(spec: TreeseedCommandSpec, cwd: string) {
	if (!commandNeedsProjectRoot(spec)) {
		return {
			cwd,
			resolvedProjectRoot: null,
			resolvedWorkspaceRoot: null,
		};
	}

	const resolvedProjectRoot = findNearestTreeseedRoot(cwd);
	const resolvedWorkspaceRoot = resolvedProjectRoot ? findNearestTreeseedWorkspaceRoot(resolvedProjectRoot) : null;

	return {
		cwd: resolvedProjectRoot ?? cwd,
		resolvedProjectRoot,
		resolvedWorkspaceRoot,
	};
}

function resolveAdapter(spec: TreeseedCommandSpec, cwd: string) {
	const adapter = spec.adapter;
	if (!adapter) return { error: `Treeseed command \`${spec.name}\` is missing adapter metadata.` };
	const resolved = resolveTreeseedCommandCwd(spec, cwd);
	if (!resolved.resolvedProjectRoot && commandNeedsProjectRoot(spec)) {
		return { error: formatProjectError(spec) };
	}
	if (adapter.requireWorkspaceRoot && !resolved.resolvedWorkspaceRoot) {
		return { error: formatWorkspaceError(spec) };
	}

	const scriptName = adapter.workspaceScript || adapter.directScript
		? (resolved.resolvedWorkspaceRoot && isWorkspaceRoot(resolved.resolvedWorkspaceRoot) ? (adapter.workspaceScript ?? adapter.script) : (adapter.directScript ?? adapter.script))
		: adapter.script;

	return {
		scriptPath: packageScriptPath(scriptName),
		extraArgs: adapter.extraArgs ?? [],
		rewriteArgs: adapter.rewriteArgs,
	};
}

const operationsSdk = new TreeseedOperationsSdk({
	resolveHandler: (handlerName) => COMMAND_HANDLERS[handlerName as keyof typeof COMMAND_HANDLERS] ?? null,
	resolveAdapter,
});

export { createTreeseedCommandContext };
export type { TreeseedCommandContext, TreeseedSpawner, TreeseedWriter };

export async function executeTreeseedCommand(commandName: string, argv: string[], context: TreeseedCommandContext) {
	const spec = operationsSdk.findOperation(commandName);
	if (!spec) {
		return operationsSdk.executeOperation({ commandName, argv }, context);
	}

	const resolved = resolveTreeseedCommandCwd(spec, context.cwd);
	if (commandNeedsProjectRoot(spec) && !resolved.resolvedProjectRoot) {
		return writeTreeseedResult({
			exitCode: 1,
			stderr: [formatProjectError(spec)],
			report: {
				command: spec.name,
				ok: false,
				error: `No ancestor containing treeseed.site.yaml was found from ${context.cwd}.`,
				hint: `treeseed help ${spec.name}`,
			},
		}, { ...context, outputFormat: argv.includes('--json') ? 'json' : (context.outputFormat ?? 'human') });
	}

	return operationsSdk.executeOperation({ commandName, argv }, { ...context, cwd: resolved.cwd });
}

export async function runTreeseedCli(argv: string[], overrides: Partial<TreeseedCommandContext> = {}) {
	const [firstArg] = argv;
	const spec = firstArg ? operationsSdk.findOperation(firstArg) : null;
	if (!spec) {
		return operationsSdk.run(argv, overrides);
	}

	const baseCwd = overrides.cwd ?? process.cwd();
	const resolved = resolveTreeseedCommandCwd(spec, baseCwd);
	if (commandNeedsProjectRoot(spec) && !resolved.resolvedProjectRoot) {
		return writeTreeseedResult({
			exitCode: 1,
			stderr: [formatProjectError(spec)],
			report: {
				command: spec.name,
				ok: false,
				error: `No ancestor containing treeseed.site.yaml was found from ${baseCwd}.`,
				hint: `treeseed help ${spec.name}`,
			},
		}, createTreeseedCommandContext({
			...overrides,
			outputFormat: argv.includes('--json') ? 'json' : (overrides.outputFormat ?? 'human'),
		}));
	}
	const contextOverrides = commandNeedsProjectRoot(spec) && resolved.resolvedProjectRoot
		? { ...overrides, cwd: resolved.cwd }
		: overrides;

	return operationsSdk.run(argv, contextOverrides);
}
