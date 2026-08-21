export type CommandOperationKind = 'read' | 'mutation';
export type CommandExecutionMode = 'execute' | 'plan';

export type CommandErrorCategory =
	| 'unknown_command'
	| 'invalid_input'
	| 'ambiguous_context'
	| 'authentication_required'
	| 'authorization_denied'
	| 'confirmation_required'
	| 'policy_blocked'
	| 'stale_preflight'
	| 'conflict'
	| 'not_found'
	| 'provider_unavailable'
	| 'rate_limited'
	| 'internal_error';

export interface CommandArgumentDescriptor {
	name: string;
	description: string;
	required: boolean;
	multiple?: boolean;
}

export interface CommandOptionDescriptor {
	name: `--${string}`;
	description: string;
	type: 'boolean' | 'string' | 'number' | 'string[]';
	required?: boolean;
	defaultValue?: boolean | string | number | string[];
	sensitive?: boolean;
}

export interface CommandAuthorizationDescriptor {
	capability: string;
	confirmation: 'never' | 'destructive' | 'credential' | 'authority' | 'production' | 'irreversible';
}

export interface CommandLeafDescriptor {
	segment: string;
	description: string;
	kind: CommandOperationKind;
	arguments?: CommandArgumentDescriptor[];
	options?: CommandOptionDescriptor[];
	authorization?: CommandAuthorizationDescriptor;
	resultSchemaId: string;
}

export interface CommandBranchDescriptor {
	segment: string;
	description: string;
	children: CommandNodeDescriptor[];
}

export type CommandNodeDescriptor =
	| ({ nodeType: 'branch' } & CommandBranchDescriptor)
	| ({ nodeType: 'leaf' } & CommandLeafDescriptor);

export interface CommandTreeDescriptor {
	schemaVersion: 'treeseed.command-tree/v1';
	executable: 'trsd';
	commands: CommandNodeDescriptor[];
}

export interface CommandBlocker {
	code: string;
	message: string;
	path?: string;
}

export interface CommandReceiptReference {
	kind: string;
	id: string;
	digest?: string;
	uri?: string;
}

export interface CommandResultEnvelope<TResult = unknown> {
	schemaVersion: 'treeseed.command-result/v1';
	commandPath: string[];
	mode: CommandExecutionMode;
	ok: boolean;
	result: TResult | null;
	error: { category: CommandErrorCategory; code: string; message: string } | null;
	warnings: string[];
	blockers: CommandBlocker[];
	receipts: CommandReceiptReference[];
	nextActions: string[];
}

export interface CommandTreeDiagnostic {
	code: string;
	path: string;
	message: string;
}

const SEGMENT = /^[a-z][a-z0-9]*$/;
const FORBIDDEN_AGENT_MANAGEMENT_OPTIONS = new Set([
	'--commit',
	'--commit-sha',
	'--source-ref',
	'--expected-base',
	'--expected-commit',
	'--branch',
	'--checkpoint',
	'--integration',
]);

export function validateCommandTree(tree: CommandTreeDescriptor): CommandTreeDiagnostic[] {
	const diagnostics: CommandTreeDiagnostic[] = [];
	if (tree.schemaVersion !== 'treeseed.command-tree/v1') diagnostics.push({ code: 'schema_version_invalid', path: 'schemaVersion', message: 'Command tree schemaVersion must be treeseed.command-tree/v1.' });
	if (tree.executable !== 'trsd') diagnostics.push({ code: 'executable_invalid', path: 'executable', message: 'trsd is the only public executable.' });

	const visit = (nodes: CommandNodeDescriptor[], parent: string[]): void => {
		const segments = new Set<string>();
		for (const [index, node] of nodes.entries()) {
			const path = [...parent, node.segment];
			const diagnosticPath = `commands.${path.join('.')}`;
			if (!SEGMENT.test(node.segment)) diagnostics.push({ code: 'command_segment_invalid', path: diagnosticPath, message: 'Command path segments must be lowercase alphanumeric words without colons or hyphens.' });
			if (segments.has(node.segment)) diagnostics.push({ code: 'command_path_duplicate', path: diagnosticPath, message: `Duplicate command segment ${node.segment}.` });
			segments.add(node.segment);
			const raw = node as unknown as Record<string, unknown>;
			if ('alias' in raw || 'aliases' in raw) diagnostics.push({ code: 'command_alias_forbidden', path: diagnosticPath, message: 'Public command aliases are forbidden.' });
			if (node.nodeType === 'branch') {
				if ('kind' in raw || 'resultSchemaId' in raw || 'options' in raw || 'arguments' in raw) diagnostics.push({ code: 'command_node_ambiguous', path: diagnosticPath, message: 'Intermediate command nodes cannot also declare leaf behavior.' });
				if (!Array.isArray(node.children) || node.children.length === 0) diagnostics.push({ code: 'command_branch_empty', path: diagnosticPath, message: 'Intermediate command nodes must contain at least one child.' });
				visit(node.children ?? [], path);
				continue;
			}
			if ('children' in raw) diagnostics.push({ code: 'command_node_ambiguous', path: diagnosticPath, message: 'Leaf command nodes cannot contain child commands.' });
			if (!node.resultSchemaId.trim()) diagnostics.push({ code: 'result_schema_required', path: `${diagnosticPath}.resultSchemaId`, message: 'Leaf commands require a stable result schema.' });
			const optionNames = new Set<string>();
			for (const option of node.options ?? []) {
				if (optionNames.has(option.name)) diagnostics.push({ code: 'command_option_duplicate', path: `${diagnosticPath}.options.${index}`, message: `Duplicate option ${option.name}.` });
				optionNames.add(option.name);
				if (option.name === '--execute') diagnostics.push({ code: 'execute_option_forbidden', path: `${diagnosticPath}.options.${option.name}`, message: 'Mutations execute by default; --plan is the only dry-run switch.' });
				if (parent[0] === 'agents' && FORBIDDEN_AGENT_MANAGEMENT_OPTIONS.has(option.name)) diagnostics.push({ code: 'agent_internal_option_forbidden', path: `${diagnosticPath}.options.${option.name}`, message: 'Agent management commands cannot expose repository integration mechanics.' });
			}
			if (node.kind === 'mutation' && !optionNames.has('--plan')) diagnostics.push({ code: 'mutation_plan_option_required', path: `${diagnosticPath}.options`, message: 'Every mutation must expose universal zero-mutation --plan mode.' });
		}
	};

	visit(tree.commands, []);
	return diagnostics;
}

export function createCommandResult<TResult>(input: Omit<CommandResultEnvelope<TResult>, 'schemaVersion'>): CommandResultEnvelope<TResult> {
	return { schemaVersion: 'treeseed.command-result/v1', ...input };
}
