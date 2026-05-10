import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
	ensureStandardizedGitHubWorkflows,
	renderDeployProcessingWorkflow,
	renderDeployWebWorkflow,
	renderHostedProjectWorkflow,
	resolveGitHubRepositoryTarget,
} from '../../src/operations/services/github-automation.ts';

function createTenantRoot(hostingBlock: string) {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-github-automation-'));
	mkdirSync(resolve(root, '.github', 'workflows'), { recursive: true });
	writeFileSync(resolve(root, 'package.json'), `${JSON.stringify({ name: 'automation-test', private: true }, null, 2)}\n`, 'utf8');
	writeFileSync(
		resolve(root, 'treeseed.site.yaml'),
		`name: Automation Test
slug: automation-test
siteUrl: https://example.com
contactEmail: hello@example.com
${hostingBlock}
cloudflare:
  accountId: test-account
plugins:
  - package: '@treeseed/sdk/plugin-default'
providers:
  forms: store_only
  agents:
    execution: stub
    mutation: local_branch
    repository: stub
    verification: stub
    notification: stub
    research: stub
  deploy: cloudflare
  content:
    runtime: team_scoped_r2_overlay
    publish: team_scoped_r2_overlay
    docs: default
  site: default
turnstile:
  enabled: false
`,
		'utf8',
	);
	return root;
}

describe('github automation workflow generation', () => {
	it('renders separate web and processing deploy workflows with the tenant action entrypoint', () => {
		const web = renderDeployWebWorkflow({ workingDirectory: 'apps/site' });
		const processing = renderDeployProcessingWorkflow({ workingDirectory: 'apps/site' });
		for (const rendered of [web, processing]) {
			expect(rendered).toContain('working-directory: apps/site');
			expect(rendered).toContain('./packages/sdk/scripts/tenant-workflow-action.ts');
			expect(rendered).toContain('TREESEED_BOOTSTRAP_MODE: auto');
			expect(rendered).toContain('TREESEED_WORKFLOW_ACTION: ${{ inputs.action_kind }}');
			expect(rendered).toContain('TREESEED_WORKFLOW_PREVIEW_ID');
			expect(rendered).not.toContain('TREESEED_WORKFLOW_SKIP_PROVISION');
			expect(rendered).not.toContain('--skip-provision');
			expect(rendered).not.toContain('deploy_code');
			expect(rendered).not.toContain('provision');
		}

		expect(web).toContain('Treeseed Web Deploy');
		expect(web).toContain('default: deploy_web');
		expect(web).toContain('publish_content');
		expect(web).toContain('TREESEED_CONTENT_BUCKET_NAME');
		expect(web).toContain('TREESEED_WORKFLOW_PLANE: web');
		expect(web).toContain('TREESEED_SMTP_PASSWORD: ${{ secrets.TREESEED_SMTP_PASSWORD }}');
		expect(web).toContain('TREESEED_BETTER_AUTH_SECRET: ${{ secrets.TREESEED_BETTER_AUTH_SECRET }}');
		expect(web).toContain('TREESEED_WEB_SERVICE_SECRET: ${{ secrets.TREESEED_WEB_SERVICE_SECRET }}');
		expect(web).toContain("TREESEED_CENTRAL_MARKET_API_BASE_URL: ${{ vars.TREESEED_CENTRAL_MARKET_API_BASE_URL || 'https://api.treeseed.ai' }}");
		expect(web).not.toContain('RAILWAY_API_TOKEN');
		expect(web).not.toContain('TREESEED_API_AUTH_SECRET');
		expect(web).not.toContain('TREESEED_AGENT_POOL_MAX_WORKERS');

		expect(processing).toContain('Treeseed Processing Deploy');
		expect(processing).toContain('default: deploy_processing');
		expect(processing).toContain('TREESEED_WORKFLOW_PLANE: processing');
		expect(processing).toContain('RAILWAY_API_TOKEN: ${{ secrets.RAILWAY_API_TOKEN }}');
		expect(processing).toContain('TREESEED_API_BASE_URL: ${{ vars.TREESEED_API_BASE_URL }}');
		expect(processing).toContain('TREESEED_API_AUTH_SECRET: ${{ secrets.TREESEED_API_AUTH_SECRET }}');
		expect(processing).toContain('TREESEED_AGENT_POOL_MAX_WORKERS');
		expect(processing).toContain('TREESEED_CAPACITY_PROVIDER_ID');
		expect(processing).not.toContain('TREESEED_SMTP_PASSWORD');
	});

	it('renders the hosted project orchestration workflow template', () => {
		const rendered = renderHostedProjectWorkflow({ workingDirectory: '.' });
		expect(rendered).toContain('Treeseed Hosted Project Orchestration');
		expect(rendered).toContain('tenant_repository');
		expect(rendered).toContain('/actions/workflows/${WORKFLOW_FILE}/dispatches');
	});

	it('creates both workflow files for the market control plane and only deploy for project repos', () => {
		const marketRoot = createTenantRoot(`hosting:
  kind: market_control_plane
  registration: none`);
	const hostedRoot = createTenantRoot(`hosting:
  kind: hosted_project
  registration: optional
  marketBaseUrl: https://api.treeseed.ai
  teamId: team-1
  projectId: project-1
hub:
  mode: treeseed_hosted
runtime:
  mode: treeseed_managed`);

		const marketWorkflows = ensureStandardizedGitHubWorkflows(marketRoot);
		const hostedWorkflows = ensureStandardizedGitHubWorkflows(hostedRoot);

		expect(marketWorkflows).toHaveLength(3);
		expect(hostedWorkflows).toHaveLength(1);
		expect(readFileSync(resolve(marketRoot, '.github', 'workflows', 'deploy-web.yml'), 'utf8')).toContain('Treeseed Web Deploy');
		expect(readFileSync(resolve(marketRoot, '.github', 'workflows', 'deploy-processing.yml'), 'utf8')).toContain('Treeseed Processing Deploy');
		expect(readFileSync(resolve(marketRoot, '.github', 'workflows', 'hosted-project.yml'), 'utf8')).toContain('Treeseed Hosted Project Orchestration');
		const hostedDeploy = readFileSync(resolve(hostedRoot, '.github', 'workflows', 'deploy-web.yml'), 'utf8');
		expect(hostedDeploy).toContain('Treeseed Web Deploy');
		expect(hostedDeploy).toContain('default: deploy_web');
		expect(hostedDeploy).toContain('packages/sdk packages/agent packages/core packages/cli');
		expect(hostedDeploy).toContain('CLOUDFLARE_API_TOKEN');
		expect(hostedDeploy).not.toContain('RAILWAY_API_TOKEN');
	});

	it('uses configured GitHub repository metadata over a mismatched origin', () => {
		const root = createTenantRoot(`hosting:
  kind: self_hosted_project`);
		spawnSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
		spawnSync('git', ['remote', 'add', 'origin', 'git@github.com:old-owner/old-repo.git'], { cwd: root, stdio: 'ignore' });

		expect(resolveGitHubRepositoryTarget(root, {
			values: {
				TREESEED_GITHUB_OWNER: 'knowledge-coop',
				TREESEED_GITHUB_REPOSITORY_NAME: 'market',
				TREESEED_GITHUB_REPOSITORY_VISIBILITY: 'public',
			},
		})).toMatchObject({
			owner: 'knowledge-coop',
			name: 'market',
			visibility: 'public',
			source: 'config',
		});
	});
});
