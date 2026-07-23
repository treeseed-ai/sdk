import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	deriveProjectHostBindingsView,
	executeProjectHostBindingOperation,
	planProjectHostBindingOperation,
} from '../../../src/operations/services/project-host-operations.ts';
import {
	normalizeTemplateLaunchRequirements,
	resolveProjectLaunchHostBindings,
} from '../../../src/template-launch-requirements.ts';

function launchRequirements() {
	return normalizeTemplateLaunchRequirements({
		hosts: [
			{
				kind: 'host',
				key: 'sourceRepository',
				type: 'repository',
				required: true,
				compatibleProviders: ['github'],
				displayName: 'Source repository',
				purpose: 'Creates project repositories.',
				defaultSelection: 'team-default',
				configWrites: [
					{ target: 'treeseed.site.yaml', path: 'hosting.hostBindings.sourceRepository.provider', valueFrom: 'selectedHost.provider' },
				],
			},
			{
				kind: 'host',
				key: 'publicWeb',
				type: 'web',
				required: true,
				compatibleProviders: ['cloudflare'],
				displayName: 'Public web',
				purpose: 'Deploys the public web surface.',
				defaultSelection: 'managed',
				configWrites: [
					{ target: 'treeseed.site.yaml', path: 'hosting.hostBindings.publicWeb.provider', valueFrom: 'selectedHost.provider' },
				],
				environmentWrites: [
					{ env: 'TREESEED_CLOUDFLARE_API_TOKEN', valueFrom: 'selectedHost.config:TREESEED_CLOUDFLARE_API_TOKEN', targets: ['github-secret'], scopes: ['staging', 'prod'], sensitivity: 'secret' },
				],
			},
		],
	});
}

function inventories() {
	return {
		repositoryHosts: [{
			id: 'repo-host-1',
			type: 'repository',
			provider: 'github',
			ownership: 'team_owned',
			name: 'GitHub host',
			status: 'active',
		}],
		teamHosts: [{
			id: 'web-host-1',
			type: 'web',
			provider: 'cloudflare',
			ownership: 'team_owned',
			name: 'Team Cloudflare',
			status: 'active',
			metadata: { hostType: 'web' },
		}],
		managedHosts: [{
			id: 'treeseed-managed-web',
			type: 'web',
			provider: 'cloudflare',
			ownership: 'treeseed_managed',
			name: 'Managed Cloudflare',
			status: 'active',
			metadata: { hostType: 'web' },
		}],
	};
}

