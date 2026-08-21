import type { CompatibilityClassification } from '../contracts.ts';
import type { McpCompatibilityComparison, McpCompatibilityFinding, McpContractModel } from './contracts.ts';

const rank: Record<CompatibilityClassification, number> = { unchanged: 0, compatible_addition: 1, breaking: 2 };

function same(left: unknown, right: unknown) {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function compareMcp(baseline: McpContractModel, candidate: McpContractModel): McpCompatibilityComparison {
	const findings: McpCompatibilityFinding[] = [];
	const add = (code: string, path: string, message: string, classification: CompatibilityClassification) => findings.push({ code, path, message, classification });
	if (baseline.protocolVersion !== candidate.protocolVersion) add('mcp_protocol_changed', 'protocolVersion', 'The MCP protocol version changed.', 'breaking');

	for (const [name, tool] of Object.entries(baseline.tools)) {
		const next = candidate.tools[name];
		if (!next) { add('mcp_tool_removed', `tools.${name}`, 'An MCP tool was removed.', 'breaking'); continue; }
		if (!same(tool.inputSchema, next.inputSchema)) add('mcp_tool_input_changed', `tools.${name}.inputSchema`, 'Tool input changed.', 'breaking');
		if (!same(tool.outputSchema, next.outputSchema)) add('mcp_tool_output_changed', `tools.${name}.outputSchema`, 'Tool output changed.', 'breaking');
		if (next.requiredScopes.some((scope) => !tool.requiredScopes.includes(scope))) add('mcp_tool_scope_escalated', `tools.${name}.requiredScopes`, 'Tool scope requirements increased.', 'breaking');
		if (tool.riskClass !== next.riskClass) add('mcp_tool_risk_changed', `tools.${name}.riskClass`, 'Tool risk classification changed.', 'breaking');
	}
	for (const name of Object.keys(candidate.tools).filter((name) => !(name in baseline.tools))) add('mcp_tool_added', `tools.${name}`, 'An MCP tool was added.', 'compatible_addition');

	for (const [uri, resource] of Object.entries(baseline.resources)) {
		const next = candidate.resources[uri];
		if (!next) add('mcp_resource_removed', `resources.${uri}`, 'An MCP resource was removed.', 'breaking');
		else if (!same(resource, next)) add('mcp_resource_changed', `resources.${uri}`, 'An MCP resource contract changed.', 'breaking');
	}
	for (const uri of Object.keys(candidate.resources).filter((uri) => !(uri in baseline.resources))) add('mcp_resource_added', `resources.${uri}`, 'An MCP resource was added.', 'compatible_addition');

	for (const [name, prompt] of Object.entries(baseline.prompts)) {
		const next = candidate.prompts[name];
		if (!next) add('mcp_prompt_removed', `prompts.${name}`, 'An MCP prompt was removed.', 'breaking');
		else if (!same(prompt, next)) add('mcp_prompt_changed', `prompts.${name}`, 'An MCP prompt contract changed.', 'breaking');
	}
	for (const name of Object.keys(candidate.prompts).filter((name) => !(name in baseline.prompts))) add('mcp_prompt_added', `prompts.${name}`, 'An MCP prompt was added.', 'compatible_addition');

	findings.sort((left, right) => `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`));
	return { classification: findings.reduce<CompatibilityClassification>((value, finding) => rank[finding.classification] > rank[value] ? finding.classification : value, 'unchanged'), findings };
}
