import type { AgentActivityProfile,AgentActivityType } from '../../../types/agents.ts';
import { compileAgentAuthoritySnapshot } from '../../authority/agent-authority-presets.ts';
import type { AgentActivityProfileDiagnostic } from '../activity-profile.ts';

const CONTENT_MUTATIONS = new Set(['create','update','link','commit']);
const REQUIRED_SOURCE_TOOLS = [
	'treeseed.repository.read_file',
	'treeseed.repository.search',
	'treeseed.changed_paths',
	'treeseed.verify',
	'treeseed.checkpoint',
] as const;

function writableModels(profile: AgentActivityProfile) {
	return Object.entries(profile.permissions?.content ?? {})
		.filter(([,policy]) => policy.operations.some((operation) => CONTENT_MUTATIONS.has(operation)))
		.map(([model]) => model);
}

function normalizePathPattern(value: string) {
	return value.replace(/\\/gu, '/').replace(/^\.?\//u, '').replace(/\/+/gu, '/');
}

function patternCovers(coveringPattern: string, candidatePattern: string) {
	const covering = normalizePathPattern(coveringPattern);
	const candidate = normalizePathPattern(candidatePattern);
	if (covering === '**' || covering === '*') return true;
	if (covering.endsWith('/**')) {
		const prefix = covering.slice(0, -3);
		const candidatePrefix = candidate.endsWith('/**') ? candidate.slice(0, -3) : candidate;
		return candidatePrefix === prefix || candidatePrefix.startsWith(`${prefix}/`);
	}
	if (covering.endsWith('/')) return candidate.startsWith(covering);
	return candidate === covering || candidate.startsWith(`${covering}/`);
}

export interface AgentDefinitionCompatibilityOptions {
	availableProviderCapabilities?: Iterable<string>;
}

export function validateAgentActivityProfileCompatibility(
	activityType: AgentActivityType,
	profile: AgentActivityProfile,
	options: AgentDefinitionCompatibilityOptions = {},
) {
	const diagnostics: AgentActivityProfileDiagnostic[] = [];
	const path = `activityProfiles.${activityType}`;
	const add = (code: string, suffix: string, message: string) => diagnostics.push({ code, path: `${path}${suffix}`, message });
	const authority = compileAgentAuthoritySnapshot(activityType,profile);
	const tools = new Set(authority.tools.allowed);
	const writable = writableModels(profile);
	const hasContentMutationTool = [...tools].some((tool) => /^treeseed\.content\.(?:create|update|link|commit)$/u.test(tool));

	if (hasContentMutationTool && writable.length === 0) add(
		'agent_activity_content_authority_unsatisfied', '.permissions.content',
		'Content mutation tools require explicit writable model permissions.',
	);
	if (tools.has('treeseed.content.commit') && profile.permissions?.commit?.allowed !== true) add(
		'agent_activity_content_commit_unsatisfied', '.permissions.commit.allowed',
		'treeseed.content.commit requires explicit governed commit authority.',
	);
	if (profile.branchPolicy.kind === 'read-only' && writable.length > 0) add(
		'agent_activity_read_only_write_conflict', '.branchPolicy.kind',
		`read-only cannot carry writable content authority for ${writable.join(', ')}.`,
	);
	if (profile.planningIntent?.artifactKind?.includes('note') && !profile.permissions?.content?.note?.operations.includes('create')) add(
		'agent_activity_required_artifact_unsatisfied', '.planningIntent.artifactKind',
		'Planning that requires a note artifact must authorize note creation.',
	);

	if (profile.branchPolicy.kind === 'assignment-feature') {
		for (const tool of REQUIRED_SOURCE_TOOLS) if (!tools.has(tool)) add(
			'agent_activity_source_tool_unsatisfied', '.tools.allowed',
			`assignment-feature requires ${tool}.`,
		);
		if (profile.execution?.verificationRequired !== true) add(
			'agent_activity_source_verification_required', '.execution.verificationRequired',
			'assignment-feature requires verification before checkpointing.',
		);
		if (!profile.execution?.allowedPaths?.length) add(
			'agent_activity_source_paths_required', '.execution.allowedPaths',
			'assignment-feature requires explicit allowed paths.',
		);
		if (!profile.execution?.forbiddenPaths?.length) add(
			'agent_activity_source_paths_required', '.execution.forbiddenPaths',
			'assignment-feature requires explicit forbidden paths.',
		);
		const allowedPaths = profile.execution?.allowedPaths ?? [];
		const forbiddenPaths = profile.execution?.forbiddenPaths ?? [];
		if (allowedPaths.length > 0 && allowedPaths.every((allowed) => forbiddenPaths.some((forbidden) => patternCovers(forbidden,allowed)))) add(
			'agent_activity_source_paths_unsatisfiable', '.execution.allowedPaths',
			'Every allowed source path is covered by a forbidden path.',
		);
	}

	if (options.availableProviderCapabilities) {
		const available = new Set(options.availableProviderCapabilities);
		for (const [suffix,required] of [
			['.execution.requiredCapabilities',profile.execution?.requiredCapabilities ?? []],
			['.providerOverrides.requiredCapabilities',profile.providerOverrides?.requiredCapabilities ?? []],
		] as const) for (const capability of required) if (!available.has(capability)) add(
			'agent_activity_provider_capability_unsatisfied', suffix,
			`Provider does not advertise required capability ${capability}.`,
		);
	}

	return { ok: diagnostics.length === 0, diagnostics, authority };
}
