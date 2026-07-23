import { resolve } from 'node:path';
import { planTreeseedReconciliation } from "../../reconcile/index.ts";
import { applyTreeseedConfigValues, applyTreeseedSafeRepairs, checkTreeseedProviderConnections, collectTreeseedConfigContext, collectTreeseedPrintEnvReport, ensureTreeseedSecretSessionForConfig, ensureTreeseedActVerificationTooling, ensureTreeseedGitignoreEntries, inspectTreeseedPassphraseEnvDiagnostic, finalizeTreeseedConfig, getTreeseedMachineConfigPaths, inspectTreeseedKeyAgentStatus, rotateTreeseedMachineKey } from "../../operations/services/config-runtime.ts";
import { formatTreeseedDependencyFailureDetails, installTreeseedDependencies } from "../../managed-dependencies.ts";
import { exportTreeseedCodebase } from "../../operations/services/export-runtime.ts";
import { buildProvisioningSummary, createPersistentDeployTarget, loadDeployState } from "../../operations/services/deploy.ts";
import { collectCliPreflight } from "../../operations/services/workspace-preflight.ts";
import { resolveTreeseedWorkflowState } from "../../workflow-state.ts";
import { createTreeseedReconcileRegistry, deriveTreeseedDesiredUnits, filterTreeseedDesiredUnitsByBootstrapSystems, resolveTreeseedBootstrapSelection } from "../../reconcile/index.ts";
import type { TreeseedConfigInput, TreeseedExportInput } from "../../workflow.ts";
import { WorkflowOperationHelpers } from './workflow-write.ts';
import { normalizeConfigScopes, resolveProjectRootOrThrow, withContextEnv, workflowError } from './run-release-production-guarantees.ts';
import { connectTreeseedMarketProject, maybePrint, toError } from './connect-treeseed-market-project.ts';
import { buildWorkflowResult } from './create-repo-report.ts';
import { createNextSteps } from './release-admin-message.ts';
import { worktreePayload } from './normalize-release-candidate-mode.ts';

