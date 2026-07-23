import { PRODUCTION_BRANCH, STAGING_BRANCH } from "../../operations/services/git-workflow.ts";
import { cleanProofLedger } from "../../operations/services/release-proof-ledger.ts";
import type { TreeseedProofDriver } from "../../operations/services/release-proof.ts";
import { buildTreeseedProofPlan, summarizeTreeseedProofLedger } from "../../operations/services/release-proof-planner.ts";
import { runTreeseedProof } from "../../operations/services/release-proof-runner.ts";
import { createTreeseedWorkflowTimer } from "../../operations/services/workflow-timing.ts";
import { incrementVersion, planWorkspaceReleaseBump } from "../../operations/services/workspace-save.ts";
import { discoverTreeseedPackageAdapters } from "../../operations/services/package-adapters.ts";
import { collectInternalDevReferenceIssues } from "../../operations/services/package-reference-policy.ts";
import { workspaceRoot } from "../../operations/services/workspace-tools.ts";
import { type TreeseedWorkflowMode } from ".././session.ts";
import type { TreeseedReleaseCandidateInput, TreeseedReleaseCandidateMode, TreeseedProofInput } from "../../workflow.ts";
import { WorkflowOperationHelpers } from './workflow-write.ts';
import { WorkflowRepoReport, resolveProjectRootOrThrow, withContextEnv, workflowError } from './run-release-production-guarantees.ts';
import { orderReleasePackageNames, parseProofOlderThan, releaseCandidateProofDriver, stableDependencyVersionsForReleaseLine } from './back-merge-production-into-staging.ts';
import { buildWorkflowResult, normalizeExecutionMode, selectWorkflowApplications } from './create-repo-report.ts';
import { createNextSteps } from './release-admin-message.ts';
import { toError } from './connect-treeseed-market-project.ts';
import { planRootPackageVersion, releaseTagExists } from './plan-root-package-version.ts';
import { releaseWorkflowForPackage } from './fail-workflow-run.ts';

export async function workflowProof(helpers: WorkflowOperationHelpers, input: TreeseedProofInput = {}) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const timer = createTreeseedWorkflowTimer();
			const tenantRoot = resolveProjectRootOrThrow('proof', helpers.cwd());
			const root = workspaceRoot(tenantRoot);
			const action = input.action ?? (input.plan ? 'plan' : 'status');
			const target = input.target ?? 'staging';
			const driver = input.driver ?? 'github-hosted';
			const executionMode = action === 'plan' || input.plan ? 'plan' : 'execute';
			let payload: Record<string, unknown>;
			if (action === 'run') {
				const result = await timer.phaseAsync('proof-run', 'Run release proof subjects', () => runTreeseedProof({
					root, 					target, 					driver, 					subject: input.subject ?? null, 					write: (line, stream) => helpers.write(line, stream),
				}));
				payload = {
					action, 					target, 					driver, 					subject: input.subject ?? null, 					...result, 					authority: driver === 'github-hosted' ? 'authoritative' : 'advisory',
				};
				if (result.failures.length > 0) {
					const first = result.failures[0]!;
					workflowError('proof', 'validation_failed', [
						'Treeseed release proof failed.',
						`- ${first.subject.id}: ${first.invalidationReasons[0] ?? first.status}`,
						first.result.workflow?.url ? `Run: ${first.result.workflow.url}` : null,
						'Hosted GitHub workflow proof is authoritative; local action simulation is advisory.',
					].filter(Boolean).join('\n'), { details: { proof: payload } });
				}
			} else if (action === 'clean') {
				payload = {
					action, 					target, 					...timer.phase('proof-clean', 'Clean old proof records', () => cleanProofLedger(root, {
						olderThanMs: parseProofOlderThan(input.olderThan),
					})),
				};
			} else if (action === 'failures') {
				const ledger = timer.phase('proof-failures', 'Inspect failed proof records', () => summarizeTreeseedProofLedger(root));
				payload = { action, target, failures: ledger.failures, summary: ledger.summary };
			} else if (action === 'explain') {
				const ledger = timer.phase('proof-explain', 'Explain proof duration and reuse', () => summarizeTreeseedProofLedger(root));
				payload = {
					action, 					target, 					latest: ledger.latest, 					slowest: ledger.slowest,
					reuse: {
						passed: ledger.summary.reusable, 						rerun: Math.max(0, ledger.summary.records - ledger.summary.reusable), 						blocked: ledger.summary.failed,
					},
					summary: ledger.summary,
				};
			} else {
				const plan = timer.phase('proof-plan', 'Plan release proof subjects', () => buildTreeseedProofPlan({
					root, 					target, 					driver, 					subject: input.subject ?? null,
				}));
				payload = { action, target, driver, plan, authority: driver === 'github-hosted' ? 'authoritative' : 'advisory' };
			}
			const timing = timer.finish();
			return buildWorkflowResult('proof', root, payload, {
				executionMode, 				summary: action === 'run' ? 'Treeseed release proof run completed.' : 'Treeseed release proof report ready.', 				timing,
				nextSteps: createNextSteps([
					{ operation: 'proof', reason: 'Run missing authoritative hosted proof before promotion.', input: { action: 'run', target, driver: 'github-hosted' } },
				]),
			});
		});
	} catch (error) {
		toError('proof', error);
	}
}

