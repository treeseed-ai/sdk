import {
	AGENT_CLI_ALLOW_TOOLS,
	type AgentCliAllowTool,
	type AgentCliOptions,
} from './types/agents.ts';

const ALLOWED_TOOL_SET = new Set<string>(AGENT_CLI_ALLOW_TOOLS);

function normalizeStringArray(value: unknown, field: string) {
	if (value === undefined || value === null) {
		return [];
	}
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
		throw new Error(`Invalid agent cli.${field}: expected an array of strings.`);
	}
	return value.map(String);
}

export function normalizeAgentCliOptions(input: unknown): AgentCliOptions {
	if (input === undefined || input === null) {
		return {
			allowTools: [],
			additionalArgs: [],
		};
	}
	if (typeof input !== 'object' || Array.isArray(input)) {
		throw new Error('Invalid agent cli config: expected an object.');
	}

	const cli = input as Record<string, unknown>;
	const rawAllowTools = normalizeStringArray(cli.allowTools, 'allowTools');
	const invalidTools = rawAllowTools.filter((tool) => !ALLOWED_TOOL_SET.has(tool));
	if (invalidTools.length) {
		throw new Error(
			`Invalid agent cli.allowTools entries: ${invalidTools.join(', ')}. Allowed tools: ${AGENT_CLI_ALLOW_TOOLS.join(', ')}.`,
		);
	}

	return {
		model: typeof cli.model === 'string' ? cli.model : undefined,
		allowTools: [...new Set(rawAllowTools)] as AgentCliAllowTool[],
		additionalArgs: normalizeStringArray(cli.additionalArgs, 'additionalArgs'),
	};
}

export function buildCopilotAllowToolArgs(allowTools: AgentCliOptions['allowTools'] = []) {
	return (allowTools ?? []).flatMap((tool) => ['--allow-tool', tool]);
}
