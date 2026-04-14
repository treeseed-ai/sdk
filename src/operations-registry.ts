import type { TreeseedOperationMetadata } from './operations-types.ts';

function operation(spec: TreeseedOperationMetadata): TreeseedOperationMetadata {
	return spec;
}

export const TRESEED_OPERATION_SPECS: TreeseedOperationMetadata[] = [
	operation({ id: 'workspace.status', name: 'status', aliases: [], group: 'Workflow', summary: 'Show Treeseed project health and the current task state.', description: 'Report branch/task state, runtime readiness, preview/deploy state, auth readiness, and recommended next operations.', provider: 'default', related: ['tasks', 'switch', 'config'] }),
	operation({ id: 'branch.tasks', name: 'tasks', aliases: [], group: 'Workflow', summary: 'List task branches and preview metadata.', description: 'List task-based preview Git branches from local and origin, excluding protected and deprecated refs.', provider: 'default', related: ['status', 'switch', 'close'] }),
	operation({ id: 'branch.switch', name: 'switch', aliases: [], group: 'Workflow', summary: 'Create or resume a task branch.', description: 'Create a new task branch from staging or resume an existing local or remote task branch.', provider: 'default', related: ['tasks', 'dev', 'save'] }),
	operation({ id: 'branch.save', name: 'save', aliases: [], group: 'Workflow', summary: 'Verify, commit, sync, push, and refresh preview for the current task.', description: 'Run lint, test, and build verification, sync the current branch with origin, push it, and refresh the branch preview when enabled.', provider: 'default', related: ['switch', 'stage', 'status'] }),
	operation({ id: 'branch.close', name: 'close', aliases: [], group: 'Workflow', summary: 'Archive a task branch without merging it.', description: 'Destroy branch preview resources, create a deprecated resurrection tag, push the tag, and delete the local and remote branch.', provider: 'default', related: ['tasks', 'switch', 'stage'] }),
	operation({ id: 'branch.stage', name: 'stage', aliases: [], group: 'Workflow', summary: 'Merge the current task into staging and clean it up.', description: 'Verify the current task branch, merge it into staging, wait for staging automation, clean preview resources, create a deprecated resurrection tag, and delete the task branch.', provider: 'default', related: ['save', 'release', 'close'] }),
	operation({ id: 'deploy.rollback', name: 'rollback', aliases: [], group: 'Workflow', summary: 'Roll back staging or production to a recorded deployment.', description: 'Redeploy a previously recorded staging or production commit using a temporary checkout of that revision.', provider: 'default', related: ['status', 'release'] }),
	operation({ id: 'workspace.doctor', name: 'doctor', aliases: [], group: 'Validation', summary: 'Diagnose Treeseed tooling, auth, and workflow readiness.', description: 'Collect doctor-style diagnostics for workspace readiness and optional safe repairs.', provider: 'default', related: ['status', 'config'] }),
	operation({ id: 'auth.login', name: 'auth:login', aliases: [], group: 'Validation', summary: 'Authenticate against the configured Treeseed API.', description: 'Start the device login flow against the active Treeseed API host and persist the returned session locally.', provider: 'default', related: ['auth:check', 'auth:whoami', 'auth:logout'] }),
	operation({ id: 'auth.logout', name: 'auth:logout', aliases: [], group: 'Validation', summary: 'Clear locally stored Treeseed API credentials.', description: 'Remove the persisted local device-flow session for the active Treeseed API host.', provider: 'default', related: ['auth:login', 'auth:whoami'] }),
	operation({ id: 'auth.whoami', name: 'auth:whoami', aliases: [], group: 'Validation', summary: 'Inspect the active Treeseed API identity.', description: 'Use the persisted local remote session to query the active Treeseed API principal.', provider: 'default', related: ['auth:login', 'status'] }),
	operation({ id: 'template.list', name: 'template', aliases: [], group: 'Utilities', summary: 'List, inspect, and validate templates from the Treeseed catalog.', description: 'Use remote template metadata to list templates, show one template, or validate local template artifacts.', provider: 'default', related: ['init', 'sync'] }),
	operation({ id: 'template.sync', name: 'sync', aliases: [], group: 'Validation', summary: 'Validate or reconcile the managed template surface for the current site.', description: 'Use remote template metadata plus the local scaffold artifact to check or apply updates to the managed scaffold surface.', provider: 'default', related: ['template', 'init', 'status'] }),
	operation({ id: 'project.init', name: 'init', aliases: [], group: 'Workflow', summary: 'Scaffold a new Treeseed tenant project.', description: 'Create a new Treeseed tenant directory from a remote-catalog template backed by the packaged scaffold artifact.', provider: 'default', related: ['config', 'switch', 'dev'] }),
	operation({ id: 'project.config', name: 'config', aliases: [], group: 'Workflow', summary: 'Configure and test the runtime foundation.', description: 'Apply safe repairs, collect environment values, write local machine config, generate local env files, initialize environments, sync providers, and run doctor-style checks.', provider: 'default', related: ['status', 'switch', 'dev'] }),
	operation({ id: 'project.export', name: 'export', aliases: [], group: 'Utilities', summary: 'Export a Markdown snapshot of the current codebase.', description: 'Generate a Markdown codebase snapshot for the selected directory using the SDK-owned repomix integration and store it under .treeseed/exports.', provider: 'default', related: ['status', 'config'] }),
	operation({ id: 'deploy.release', name: 'release', aliases: [], group: 'Workflow', summary: 'Promote staging to production with a version bump.', description: 'Validate staging, apply one version bump, tag the release, merge staging into main, push, and rely on production deploy automation.', provider: 'default', related: ['stage', 'status', 'rollback'] }),
	operation({ id: 'deploy.destroy', name: 'destroy', aliases: [], group: 'Workflow', summary: 'Destroy a persistent environment and its local state.', description: 'Delete the selected persistent environment resources and remove the local deploy state after confirmation.', provider: 'default', related: ['config', 'status'] }),
	operation({ id: 'local.dev', name: 'dev', aliases: [], group: 'Local Development', summary: 'Start the unified local Treeseed development environment.', description: 'Start the unified local Treeseed development environment.', provider: 'default' }),
	operation({ id: 'local.devWatch', name: 'dev:watch', aliases: [], group: 'Local Development', summary: 'Start local development with rebuild and watch mode.', description: 'Start local development with rebuild and watch mode.', provider: 'default' }),
	operation({ id: 'local.build', name: 'build', aliases: [], group: 'Local Development', summary: 'Build the tenant site and generated worker artifacts.', description: 'Build the tenant site and generated worker artifacts.', provider: 'default' }),
	operation({ id: 'local.check', name: 'check', aliases: [], group: 'Local Development', summary: 'Run the tenant check flow.', description: 'Run the tenant check flow.', provider: 'default' }),
	operation({ id: 'local.preview', name: 'preview', aliases: [], group: 'Local Development', summary: 'Preview the built tenant site locally.', description: 'Preview the built tenant site locally.', provider: 'default' }),
	operation({ id: 'local.lint', name: 'lint', aliases: [], group: 'Validation', summary: 'Run Treeseed lint checks.', description: 'Run Treeseed lint checks.', provider: 'default' }),
	operation({ id: 'local.test', name: 'test', aliases: [], group: 'Validation', summary: 'Run Treeseed tests.', description: 'Run Treeseed tests.', provider: 'default' }),
	operation({ id: 'validation.testUnit', name: 'test:unit', aliases: [], group: 'Validation', summary: 'Run workspace unit tests in dependency order.', description: 'Run workspace unit tests in dependency order.', provider: 'default' }),
	operation({ id: 'validation.preflight', name: 'preflight', aliases: [], group: 'Validation', summary: 'Check local prerequisites and authentication state.', description: 'Check local prerequisites and authentication state.', provider: 'default' }),
	operation({ id: 'validation.authCheck', name: 'auth:check', aliases: [], group: 'Validation', summary: 'Check local prerequisites and require authenticated tooling.', description: 'Check local prerequisites and require authenticated tooling.', provider: 'default' }),
	operation({ id: 'release.testE2e', name: 'test:e2e', aliases: [], group: 'Release Utilities', summary: 'Run Treeseed end-to-end command tests.', description: 'Run Treeseed end-to-end command tests.', provider: 'default' }),
	operation({ id: 'release.testE2eLocal', name: 'test:e2e:local', aliases: [], group: 'Release Utilities', summary: 'Run local-mode Treeseed end-to-end command tests.', description: 'Run local-mode Treeseed end-to-end command tests.', provider: 'default' }),
	operation({ id: 'release.testE2eStaging', name: 'test:e2e:staging', aliases: [], group: 'Release Utilities', summary: 'Run staging-mode Treeseed end-to-end command tests.', description: 'Run staging-mode Treeseed end-to-end command tests.', provider: 'default' }),
	operation({ id: 'release.testE2eFull', name: 'test:e2e:full', aliases: [], group: 'Release Utilities', summary: 'Run the full Treeseed end-to-end command suite.', description: 'Run the full Treeseed end-to-end command suite.', provider: 'default' }),
	operation({ id: 'release.testFast', name: 'test:release', aliases: [], group: 'Release Utilities', summary: 'Run the fast release verification path.', description: 'Run the fast release verification path.', provider: 'default' }),
	operation({ id: 'release.verify', name: 'test:release:full', aliases: ['release:verify'], group: 'Release Utilities', summary: 'Run the full release verification path.', description: 'Run the full release verification path.', provider: 'default' }),
	operation({ id: 'release.publishChanged', name: 'release:publish:changed', aliases: [], group: 'Release Utilities', summary: 'Publish changed Treeseed workspace packages.', description: 'Publish changed Treeseed workspace packages.', provider: 'default' }),
	operation({ id: 'tools.astro', name: 'astro', aliases: [], group: 'Passthrough', summary: 'Pass through to the packaged Astro CLI wrapper.', description: 'Pass through to the packaged Astro CLI wrapper.', provider: 'default' }),
	operation({ id: 'tools.syncDevvars', name: 'sync:devvars', aliases: [], group: 'Utilities', summary: 'Regenerate .dev.vars from local configuration.', description: 'Regenerate .dev.vars from local configuration.', provider: 'default' }),
	operation({ id: 'services.mailpitUp', name: 'mailpit:up', aliases: [], group: 'Utilities', summary: 'Start the package-managed Mailpit service.', description: 'Start the package-managed Mailpit service.', provider: 'default' }),
	operation({ id: 'services.mailpitDown', name: 'mailpit:down', aliases: [], group: 'Utilities', summary: 'Stop the package-managed Mailpit service.', description: 'Stop the package-managed Mailpit service.', provider: 'default' }),
	operation({ id: 'services.mailpitLogs', name: 'mailpit:logs', aliases: [], group: 'Utilities', summary: 'Show Mailpit logs.', description: 'Show Mailpit logs.', provider: 'default' }),
	operation({ id: 'data.d1MigrateLocal', name: 'd1:migrate:local', aliases: [], group: 'Utilities', summary: 'Apply local D1 migrations.', description: 'Apply local D1 migrations.', provider: 'default' }),
	operation({ id: 'content.cleanupMarkdown', name: 'cleanup:markdown', aliases: [], group: 'Utilities', summary: 'Normalize Markdown and MDX files.', description: 'Normalize Markdown and MDX files.', provider: 'default' }),
	operation({ id: 'content.cleanupMarkdownCheck', name: 'cleanup:markdown:check', aliases: [], group: 'Utilities', summary: 'Check Markdown and MDX formatting without rewriting files.', description: 'Check Markdown and MDX formatting without rewriting files.', provider: 'default' }),
	operation({ id: 'tools.starlightPatch', name: 'starlight:patch', aliases: [], group: 'Utilities', summary: 'Apply the Starlight content path patch.', description: 'Apply the Starlight content path patch.', provider: 'default' }),
];

export const TRESEED_OPERATION_INDEX = new Map<string, TreeseedOperationMetadata>();
for (const spec of TRESEED_OPERATION_SPECS) {
	TRESEED_OPERATION_INDEX.set(spec.name, spec);
	for (const alias of spec.aliases) {
		TRESEED_OPERATION_INDEX.set(alias, spec);
	}
}

export function findTreeseedOperation(name: string | null | undefined) {
	if (!name) return null;
	return TRESEED_OPERATION_INDEX.get(name) ?? null;
}

export function listTreeseedOperationNames() {
	return [...new Set(TRESEED_OPERATION_SPECS.map((spec) => spec.name))];
}
