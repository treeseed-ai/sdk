import { parse as parseYaml } from 'yaml';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { sceneErrorDiagnostic } from './diagnostics.ts';
import type {
	TreeseedSceneDiagnostic,
	TreeseedSceneEvidenceArtifactKind,
	TreeseedSceneRedactionPolicy,
	TreeseedSceneRedactionRule,
	TreeseedScenePublishTarget,
	TreeseedSceneRunStatus,
} from './types.ts';

const EVIDENCE_ARTIFACT_KINDS = new Set<TreeseedSceneEvidenceArtifactKind>([
	'run-report',
	'markdown-report',
	'timeline',
	'setup',
	'progress',
	'segment',
	'checkpoint',
	'screenshot',
	'render-report',
	'render-video',
	'training-output',
	'log-summary',
]);

const RUN_STATUSES = new Set<TreeseedSceneRunStatus>(['passed', 'failed', 'blocked', 'skipped']);
const PUBLISH_TARGETS = new Set<TreeseedScenePublishTarget>(['local', 'release']);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | null {
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) return null;
	return value as string[];
}

function ruleApplies(input: {
	rule: TreeseedSceneRedactionRule;
	target: TreeseedScenePublishTarget;
	workflowStatus: TreeseedSceneRunStatus;
}) {
	const target = input.rule.allowWhen?.target;
	if (target && !target.includes(input.target)) return false;
	const workflowStatus = input.rule.allowWhen?.workflowStatus;
	if (workflowStatus && !workflowStatus.includes(input.workflowStatus)) return false;
	return true;
}

export function createDefaultTreeseedSceneRedactionPolicy(target: TreeseedScenePublishTarget): TreeseedSceneRedactionPolicy {
	void target;
	const include = (artifactKind: TreeseedSceneEvidenceArtifactKind, reason: string): TreeseedSceneRedactionRule => ({
		id: `include-${artifactKind}`,
		artifactKind,
		include: true,
		reason,
	});
	return {
		schemaVersion: 'treeseed.scene.redaction-policy/v1',
		id: 'treeseed.scene.redaction.default',
		mode: 'deny-by-default',
		rules: [
			include('run-report', 'Run report metadata is safe for local evidence publication.'),
			include('markdown-report', 'Markdown summary is safe for local evidence publication.'),
			include('timeline', 'Timeline metadata is safe for local evidence publication.'),
			include('setup', 'Setup summary is safe for local evidence publication.'),
			include('progress', 'Progress events are safe for local evidence publication.'),
			include('segment', 'Segment metadata is safe for local evidence publication.'),
			include('checkpoint', 'Checkpoint metadata is safe for local evidence publication.'),
			include('screenshot', 'Only screenshots already selected by sanitized evidence are safe for publication.'),
			include('render-report', 'Render report metadata is safe for local evidence publication.'),
			include('training-output', 'Deterministic training sidecars are safe for local evidence publication.'),
		],
	};
}