export async function workflowConfig(helpers: WorkflowOperationHelpers, input: TreeseedConfigInput = {}) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const tenantRoot = resolveProjectRootOrThrow('config', helpers.cwd());
			const scopes = normalizeConfigScopes(input);
			const sync = input.syncProviders ?? input.sync ?? 'all';
			const printEnv = input.printEnv === true;
			const revealSecrets = input.showSecrets === true;
			const printEnvOnly = input.printEnvOnly === true;
			const rotateMachineKeyFlag = input.rotateMachineKey === true;
			const connectMarketFlag = input.connectMarket === true;
			const bootstrapOnly = input.bootstrap === true;
			const bootstrapPreflight = bootstrapOnly && input.preflight === true;
			const nonInteractive = input.nonInteractive === true;
			const bootstrapSystemsInput = input.systems;
			const skipUnavailable = input.skipUnavailable;
			const bootstrapExecution = input.bootstrapExecution ?? 'parallel';
			const dependencyInstall = await installTreeseedDependencies({
				tenantRoot, 				force: input.installMissingTooling === true, 				env: helpers.context.env, 				write: (line: string) => maybePrint(helpers.write, line),
			});
			if (!dependencyInstall.ok) {
				workflowError(
					'config', 					'validation_failed',
					`Treeseed dependency initialization failed:\n- ${formatTreeseedDependencyFailureDetails(dependencyInstall)}`,
					{ details: { dependencies: dependencyInstall } },
				);
			}
			const repairs = input.repair === false ? [] : (resolveTreeseedWorkflowState(tenantRoot).deployConfigPresent ? applyTreeseedSafeRepairs(tenantRoot) : []);
			const toolHealth = ensureTreeseedActVerificationTooling({
				tenantRoot, 				installIfMissing: input.installMissingTooling === true, 				env: helpers.context.env, 				write: (line: string) => maybePrint(helpers.write, line),
			});
			const passphraseEnv = inspectTreeseedPassphraseEnvDiagnostic(helpers.context.env ?? process.env);
			const secretSession = (printEnvOnly && !revealSecrets) || bootstrapPreflight
				? {
					status: inspectTreeseedKeyAgentStatus(tenantRoot), 					createdWrappedKey: false, 					migratedWrappedKey: false, 					unlockSource: 'existing-session' as const,
				}
				: await ensureTreeseedSecretSessionForConfig({
					tenantRoot, 					interactive: false, 					env: helpers.context.env, 					createIfMissing: true, 					allowMigration: true,
				});

			ensureTreeseedGitignoreEntries(tenantRoot);
			const preflight = collectCliPreflight({ cwd: tenantRoot, requireAuth: false });
			const contextSnapshot = collectTreeseedConfigContext({
				tenantRoot, 				scopes, 				env: helpers.context.env,
			});
			if (bootstrapPreflight && !secretSession.status.unlocked && !passphraseEnv.configured) {
				workflowError(
					'config', 					'validation_failed',
					`${passphraseEnv.envVar} is not visible to this Codex process. ${passphraseEnv.recommendedLaunch}`,
					{
						details: {
							passphraseEnv, 							secretSession: secretSession.status,
						},
					},
				);
			}

			if (printEnvOnly) {
				const reports = await Promise.all(scopes.map(async (scope) => ({
					scope,
					environment: collectTreeseedPrintEnvReport({
						tenantRoot, 						scope, 						env: helpers.context.env, 						revealSecrets,
					}),
					provider: await checkTreeseedProviderConnections({ tenantRoot, scope, env: helpers.context.env }),
				})));
				return buildWorkflowResult(
					'config', 					tenantRoot,
					{
						mode: 'print-env-only', 						scopes, 						sync, 						secretsRevealed: revealSecrets, 						reports, 						repairs, 						preflight, 						toolHealth, 						context: contextSnapshot, 						secretSession,
					},
					{
						nextSteps: createNextSteps([
						{ operation: 'config', reason: 'Initialize the selected environment after reviewing the generated values.', input: { environment: scopes } },
						]),
					},
				);
			}

			if (rotateMachineKeyFlag) {
				const result = rotateTreeseedMachineKey(tenantRoot);
				return buildWorkflowResult(
					'config', 					tenantRoot,
					{
						mode: 'rotate-machine-key', 						scopes, 						sync, 						keyPath: result.keyPath, 						repairs, 						preflight, 						toolHealth, 						context: contextSnapshot, 						secretSession,
					},
					{
						nextSteps: createNextSteps([
						{ operation: 'config', reason: 'Inspect the regenerated local environment after the machine key rotation.', input: { environment: ['local'], printEnvOnly: true } },
						]),
					},
				);
			}

			if (connectMarketFlag) {
				return connectTreeseedMarketProject(helpers, tenantRoot, input, {
					scopes, 					sync, 					repairs, 					preflight, 					toolHealth,
				});
			}

			if (bootstrapPreflight) {
				maybePrint(helpers.write, 'Preparing bootstrap preflight...');
				const { configPath, keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
				const plansByScope = await Promise.all(scopes
					.filter((scope) => scope !== 'local')
					.map(async (scope) => {
						maybePrint(helpers.write, `Deriving desired units for ${scope}...`);
						const target = createPersistentDeployTarget(scope);
						const derived = deriveTreeseedDesiredUnits({ tenantRoot, target });
						const selection = resolveTreeseedBootstrapSelection({
							deployConfig: derived.deployConfig,
							env: contextSnapshot.valuesByScope[scope] ?? helpers.context.env ?? process.env,
							systems: bootstrapSystemsInput, 							skipUnavailable,
						});
						const selectedUnits = filterTreeseedDesiredUnitsByBootstrapSystems(
							derived.units, 							selection.runnable.filter((system) => system !== 'github'),
						);
						const registry = createTreeseedReconcileRegistry(derived.deployConfig);
						const capabilityMatrix = selectedUnits.map((unit) => {
							const adapter = registry.get(unit.unitType, unit.provider);
							return {
								unitId: unit.unitId, 								unitType: unit.unitType, 								provider: unit.provider, 								logicalName: unit.logicalName,
								requiredPostconditions: adapter.requiredPostconditions?.({
									context: {
										tenantRoot, 										target, 										deployConfig: derived.deployConfig, 										launchEnv: helpers.context.env ?? process.env, 										session: new Map(), 										write: (line: string) => maybePrint(helpers.write, line),
									},
									unit, 									persistedState: null,
								}) ?? [],
								verificationSupported: typeof adapter.verify === 'function',
							};
						});
						const planned = await planTreeseedReconciliation({
							tenantRoot, 							target, 							env: helpers.context.env, 							systems: selection.runnable.filter((system) => system !== 'github'), 							write: (line: string) => maybePrint(helpers.write, line),
						});
						return {
							scope, 							bootstrapSystems: selection, 							resourceInventory: buildProvisioningSummary(derived.deployConfig, loadDeployState(tenantRoot, derived.deployConfig, { target }), target),
							capabilityMatrix: await Promise.all(capabilityMatrix.map(async (entry) => ({
								...entry, 								requiredPostconditions: await Promise.resolve(entry.requiredPostconditions),
							}))),
							plans: planned.plans.map((plan) => ({
								unitId: plan.unit.unitId, 								unitType: plan.unit.unitType, 								provider: plan.unit.provider, 								action: plan.diff.action, 								reasons: plan.diff.reasons,
							})),
						};
					}));
				return buildWorkflowResult(
					'config', 					tenantRoot,
					{
						mode: 'bootstrap-preflight', 						scopes, 						sync, 						configPath, 						keyPath, 						repairs, 						preflight, 						toolHealth, 						passphraseEnv, 						secretSession, 						context: contextSnapshot,
						resourceInventoryByScope: Object.fromEntries(plansByScope.map((entry) => [entry.scope, entry.resourceInventory])),
						verificationPreflight: plansByScope,
						bootstrapSystemsByScope: Object.fromEntries(plansByScope.map((entry) => [entry.scope, entry.bootstrapSystems])),
					},
					{
						nextSteps: createNextSteps([
							{ operation: 'config', reason: 'Run bootstrap once the verification preflight is clean.', input: { environment: scopes, bootstrap: true } },
						]),
					},
				);
			}

			const explicitUpdates = Array.isArray((input as Record<string, unknown>).updates)
				? (input as Record<string, { scope: string; entryId: string; value: string; reused?: boolean }[]>).updates
					.map((update) => ({
						scope: update.scope as (typeof scopes)[number],
						entryId: String(update.entryId ?? ''), 						value: typeof update.value === 'string' ? update.value : '', 						reused: update.reused === true,
					}))
				: null;
			if (!bootstrapOnly && !explicitUpdates && !nonInteractive) {
				workflowError(
					'config', 					'validation_failed', 					'Treeseed config requires interactive input or explicit updates. Re-run in a TTY, or use --non-interactive/--json from the CLI when you want resolved values applied automatically.',
				);
			}
			const autoUpdates = scopes.flatMap((scope) =>
				contextSnapshot.entriesByScope[scope].map((entry) => ({
					scope, 					entryId: entry.id, 					value: entry.effectiveValue, 					reused: entry.currentValue.length > 0 || entry.suggestedValue.length > 0,
				})),
			);
			const applyResult = bootstrapOnly
				? { updated: [], sharedStorageMigrations: [] }
				: (() => {
					maybePrint(helpers.write, 'Saving resolved configuration values to machine config...');
					return applyTreeseedConfigValues({
						tenantRoot, 						updates: explicitUpdates ?? autoUpdates,
					});
				})();
			if (bootstrapOnly) {
				maybePrint(helpers.write, 'Bootstrapping platform reconciliation from existing configuration...');
			}
			const finalizeResult = await finalizeTreeseedConfig({
				tenantRoot, 				scopes, 				sync, 				env: helpers.context.env, 				checkConnections: bootstrapOnly || sync !== 'none' || scopes.some((scope) => scope !== 'local'), 				initializePersistent: bootstrapOnly, 				systems: bootstrapSystemsInput, 				skipUnavailable, 				bootstrapExecution, 				onProgress: (line, stream) => maybePrint(helpers.write, line, stream),
			});
			const refreshedContext = collectTreeseedConfigContext({
				tenantRoot, 				scopes, 				env: helpers.context.env,
			});
			const reports = printEnv
				? await Promise.all(scopes.map(async (scope) => ({
					scope,
					environment: collectTreeseedPrintEnvReport({
						tenantRoot, 						scope, 						env: helpers.context.env, 						revealSecrets,
					}),
					provider: finalizeResult.connectionChecks.find((report) => report.scope === scope) ?? await checkTreeseedProviderConnections({ tenantRoot, scope, env: helpers.context.env }),
				})))
				: [];
			const { configPath, keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
			const state = resolveTreeseedWorkflowState(tenantRoot);
			return buildWorkflowResult(
				'config', 				tenantRoot,
				{
					mode: bootstrapOnly ? 'bootstrap' : 'configure', 					scopes, 					sync, 					configPath, 					keyPath, 					repairs, 					preflight, 					toolHealth, 					passphraseEnv, 					secretSession, 					context: refreshedContext,
					result: {
						...applyResult, 						...finalizeResult,
					},
					reports, 					state, 					readiness: state.readiness,
				},
				createNextSteps([
					...(scopes.includes('local') ? [{ operation: 'dev', reason: 'Start the local Treeseed runtime on the initialized local environment.' }] : []),
					...(scopes.includes('staging') ? [{ operation: 'status', reason: 'Confirm staging readiness after initializing shared services.' }] : []),
					{ operation: 'switch', reason: 'Create or resume a task branch once the runtime foundation is ready.', input: { branch: 'feature/my-change', preview: true } },
				]),
			);
		});
	} catch (error) {
		toError('config', error);
	}
}

export async function workflowExport(helpers: WorkflowOperationHelpers, input: TreeseedExportInput = {}) {
	return await withContextEnv(helpers.context.env, async () => {
		const directory = resolve(helpers.context.cwd ?? helpers.cwd(), input.directory ?? '.');
		const exported = await exportTreeseedCodebase({ directory });
		return buildWorkflowResult('export', exported.tenantRoot, {
			...exported, 			...worktreePayload(exported.tenantRoot, input.worktreeMode),
		});
	});
}