export function normalizeReleaseCandidatePackages(value: TreeseedReleaseCandidateInput['package']) {
	if (Array.isArray(value)) return value.map(String).filter(Boolean);
	if (typeof value === 'string' && value.trim()) return [value.trim()];
	return [];
}

export async function workflowReleaseCandidate(helpers: WorkflowOperationHelpers, input: TreeseedReleaseCandidateInput = {}) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const timer = createTreeseedWorkflowTimer();
			const tenantRoot = resolveProjectRootOrThrow('release-candidate', helpers.cwd());
			const root = workspaceRoot(tenantRoot);
			const executionMode = normalizeExecutionMode(input);
			const selectedPackageNames = normalizeReleaseCandidatePackages(input.package);
			const mode = (input.mode ?? 'strict') as TreeseedReleaseCandidateMode;
			const driver: TreeseedProofDriver = input.verifyDriver === 'local'
				? 'local'
				: input.verifyDriver === 'action'
					? 'act'
					: releaseCandidateProofDriver(mode === 'skip' ? 'hybrid' : mode);
			const proofSubject = selectedPackageNames.length === 1 ? `package:${selectedPackageNames[0]}` : null;
			const plan = timer.phase('proof-plan', 'Plan release-candidate proof subjects', () => buildTreeseedProofPlan({
				root, 				target: 'staging', 				driver, 				subject: proofSubject,
			}));
			const payload = {
				mode, 				driver, 				verifyDriver: input.verifyDriver ?? 'auto', 				selectedPackageNames, 				keepWorkspace: input.keepWorkspace === true, 				plan,
				plannedSteps: [
					{ id: 'proof-plan', description: 'Discover reusable exact-input proof records for package subjects.' },
					{ id: 'proof-run', description: 'Run only missing or invalid release proof nodes.' },
				],
			};
			if (executionMode === 'plan') {
				return buildWorkflowResult('release-candidate', root, payload, {
					executionMode, 					summary: 'Treeseed release-candidate proof plan ready.',
					nextSteps: createNextSteps([
						{ operation: 'release-candidate', reason: 'Run missing proof nodes before promotion.' },
					]),
				});
			}
			if (mode === 'skip') {
				return buildWorkflowResult('release-candidate', root, {
					...payload, 					status: 'skipped',
					failures: [],
				}, {
					summary: 'Treeseed release-candidate proof skipped.', 					timing: timer.finish(),
				});
			}
			const proof = await timer.phaseAsync('proof-run', 'Run release-candidate proof nodes', () => runTreeseedProof({
				root, 				target: 'staging', 				driver, 				subject: proofSubject, 				write: (line, stream) => helpers.write(line, stream),
			}));
			const resultPayload = {
				...payload, 				proof, 				failures: proof.failures,
			};
			if (proof.failures.length > 0) {
				const first = proof.failures[0]!;
				workflowError('release-candidate', 'validation_failed', [
					'Treeseed release-candidate proof failed.',
					`- ${first.subject.id}: ${first.invalidationReasons[0] ?? first.status}`,
					first.result.workflow?.url ? `Run: ${first.result.workflow.url}` : null,
				].filter(Boolean).join('\n'), {
					details: { releaseCandidate: resultPayload },
				});
			}
			return buildWorkflowResult('release-candidate', root, resultPayload, {
				summary: 'Treeseed release-candidate proof passed.', 				timing: timer.finish(),
				nextSteps: createNextSteps([
					{ operation: 'stage', reason: 'Run stage after the matching release proof passes.' },
				]),
			});
		});
	} catch (error) {
		toError('release-candidate', error);
	}
}

