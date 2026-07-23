import { describe, expect, it } from 'vitest';
import { deriveProjectLaunchRequirementsViewModel } from '../../../src/template-launch-ui.ts';
import { normalizeTemplateLaunchRequirements } from '../../../src/template-launch-requirements.ts';

describe('template launch requirement UI view model', () => {
	const launchRequirements = normalizeTemplateLaunchRequirements({
		version: 1,
		hosts: [
			{
				kind: 'host',
				key: 'sourceRepository',
				type: 'repository',
				required: true,
				compatibleProviders: ['github'],
				displayName: 'Source repository',
				purpose: 'Create and update project source.',
				defaultSelection: 'team-default',
				configWrites: [{ target: 'treeseed.site.yaml', path: 'hosting.hostBindings.sourceRepository.provider', valueFrom: 'selectedHost.provider' }],
			},
			{
				kind: 'host',
				key: 'publicWeb',
				type: 'web',
				required: true,
				compatibleProviders: ['cloudflare'],
				displayName: 'Public web',
				purpose: 'Deploy the public site.',
				defaultSelection: 'managed',
				environmentWrites: [{ env: 'TREESEED_CLOUDFLARE_API_TOKEN', valueFrom: 'selectedHost.secret:TREESEED_CLOUDFLARE_API_TOKEN', targets: ['cloudflare-secret'], sensitivity: 'secret' }],
			},
			{
				kind: 'host',
				key: 'transactionalEmail',
				type: 'email',
				required: false,
				compatibleProviders: ['smtp'],
				displayName: 'Transactional email',
				purpose: 'Send product email.',
				defaultSelection: 'none',
			},
		],
	});

	it('derives host choices, defaults, and previews from template requirements and inventory', () => {
		const view = deriveProjectLaunchRequirementsViewModel({
			launchRequirements,
			repositoryHosts: [{
				id: 'repo-default',
				type: 'repository',
				provider: 'github',
				ownership: 'team_owned',
				name: 'Team GitHub',
				status: 'active',
			}],
			teamHosts: [{
				id: 'web-team',
				provider: 'cloudflare',
				ownership: 'team_owned',
				name: 'Team Cloudflare',
				status: 'active',
				metadata: { hostType: 'web', dns: { zoneName: 'example.com' } },
			}],
			managedHosts: [{
				id: 'treeseed-managed-web',
				provider: 'cloudflare',
				ownership: 'treeseed_managed',
				name: 'TreeSeed Web Host',
				status: 'active',
				metadata: { hostType: 'web', dns: { zoneName: 'treeseed.example' } },
			}],
			defaultHosts: { repository: 'repo-default' },
		});

		expect(view.hosts.map((host) => host.key)).toEqual(['sourceRepository', 'publicWeb', 'transactionalEmail']);
		expect(view.hosts.find((host) => host.key === 'sourceRepository')?.choices.find((choice) => choice.selected)).toMatchObject({
			mode: 'team_owned',
			hostId: 'repo-default',
		});
		expect(view.hosts.find((host) => host.key === 'publicWeb')?.choices.find((choice) => choice.selected)).toMatchObject({
			mode: 'treeseed_managed',
			managedHostKey: 'treeseed-managed-web',
			rootDomain: 'treeseed.example',
		});
		expect(view.hosts.find((host) => host.key === 'transactionalEmail')?.choices.find((choice) => choice.selected)).toMatchObject({
			mode: 'none',
		});
		expect(view.hosts.find((host) => host.key === 'sourceRepository')?.configWritePreviews).toEqual([{
			target: 'treeseed.site.yaml',
			path: 'hosting.hostBindings.sourceRepository.provider',
			valueFrom: 'selectedHost.provider',
			writeWhen: undefined,
		}]);
		expect(JSON.stringify(view)).not.toContain('TREESEED_CLOUDFLARE_API_TOKEN_VALUE');
	});
});
