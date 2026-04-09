import { isWorkspaceRoot, packageScriptPath } from '../scripts/package-tools.ts';
import {
	TreeseedOperationsSdk,
	createTreeseedCommandContext,
	type TreeseedCommandContext,
	type TreeseedCommandSpec,
	type TreeseedSpawner,
	type TreeseedWriter,
} from '../../operations.ts';
import { COMMAND_HANDLERS } from './registry.js';
import { renderUsage } from './help.js';

function formatWorkspaceError(spec: TreeseedCommandSpec) {
	return [
		`Treeseed command \`${spec.name}\` must be run from a workspace root.`,
		`Usage: ${renderUsage(spec)}`,
		`Run \`treeseed help ${spec.name}\` for details.`,
	].join('\n');
}

function resolveAdapter(spec: TreeseedCommandSpec, cwd: string) {
	const adapter = spec.adapter;
	if (!adapter) return { error: `Treeseed command \`${spec.name}\` is missing adapter metadata.` };
	if (adapter.requireWorkspaceRoot && !isWorkspaceRoot(cwd)) {
		return { error: formatWorkspaceError(spec) };
	}

	const scriptName = adapter.workspaceScript || adapter.directScript
		? (isWorkspaceRoot(cwd) ? (adapter.workspaceScript ?? adapter.script) : (adapter.directScript ?? adapter.script))
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
	return operationsSdk.executeOperation({ commandName, argv }, context);
}

export async function runTreeseedCli(argv: string[], overrides: Partial<TreeseedCommandContext> = {}) {
	return operationsSdk.run(argv, overrides);
}