export function buildReleasePlanSnapshot(input: {
	root: string;
	mode: TreeseedWorkflowMode;
	level: string;
	repairVersionLine?: boolean;
	targetVersionLine?: string;
	packageSelection: { changed: string[]; dependents: string[]; selected: string[] };
	packageReports: WorkflowRepoReport[];
	rootRepo: WorkflowRepoReport;
	blockers: string[];
}) {
	const publishablePackageNames = new Set(
		discoverTreeseedPackageAdapters(input.root)
			.filter((adapter) => adapter.capabilities.publish)
			.map((adapter) => adapter.id),
	);
	const selectedPackageNames = new Set(
		input.packageSelection.selected.filter((name) => publishablePackageNames.has(name)),
	);
	const publishablePackageSelection = {
		changed: input.packageSelection.changed.filter((name) => selectedPackageNames.has(name)),
		dependents: input.packageSelection.dependents.filter((name) => selectedPackageNames.has(name)),
		selected: [...selectedPackageNames],
	};
	const applicationSelection = selectWorkflowApplications(input.root, { packageSelection: input.packageSelection });
	const versionPlan = planWorkspaceReleaseBump(input.level, input.root, input.mode === 'recursive-workspace'
		? { selectedPackageNames, repairVersionLine: input.repairVersionLine === true, targetVersionLine: input.targetVersionLine }
		: {});
	if (input.repairVersionLine !== true) {
		for (const adapter of discoverTreeseedPackageAdapters(input.root)) {
			if (!selectedPackageNames.has(adapter.id) || versionPlan.versions.has(adapter.id) || !adapter.version) continue;
			versionPlan.selected.add(adapter.id);
			versionPlan.versions.set(adapter.id, incrementVersion(adapter.version, input.level));
		}
	}
	for (const adapter of discoverTreeseedPackageAdapters(input.root)) {
		let version = versionPlan.versions.get(adapter.id);
		if (!version) continue;
		while (releaseTagExists(adapter.dir, version)) {
			version = incrementVersion(version, input.level);
		}
		versionPlan.versions.set(adapter.id, version);
	}
	const plannedSelected = orderReleasePackageNames([...versionPlan.selected].filter((name) => versionPlan.versions.has(name)));
	const plannedChanged = input.repairVersionLine === true
		? plannedSelected
		: Array.from(new Set(publishablePackageSelection.changed.filter((name) => plannedSelected.includes(name))));
	const plannedDependents = plannedSelected.filter((name) => !plannedChanged.includes(name));
	const plannedPackageSelection = {
		changed: plannedChanged,
		dependents: plannedDependents,
		selected: plannedSelected,
	};
	const rootVersion = planRootPackageVersion(input.root, input.level);
	const stableDependencyVersions = stableDependencyVersionsForReleaseLine(input.root, {
		targetLine: versionPlan.releaseLine?.targetLine,
		group: versionPlan.releaseLine?.group,
		selected: new Set(plannedPackageSelection.selected),
	});
	const plannedVersions = {
		'@treeseed/market': rootVersion,
		...Object.fromEntries(versionPlan.versions.entries()),
	};
	const plannedDevReferenceRewrites = input.mode === 'recursive-workspace'
		? collectInternalDevReferenceIssues(input.root, new Set([
			...plannedPackageSelection.selected, 			...Object.keys(stableDependencyVersions),
		]))
		: [];
	return {
		mode: input.mode,
		mergeStrategy: 'merge-commit',
		level: input.level,
		releaseLine: versionPlan.releaseLine,
		rootVersion,
		releaseTag: rootVersion,
		stagingBranch: STAGING_BRANCH,
		productionBranch: PRODUCTION_BRANCH,
		packageSelection: plannedPackageSelection,
		plannedVersions,
		stableDependencyVersions,
		applicationSelection,
		plannedDevReferenceRewrites,
		releaseOrder: plannedPackageSelection.selected,
		plannedPublishWaits: plannedPackageSelection.selected.map((name) => ({
			name, 			workflow: releaseWorkflowForPackage(input.root, name),
			branch: String(plannedVersions[name] ?? PRODUCTION_BRANCH),
			status: 'planned',
		})),
		touchedPackages: plannedPackageSelection.selected,
		repos: input.packageReports,
		rootRepo: input.rootRepo,
		finalBranch: STAGING_BRANCH,
		plannedSteps: [
			{ id: 'release-plan', description: 'Record immutable release plan and target versions' },
			{ id: 'release-candidate', description: 'Run exact staging release-candidate readiness checks' },
			{ id: 'workspace-unlink', description: 'Remove local workspace links before stable release install' },
			{ id: 'prepare-release-metadata', description: 'Rewrite package metadata and lockfiles to production dependency mode' },
			...input.packageReports.filter((report) => plannedPackageSelection.selected.includes(report.name)).map((report) => ({
				id: `release-${report.name}`,
				description: `Release ${report.name} from staging to main and tag ${plannedVersions[report.name] ?? '(planned)'}`,
			})),
			{ id: 'release-root', description: `Release market ${rootVersion}` },
			{ id: 'release-back-merge', description: 'Back-merge production release history into staging' },
			{ id: 'workspace-link', description: 'Restore local workspace links after release syncs back to staging' },
		],
		blockers: input.blockers,
	};
}
