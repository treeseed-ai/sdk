import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
	ensureStandardizedGitHubWorkflows,
	renderDeployWorkflow,
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
	afterEach(() => {
		delete process.env.TREESEED_GITHUB_AUTOMATION_MODE;
	});

	it('renders the standardized deploy workflow with the tenant deploy entrypoint', () => {
		const rendered = renderDeployWorkflow({ workingDirectory: 'apps/site' });
		expect(rendered).toContain('Treeseed Deploy');
		expect(rendered).toContain('working-directory: apps/site');
		expect(rendered).toContain('./packages/sdk/scripts/tenant-workflow-action.ts');
		expect(rendered).toContain('TREESEED_BOOTSTRAP_MODE: auto');
		expect(rendered).toContain('code_changed');
		expect(rendered).toContain('action_kind');
		expect(rendered).toContain('migrations/*)');
		expect(rendered).toContain('code_changed="true"');
		expect(rendered).not.toContain('docs/*|migrations/*');
		expect(rendered).toContain("needs['deploy-code'].result");
		expect(rendered).toContain('always() &&');
		expect(rendered).toContain("needs.provision.result == 'success'");
		expect(rendered).toContain('TREESEED_WORKFLOW_SKIP_PROVISION: "1"');
		expect(rendered).toContain('if [[ "${TREESEED_WORKFLOW_SKIP_PROVISION:-}" == "1" ]]; then EXTRA_ARGS+=(--skip-provision); fi');
		expect(rendered).toContain('uses: actions/upload-artifact@v4');
		expect(rendered).toContain('uses: actions/download-artifact@v4');
		expect(rendered).toContain('name: treeseed-deploy-state-${{ needs.classify.outputs.scope }}');
		expect(rendered).toContain('path: .treeseed/state');
		expect(rendered).toContain('include-hidden-files: true');
		expect(rendered).toContain('TREESEED_CONTENT_BUCKET_NAME');
		expect(rendered).toContain('TREESEED_WORKFLOW_PREVIEW_ID');
		expect(rendered).toContain('check-build-warnings');
		expect(rendered).toContain("environment: ${{ needs.classify.outputs.scope == 'prod' && 'production' || 'staging' }}");
		expect(rendered).toContain('TREESEED_SMTP_HOST: ${{ vars.TREESEED_SMTP_HOST }}');
		expect(rendered).toContain('TREESEED_SMTP_PORT: ${{ vars.TREESEED_SMTP_PORT }}');
		expect(rendered).toContain('TREESEED_SMTP_USERNAME: ${{ vars.TREESEED_SMTP_USERNAME }}');
		expect(rendered).toContain('TREESEED_SMTP_PASSWORD: ${{ secrets.TREESEED_SMTP_PASSWORD }}');
		expect(rendered).toContain('TREESEED_SMTP_FROM: ${{ vars.TREESEED_SMTP_FROM }}');
		expect(rendered).toContain('TREESEED_SMTP_REPLY_TO: ${{ vars.TREESEED_SMTP_REPLY_TO }}');
		expect(rendered).toContain('RAILWAY_API_TOKEN: ${{ secrets.RAILWAY_API_TOKEN }}');
		for (const line of [
			'TREESEED_RAILWAY_WORKSPACE: ${{ vars.TREESEED_RAILWAY_WORKSPACE }}',
			'TREESEED_HOSTING_KIND: ${{ vars.TREESEED_HOSTING_KIND }}',
			'TREESEED_HOSTING_REGISTRATION: ${{ vars.TREESEED_HOSTING_REGISTRATION }}',
			'TREESEED_API_BASE_URL: ${{ vars.TREESEED_API_BASE_URL }}',
			'TREESEED_BETTER_AUTH_SECRET: ${{ secrets.TREESEED_BETTER_AUTH_SECRET }}',
			'TREESEED_WEB_SERVICE_ID: ${{ vars.TREESEED_WEB_SERVICE_ID }}',
			'TREESEED_WEB_SERVICE_SECRET: ${{ secrets.TREESEED_WEB_SERVICE_SECRET }}',
			'TREESEED_WEB_ASSERTION_SECRET: ${{ secrets.TREESEED_WEB_ASSERTION_SECRET }}',
			'TREESEED_WEB_CSRF_SECRET: ${{ secrets.TREESEED_WEB_CSRF_SECRET }}',
			'TREESEED_API_WEB_SERVICE_ID: ${{ vars.TREESEED_API_WEB_SERVICE_ID }}',
			'TREESEED_API_WEB_SERVICE_SECRET: ${{ secrets.TREESEED_API_WEB_SERVICE_SECRET }}',
			'TREESEED_API_WEB_ASSERTION_SECRET: ${{ secrets.TREESEED_API_WEB_ASSERTION_SECRET }}',
		]) {
			expect(rendered).toContain(line);
		}
		expect(rendered).not.toContain('TREESEED_SMTP_HOST: ${{ secrets.TREESEED_SMTP_HOST }}');
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
  projectId: project-1`);

		const marketWorkflows = ensureStandardizedGitHubWorkflows(marketRoot);
		const hostedWorkflows = ensureStandardizedGitHubWorkflows(hostedRoot);

		expect(marketWorkflows).toHaveLength(2);
		expect(hostedWorkflows).toHaveLength(1);
		expect(readFileSync(resolve(marketRoot, '.github', 'workflows', 'deploy.yml'), 'utf8')).toContain('Treeseed Deploy');
		expect(readFileSync(resolve(marketRoot, '.github', 'workflows', 'hosted-project.yml'), 'utf8')).toContain('Treeseed Hosted Project Orchestration');
		expect(readFileSync(resolve(hostedRoot, '.github', 'workflows', 'deploy.yml'), 'utf8')).toContain('./packages/sdk/scripts/tenant-workflow-action.ts');
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
