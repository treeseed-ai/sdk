import type { CommandLeafDescriptor, CommandNodeDescriptor } from '../../command-tree.ts';
import { identityLoginCommand } from '../services/identity-commands.ts';

type Execution = CommandLeafDescriptor['execution'];
export const unavailable = (reason = 'This capability is not enabled until its control-plane operation is accepted.'): Execution => ({
	kind: 'unavailable', code: 'standards_migration_not_enabled', reason,
});
export const protocol = (handlerId: `protocol.${string}`): Execution => ({ kind: 'protocol', handlerId });
export const local = (handlerId: `local.${string}`): Execution => ({ kind: 'local', handlerId });
export const field = (target: 'path' | 'query' | 'body', name: string, source: 'argument' | 'context' | 'option', sourceName = name, required = false, transform: 'identity' | 'integer' | 'csv' = 'identity') => ({ target, field: name, source, name: sourceName, required, transform });
export const operation = (operationId: `${string}.${string}`, input: ReturnType<typeof field>[] = []): Execution => ({ kind: 'operation', operationId, input });
export const page = () => [field('query', 'status', 'option'), field('query', 'limit', 'option', 'limit', false, 'integer'), field('query', 'cursor', 'option')];
export const aiNode = () => field('path', 'nodeId', 'context', 'node', true);
export const aiInstance = () => [field('path', 'teamId', 'context', 'team', true), field('path', 'instanceId', 'context', 'node', true)];
export const planOption = { name: '--plan', description: 'Return the exact proposed outcome without mutation.', type: 'boolean' as const };

export function leaf(segment: string, kind: 'read' | 'mutation' = 'read', argument?: string, confirmation: 'never' | 'destructive' | 'credential' | 'authority' | 'production' | 'irreversible' = 'never'): CommandNodeDescriptor {
	const value: CommandLeafDescriptor = {
		segment, description: `${segment[0]!.toUpperCase()}${segment.slice(1)} the selected resource.`, kind,
		arguments: argument ? [{ name: argument, description: `${argument} identity or path.`, required: true }] : undefined,
		options: kind === 'mutation' ? [planOption] : undefined,
		authorization: kind === 'mutation' ? { capability: `command.${segment}`, confirmation } : undefined,
		resultSchemaId: `treeseed.command.${segment}/v1`, execution: unavailable(),
	};
	return { nodeType: 'leaf', ...value };
}

export function branch(segment: string, children: CommandNodeDescriptor[]): CommandNodeDescriptor {
	return { nodeType: 'branch', segment, description: `${segment[0]!.toUpperCase()}${segment.slice(1)} operations.`, children };
}

export function addOptions(node: CommandNodeDescriptor, options: NonNullable<CommandLeafDescriptor['options']>): CommandNodeDescriptor {
	if (node.nodeType === 'leaf') node.options = [...(node.options ?? []), ...options];
	return node;
}

export function configurationAdopt(): CommandNodeDescriptor {
	const value = leaf('adopt', 'mutation', 'file', 'destructive');
	if (value.nodeType !== 'leaf') throw new Error('Configuration adoption must be a leaf command.');
	value.options = [...(value.options ?? []), { name: '--confirm', description: 'Confirm replacement of the installed configuration identity.', type: 'boolean' }];
	return value;
}

export function hostReset(): CommandNodeDescriptor {
	const value = leaf('reset', 'mutation', undefined, 'irreversible');
	if (value.nodeType !== 'leaf') throw new Error('Host reset must be a leaf command.');
	value.description = 'Stop managed components, erase their state, and reconcile a fresh unseeded platform.';
	value.options = [...(value.options ?? []), { name: '--confirm', description: 'Confirm deletion of all manager-owned component data and receipts.', type: 'boolean' }];
	return value;
}

export function hostUninstall(): CommandNodeDescriptor {
	const value = leaf('uninstall', 'mutation', undefined, 'irreversible');
	if (value.nodeType !== 'leaf') throw new Error('Host uninstall must be a leaf command.');
	value.description = 'Plan or remove every inventoried TreeSeed-owned host resource while preserving unrelated infrastructure and source repositories.';
	value.options = [...(value.options ?? []),
		{ name: '--confirm', description: 'Confirm removal of the reviewed TreeSeed resource inventory.', type: 'boolean' },
		{ name: '--purge-security', description: 'Separately select destruction of encrypted state, credentials, users, and groups.', type: 'boolean' },
		{ name: '--yes', description: 'Confirm non-interactive execution after reviewing the plan.', type: 'boolean' },
	];
	value.resultSchemaId = 'treeseed.host-uninstall-result/v1';
	return value;
}

export function hostInitialize(): CommandNodeDescriptor {
	const value = leaf('initialize', 'mutation', undefined, 'authority');
	if (value.nodeType !== 'leaf') throw new Error('Host initialize must be a leaf command.');
	value.description = 'Initialize the generic host foundation from an immutable catalog-bound profile.';
	value.options = [...(value.options ?? []),
		{ name: '--input-file', description: 'Team capacity installation configuration downloaded from Admin. Values are never printed.', type: 'string' },
		{ name: '--profile', description: 'Catalog-bound host initialization profile.', type: 'string', required: true },
		{ name: '--confirm', description: 'Confirm installation of the reviewed profile plan.', type: 'boolean' },
		{ name: '--yes', description: 'Confirm non-interactive execution after reviewing the plan.', type: 'boolean' },
	];
	value.resultSchemaId = 'treeseed.host-initialization-result/v1';
	return value;
}