function createGitFixture() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-project-host-op-'));
	const source = join(root, 'source');
	mkdirSync(source, { recursive: true });
	writeFileSync(join(source, 'README.md'), '# fixture\n', 'utf8');
	execFileSync('git', ['init', '-b', 'main'], { cwd: source, stdio: 'ignore' });
	execFileSync('git', ['add', '.'], { cwd: source, stdio: 'ignore' });
	execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial'], { cwd: source, stdio: 'ignore' });
	return {
		root,
		source,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

describe('project host binding operations', () => {
	it('derives a redacted project host binding view from resolved launch state', () => {
		const requirements = launchRequirements();
		const resolved = resolveProjectLaunchHostBindings({
			launchRequirements: requirements,
			hostBindings: {},
			...inventories(),
		});
		const view = deriveProjectHostBindingsView({
			launchRequirements: requirements,
			hostBindings: resolved.hostBindings,
			hostBindingPlans: {
				configWrites: resolved.configWritePlan,
				secretDeployment: resolved.secretDeploymentPlan,
			},
		});

		expect(view.summary).toMatchObject({ status: 'ok', total: 2 });
		expect(view.requirements.map((entry) => entry.requirementKey)).toEqual(['sourceRepository', 'publicWeb']);
		expect(view.requirements.find((entry) => entry.requirementKey === 'publicWeb')?.secretTargets[0]).toMatchObject({
			env: 'TREESEED_CLOUDFLARE_API_TOKEN',
			targets: ['github-secret'],
			sensitivity: 'secret',
		});
		expect(JSON.stringify(view)).not.toContain('secret-token');
	});

	it('plans a host replacement through the shared resolver and returns changed keys', () => {
		const requirements = launchRequirements();
		const inventory = inventories();
		const resolved = resolveProjectLaunchHostBindings({
			launchRequirements: requirements,
			hostBindings: {},
			...inventory,
		});
		const plan = planProjectHostBindingOperation({
			kind: 'replace',
			requirementKey: 'publicWeb',
			currentHostBindings: resolved.hostBindings,
			replacementHostBindings: {
				publicWeb: {
					requirementKey: 'publicWeb',
					requirementKind: 'host',
					type: 'web',
					provider: 'cloudflare',
					hostId: 'web-host-1',
					mode: 'team_owned',
					selectedBy: 'user',
				},
			},
			launchRequirements: requirements,
			...inventory,
		});

		expect(plan.nextHostBindings.publicWeb.hostId).toBe('web-host-1');
		expect(plan.operationSummary.changedRequirementKeys).toEqual(['publicWeb']);
		expect(plan.operationSummary.requiresRepositoryConfigWrite).toBe(true);
		expect(plan.operationSummary.requiresSecretSync).toBe(true);
		expect(JSON.stringify(plan)).not.toContain('TREESEED_CLOUDFLARE_API_TOKEN=');
	});

	it('rejects incompatible replacement bindings and capacity-provider requirements', () => {
		const requirements = launchRequirements();
		const inventory = inventories();
		const resolved = resolveProjectLaunchHostBindings({
			launchRequirements: requirements,
			hostBindings: {},
			...inventory,
		});

		expect(() => planProjectHostBindingOperation({
			kind: 'replace',
			requirementKey: 'publicWeb',
			currentHostBindings: resolved.hostBindings,
			replacementHostBindings: {
				publicWeb: {
					requirementKey: 'publicWeb',
					requirementKind: 'host',
					type: 'email',
					provider: 'smtp',
					hostId: 'smtp-host-1',
				},
			},
			launchRequirements: requirements,
			...inventory,
		})).toThrow(/requires host type "web"/u);

		const capacityRequirements = normalizeTemplateLaunchRequirements({
			resources: [{
				kind: 'resource',
				key: 'runtimeCapacity',
				type: 'service',
				required: true,
				displayName: 'Runtime capacity',
				purpose: 'Runs project workloads.',
			}],
		});
		expect(() => planProjectHostBindingOperation({
			kind: 'resync',
			launchRequirements: capacityRequirements,
		})).toThrow(/resource requirements are not accepted/u);
	});

	it('executes audit and replace through the shared repository config path without leaking secrets', async () => {
		const fixture = createGitFixture();
		try {
			const requirements = launchRequirements();
			const inventory = inventories();
			const resolved = resolveProjectLaunchHostBindings({
				launchRequirements: requirements,
				hostBindings: {},
				...inventory,
			});
			const plan = planProjectHostBindingOperation({
				kind: 'replace',
				requirementKey: 'publicWeb',
				currentHostBindings: resolved.hostBindings,
				replacementHostBindings: {
					publicWeb: {
						requirementKey: 'publicWeb',
						requirementKind: 'host',
						type: 'web',
						provider: 'cloudflare',
						hostId: 'web-host-1',
						mode: 'team_owned',
						selectedBy: 'user',
					},
				},
				launchRequirements: requirements,
				...inventory,
			});
			const repository = {
				provider: 'local',
				owner: 'fixture',
				name: 'project',
				defaultBranch: 'main',
				cloneUrl: fixture.source,
				writeMode: 'branch' as const,
				branchName: 'treeseed/host-binding-test',
				push: false,
				pathPolicies: [
					{ allow: 'treeseed.site.yaml' },
					{ allow: 'src/env.yaml' },
					{ allow: 'src/manifest.yaml' },
					{ allow: 'package.json' },
				],
			};
			const audit = await executeProjectHostBindingOperation({
				kind: 'audit',
				repository,
				hostBindings: resolved.hostBindings,
				hostBindingPlans: {
					configWrites: resolved.configWritePlan,
					secretDeployment: resolved.secretDeploymentPlan,
				},
				projectSlug: 'project',
				projectName: 'Project',
			}, {
				workspaceRoot: join(fixture.root, 'workspace-audit'),
				environment: 'staging',
			});
			expect(audit.repository.operation).toBe('audit_host_binding_config');
			expect((audit.repository.audit as any).status).toBe('warning');
			expect(JSON.stringify(audit)).not.toContain('secret-token');

			const replaced = await executeProjectHostBindingOperation({
				kind: 'replace',
				requirementKey: 'publicWeb',
				repository,
				hostBindings: plan.nextHostBindings,
				previousHostBindings: plan.previousHostBindings,
				hostBindingPlans: {
					configWrites: plan.hostBindingPlans.configWrites,
					secretDeployment: { items: [] },
				},
				operationSummary: {
					...plan.operationSummary,
					requiresSecretSync: false,
				},
				projectSlug: 'project',
				projectName: 'Project',
				approvalRequired: true,
				approvalId: 'approval-1',
				planOnly: true,
			}, {
				workspaceRoot: join(fixture.root, 'workspace-replace'),
				environment: 'staging',
			});
			expect(replaced.repository.operation).toBe('apply_host_binding_config');
			expect(replaced.repository.changedPaths).toContain('treeseed.site.yaml');
			expect(JSON.stringify(replaced)).not.toContain('secret-token');

			const missingSecret = await executeProjectHostBindingOperation({
				kind: 'replace',
				requirementKey: 'publicWeb',
				repository: {
					...repository,
					branchName: 'treeseed/host-binding-missing-secret-test',
				},
				hostBindings: plan.nextHostBindings,
				previousHostBindings: plan.previousHostBindings,
				hostBindingPlans: plan.hostBindingPlans,
				operationSummary: plan.operationSummary,
				projectSlug: 'project',
				projectName: 'Project',
				approvalRequired: true,
				approvalId: 'approval-2',
				planOnly: true,
			}, {
				workspaceRoot: join(fixture.root, 'workspace-missing-secret'),
				environment: 'staging',
				processEnv: {},
			});
			expect(missingSecret.ok).toBe(false);
			expect(missingSecret.secretSync?.diagnostics[0]).toMatchObject({
				code: 'missing_value',
				requirementKey: 'publicWeb',
				env: 'TREESEED_CLOUDFLARE_API_TOKEN',
			});
			expect(JSON.stringify(missingSecret)).not.toContain('secret-token');
		} finally {
			fixture.cleanup();
		}
	});
});
