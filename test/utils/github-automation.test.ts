import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
	ensureStandardizedGitHubWorkflows,
	renderDeployWorkflow,
	renderHostedProjectWorkflow,
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
		expect(rendered).toContain('code_changed');
		expect(rendered).toContain('action_kind');
		expect(rendered).toContain("needs['deploy-code'].result");
		expect(rendered).toContain('TREESEED_CONTENT_BUCKET_NAME');
		expect(rendered).toContain('TREESEED_WORKFLOW_PREVIEW_ID');
		expect(rendered).toContain('check-build-warnings');
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
});