export function hostSecurityInitialize(): CommandNodeDescriptor {
	const value = leaf('initialize', 'mutation', undefined, 'credential');
	if (value.nodeType !== 'leaf') throw new Error('Host security initialization must be a leaf command.');
	value.description = 'Initialize the encrypted provider volume, application keys, and offline recovery bundle.';
	value.options = [...(value.options ?? []), { name: '--recovery-bundle', description: 'Absolute path for the new encrypted offline recovery bundle.', type: 'string', required: true }, { name: '--confirm', description: 'Confirm provider-state migration and volume formatting.', type: 'boolean', required: true }];
	return value;
}

export function hostSecurityRotate(): CommandNodeDescriptor {
	const value = leaf('rotate', 'mutation', 'target', 'credential');
	if (value.nodeType !== 'leaf') throw new Error('Host security rotation must be a leaf command.');
	value.options = [...(value.options ?? []),
		{ name: '--recovery-bundle', description: 'Absolute path to the currently authenticated recovery bundle.', type: 'string', required: true },
		{ name: '--new-recovery-bundle', description: 'Absolute non-existing path for the replacement recovery bundle.', type: 'string', required: true },
		{ name: '--confirm', description: 'Confirm creation and activation of a new key generation.', type: 'boolean', required: true }];
	return value;
}

export function hostProviderCredentialInitialize(): CommandNodeDescriptor {
	const value = leaf('initialize', 'mutation', 'initializer', 'credential');
	if (value.nodeType !== 'leaf') throw new Error('Provider credential initialization must be a leaf command.');
	value.description = 'Initialize an execution-provider credential through its registered host initializer.';
	value.options = [...(value.options ?? []), { name: '--source', description: 'Registered credential source to use instead of automatic selection.', type: 'string' }];
	return value;
}

export function hostRecoveryVerify(): CommandNodeDescriptor {
	return { nodeType: 'leaf', segment: 'verify', description: 'Authenticate and inventory an offline recovery bundle without revealing secrets.', kind: 'read',
		options: [{ name: '--bundle', description: 'Absolute recovery bundle path.', type: 'string', required: true }], resultSchemaId: 'treeseed.host-recovery-verification/v1', execution: unavailable() };
}

export function aiModeSet(): CommandNodeDescriptor {
	const value = leaf('set', 'mutation', 'mode', 'authority');
	if (value.nodeType !== 'leaf') throw new Error('AI mode set must be a leaf command.');
	value.description = 'Transition the exclusive AI GPU resource to awake or sleep.';
	value.options = [...(value.options ?? []),
		{ name: '--idempotency-key', description: 'Replay-safe transition identity.', type: 'string' },
		{ name: '--drain-timeout', description: 'Maximum drain wait in seconds.', type: 'number' },
	];
	value.authorization = { capability: 'host.ai.mode', confirmation: 'authority' };
	value.resultSchemaId = 'treeseed.ai-mode-transition-receipt/v1';
	return value;
}

export function userCreate(): CommandNodeDescriptor {
	const value = leaf('create', 'mutation');
	if (value.nodeType !== 'leaf') throw new Error('User creation must be a leaf command.');
	value.description = 'Create a local TreeSeed user with a securely prompted password.';
	value.options = [...(value.options ?? []),
		{ name: '--email', description: 'Email address for the new user.', type: 'string' },
		{ name: '--username', description: 'Unique username for the new user.', type: 'string' },
		{ name: '--display-name', description: 'Human-readable display name.', type: 'string' },
		{ name: '--timeout', description: 'Maximum seconds to wait for registration.', type: 'number' },
	];
	return value;
}

export function authLogin(): CommandNodeDescriptor { return identityLoginCommand(leaf('login', 'mutation')); }

export function libraryRead(segment: string, extraArguments: string[] = [], extraOptions: CommandLeafDescriptor['options'] = []): CommandNodeDescriptor {
	return {
		nodeType: 'leaf', segment, description: `${segment[0]!.toUpperCase()}${segment.slice(1)} project library knowledge.`, kind: 'read',
		arguments: ['project', ...extraArguments].map((name) => ({ name, description: `${name} value.`, required: true })),
		options: [{ name: '--ref', description: 'Earlier historical revision; omit for the current library.', type: 'string' }, ...extraOptions],
		resultSchemaId: `treeseed.command.library.${segment}/v1`, execution: local(`local.library.${segment}`),
	};
}

export function developmentCommand(segment: string, kind: 'read' | 'mutation', argument?: string, options: NonNullable<CommandLeafDescriptor['options']> = []): CommandNodeDescriptor {
	return {
		nodeType: 'leaf', segment, description: `${segment[0]!.toUpperCase()}${segment.slice(1)} a local development session.`, kind,
		arguments: argument ? [{ name: argument, description: `${argument} value.`, required: true }] : undefined,
		options: [...(kind === 'mutation' ? [planOption] : []), ...options],
		authorization: kind === 'mutation' ? { capability: `development.${segment}`, confirmation: 'never' } : undefined,
		resultSchemaId: `treeseed.command.dev.${segment}/v1`, execution: local(`local.dev.${segment}`),
	};
}