export function validateTreeseedSceneRedactionPolicy(input: {
	policy: unknown;
	path?: string;
}): TreeseedSceneDiagnostic[] {
	const diagnostics: TreeseedSceneDiagnostic[] = [];
	const policy = input.policy;
	if (!isRecord(policy)) {
		return [sceneErrorDiagnostic('scene.publish_redaction_policy_invalid', 'Redaction policy must be an object.', input.path)];
	}
	if (policy.schemaVersion !== 'treeseed.scene.redaction-policy/v1') {
		diagnostics.push(sceneErrorDiagnostic('scene.publish_redaction_policy_invalid', 'Redaction policy schemaVersion must be "treeseed.scene.redaction-policy/v1".', input.path ? `${input.path}.schemaVersion` : 'schemaVersion'));
	}
	if (typeof policy.id !== 'string' || policy.id.trim().length === 0) {
		diagnostics.push(sceneErrorDiagnostic('scene.publish_redaction_policy_invalid', 'Redaction policy id is required.', input.path ? `${input.path}.id` : 'id'));
	}
	if (policy.mode !== 'deny-by-default') {
		diagnostics.push(sceneErrorDiagnostic('scene.publish_redaction_policy_invalid', 'Redaction policy mode must be "deny-by-default".', input.path ? `${input.path}.mode` : 'mode'));
	}
	if (!Array.isArray(policy.rules)) {
		diagnostics.push(sceneErrorDiagnostic('scene.publish_redaction_policy_invalid', 'Redaction policy rules must be an array.', input.path ? `${input.path}.rules` : 'rules'));
		return diagnostics;
	}
	const seen = new Set<string>();
	for (const [index, rawRule] of policy.rules.entries()) {
		const path = input.path ? `${input.path}.rules[${index}]` : `rules[${index}]`;
		if (!isRecord(rawRule)) {
			diagnostics.push(sceneErrorDiagnostic('scene.publish_redaction_policy_invalid', 'Redaction policy rule must be an object.', path));
			continue;
		}
		const id = rawRule.id;
		if (typeof id !== 'string' || id.trim().length === 0) {
			diagnostics.push(sceneErrorDiagnostic('scene.publish_redaction_policy_invalid', 'Redaction policy rule id is required.', `${path}.id`));
		} else if (seen.has(id)) {
			diagnostics.push(sceneErrorDiagnostic('scene.publish_redaction_policy_invalid', `Duplicate redaction policy rule id "${id}".`, `${path}.id`));
		} else {
			seen.add(id);
		}
		if (typeof rawRule.artifactKind !== 'string' || !EVIDENCE_ARTIFACT_KINDS.has(rawRule.artifactKind as TreeseedSceneEvidenceArtifactKind)) {
			diagnostics.push(sceneErrorDiagnostic('scene.publish_redaction_policy_invalid', `Unsupported redaction artifact kind "${String(rawRule.artifactKind ?? '')}".`, `${path}.artifactKind`));
		}
		if (typeof rawRule.include !== 'boolean') {
			diagnostics.push(sceneErrorDiagnostic('scene.publish_redaction_policy_invalid', 'Redaction policy rule include must be boolean.', `${path}.include`));
		}
		if (typeof rawRule.reason !== 'string' || rawRule.reason.trim().length === 0) {
			diagnostics.push(sceneErrorDiagnostic('scene.publish_redaction_policy_invalid', 'Redaction policy rule reason is required.', `${path}.reason`));
		}
		if (rawRule.allowWhen !== undefined) {
			if (!isRecord(rawRule.allowWhen)) {
				diagnostics.push(sceneErrorDiagnostic('scene.publish_redaction_policy_invalid', 'Redaction policy allowWhen must be an object.', `${path}.allowWhen`));
			} else {
				const targets = rawRule.allowWhen.target;
				if (targets !== undefined) {
					const values = stringArray(targets);
					if (!values || values.some((value) => !PUBLISH_TARGETS.has(value as TreeseedScenePublishTarget))) {
						diagnostics.push(sceneErrorDiagnostic('scene.publish_redaction_policy_invalid', 'Redaction policy allowWhen.target contains unsupported publish targets.', `${path}.allowWhen.target`));
					}
				}
				const statuses = rawRule.allowWhen.workflowStatus;
				if (statuses !== undefined) {
					const values = stringArray(statuses);
					if (!values || values.some((value) => !RUN_STATUSES.has(value as TreeseedSceneRunStatus))) {
						diagnostics.push(sceneErrorDiagnostic('scene.publish_redaction_policy_invalid', 'Redaction policy allowWhen.workflowStatus contains unsupported run statuses.', `${path}.allowWhen.workflowStatus`));
					}
				}
			}
		}
	}
	return diagnostics;
}

export function readTreeseedSceneRedactionPolicyFile(path: string): {
	policy: TreeseedSceneRedactionPolicy | null;
	diagnostics: TreeseedSceneDiagnostic[];
} {
	try {
		const raw = readFileSync(path, 'utf8');
		const parsed = extname(path).toLowerCase() === '.json' ? JSON.parse(raw) : parseYaml(raw);
		const diagnostics = validateTreeseedSceneRedactionPolicy({ policy: parsed, path });
		return { policy: diagnostics.length > 0 ? null : parsed as TreeseedSceneRedactionPolicy, diagnostics };
	} catch (error) {
		return {
			policy: null,
			diagnostics: [sceneErrorDiagnostic('scene.publish_redaction_policy_invalid', `Redaction policy could not be read. ${error instanceof Error ? error.message : String(error ?? '')}`.trim(), path)],
		};
	}
}

export function resolveTreeseedSceneRedactionRule(input: {
	policy: TreeseedSceneRedactionPolicy;
	artifactKind: TreeseedSceneEvidenceArtifactKind;
	target: TreeseedScenePublishTarget;
	workflowStatus: TreeseedSceneRunStatus;
}): TreeseedSceneRedactionRule | null {
	return input.policy.rules.find((rule) => (
		rule.artifactKind === input.artifactKind
		&& ruleApplies({ rule, target: input.target, workflowStatus: input.workflowStatus })
	)) ?? null;
}
