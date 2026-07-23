// @ts-nocheck
import { parse as parseYaml } from 'yaml';
import { normalizeAliasedRecord } from '../../../field-aliases.ts';
import { expectRecord, expectString, optionalBoolean, optionalRecord, optionalString, parseAccessRoles, parseContactRouting, parseMenuGroups, parseTheme, stringArray } from './is-record.ts';

export function parseAccessPolicies(value, path) {
	const record = optionalRecord(value, path);
	if (!record) {
		return {};
	}

	return Object.fromEntries(
		Object.entries(record).map(([policyId, rawPolicy]) => {
			const parsedPolicy = expectRecord(rawPolicy, `${path}.${policyId}`);
			return [
				policyId,
				{
					audience: optionalString(parsedPolicy.audience, `${path}.${policyId}.audience`),
					entitlement: optionalString(parsedPolicy.entitlement, `${path}.${policyId}.entitlement`),
					offer: optionalString(parsedPolicy.offer, `${path}.${policyId}.offer`),
					visibility: optionalString(parsedPolicy.visibility, `${path}.${policyId}.visibility`),
				},
			];
		}),
	);
}

export function parseAccessDefaults(value, path) {
	const record = optionalRecord(value, path);
	if (!record) {
		return { models: {} };
	}

	const models = optionalRecord(record.models, `${path}.models`) ?? {};
	return {
		models: Object.fromEntries(
			Object.entries(models).map(([modelId, rawSurfaces]) => {
				const parsedSurfaces = expectRecord(rawSurfaces, `${path}.models.${modelId}`);
				return [
					modelId,
					Object.fromEntries(
						Object.entries(parsedSurfaces).map(([surfaceId, rawPolicy]) => [
							surfaceId,
							expectString(rawPolicy, `${path}.models.${modelId}.${surfaceId}`),
						]),
					),
				];
			}),
		),
	};
}

export function parseAccessBootstrap(value, path) {
	const record = optionalRecord(value, path);
	if (!record) {
		return {};
	}

	const owners = optionalRecord(record.owners, `${path}.owners`);
	return {
		owners: owners
			? {
				emails: stringArray(owners.emails, `${path}.owners.emails`),
				roles: stringArray(owners.roles, `${path}.owners.roles`),
			}
			: undefined,
	};
}

export function parseAccess(value, path) {
	const record = optionalRecord(value, path);
	if (!record) {
		return {
			roles: {},
			policies: {},
			defaults: { models: {} },
			bootstrap: {},
		};
	}

	return {
		roles: parseAccessRoles(record.roles, `${path}.roles`),
		policies: parseAccessPolicies(record.policies, `${path}.policies`),
		defaults: parseAccessDefaults(record.defaults, `${path}.defaults`),
		bootstrap: parseAccessBootstrap(record.bootstrap, `${path}.bootstrap`),
	};
}

/** @type {TreeseedFieldAliasRegistry} */
export const siteFieldAliases = {
	siteUrl: { key: 'siteUrl', aliases: ['site_url'] },
	githubRepository: { key: 'githubRepository', aliases: ['github_repository'] },
	discordLink: { key: 'discordLink', aliases: ['discord_link'] },
	headerMenu: { key: 'headerMenu', aliases: ['header_menu'] },
	footerMenu: { key: 'footerMenu', aliases: ['footer_menu'] },
	emailNotifications: { key: 'emailNotifications', aliases: ['email_notifications'] },
	projectStage: { key: 'projectStage', aliases: ['project_stage'] },
	projectStageDetail: { key: 'projectStageDetail', aliases: ['project_stage_detail'] },
};

/** @type {TreeseedFieldAliasRegistry} */
export const pageDefaultsFieldAliases = {
	pageLayout: { key: 'pageLayout', aliases: ['page_layout'] },
};

/** @type {TreeseedFieldAliasRegistry} */
export const agentDefaultsFieldAliases = {
	runtimeStatus: { key: 'runtimeStatus', aliases: ['runtime_status'] },
};

/** @type {TreeseedFieldAliasRegistry} */
export const formsFieldAliases = {
	apiBaseUrl: { key: 'apiBaseUrl', aliases: ['api_base_url'] },
};

/** @type {TreeseedFieldAliasRegistry} */
export const emailNotificationFieldAliases = {
	contactRouting: { key: 'contactRouting', aliases: ['contact_routing'] },
	subscribeRecipients: { key: 'subscribeRecipients', aliases: ['subscribe_recipients'] },
};

/**
 * @param {string} source
 */
export function parseSiteConfig(source) {
	const parsed = expectRecord(parseYaml(source), 'config');
	const site = normalizeAliasedRecord(siteFieldAliases, expectRecord(parsed.site, 'site'));
	const models = expectRecord(parsed.models ?? {}, 'models');
	const pageModel = expectRecord(models.pages ?? {}, 'models.pages');
	const noteModel = expectRecord(models.notes ?? {}, 'models.notes');
	const questionModel = expectRecord(models.questions ?? {}, 'models.questions');
	const objectiveModel = expectRecord(models.objectives ?? {}, 'models.objectives');
	const proposalModel = expectRecord(models.proposals ?? {}, 'models.proposals');
	const decisionModel = expectRecord(models.decisions ?? {}, 'models.decisions');
	const peopleModel = expectRecord(models.people ?? {}, 'models.people');
	const agentModel = expectRecord(models.agents ?? {}, 'models.agents');
	const bookModel = expectRecord(models.books ?? {}, 'models.books');
	const docsModel = expectRecord(models.docs ?? {}, 'models.docs');
	const pageDefaults = normalizeAliasedRecord(pageDefaultsFieldAliases, expectRecord(pageModel.defaults ?? {}, 'models.pages.defaults'));
	const noteDefaults = expectRecord(noteModel.defaults ?? {}, 'models.notes.defaults');
	const questionDefaults = expectRecord(questionModel.defaults ?? {}, 'models.questions.defaults');
	const objectiveDefaults = expectRecord(objectiveModel.defaults ?? {}, 'models.objectives.defaults');
	const proposalDefaults = expectRecord(proposalModel.defaults ?? {}, 'models.proposals.defaults');
	const decisionDefaults = expectRecord(decisionModel.defaults ?? {}, 'models.decisions.defaults');
	const peopleDefaults = expectRecord(peopleModel.defaults ?? {}, 'models.people.defaults');
	const agentDefaults = normalizeAliasedRecord(agentDefaultsFieldAliases, expectRecord(agentModel.defaults ?? {}, 'models.agents.defaults'));
	const bookDefaults = expectRecord(bookModel.defaults ?? {}, 'models.books.defaults');
	const docsDefaults = expectRecord(docsModel.defaults ?? {}, 'models.docs.defaults');
	const logo = expectRecord(site.logo, 'site.logo');
	const forms = normalizeAliasedRecord(formsFieldAliases, expectRecord(site.forms ?? {}, 'site.forms'));
	const emailNotifications = normalizeAliasedRecord(
		emailNotificationFieldAliases,
		expectRecord(site.emailNotifications, 'site.emailNotifications'),
	);
	const access = parseAccess(parsed.access, 'access');

	return {
		site: {
			logo: {
				src: expectString(logo.src, 'site.logo.src'),
				alt: expectString(logo.alt, 'site.logo.alt'),
			},
			name: expectString(site.name, 'site.name'),
			statement: expectString(site.statement, 'site.statement'),
			siteUrl: expectString(site.siteUrl, 'site.siteUrl'),
			githubRepository: expectString(site.githubRepository, 'site.githubRepository'),
			discordLink: expectString(site.discordLink, 'site.discordLink'),
			headerMenu: parseMenuGroups(site.headerMenu, 'site.headerMenu'),
			footerMenu: parseMenuGroups(site.footerMenu, 'site.footerMenu'),
			forms: {
				apiBaseUrl: optionalString(forms.apiBaseUrl, 'site.forms.apiBaseUrl'),
			},
			emailNotifications: {
				contactRouting: parseContactRouting(
					emailNotifications.contactRouting,
					'site.emailNotifications.contactRouting',
				),
				subscribeRecipients: stringArray(
					emailNotifications.subscribeRecipients,
					'site.emailNotifications.subscribeRecipients',
				),
			},
			summary: expectString(site.summary, 'site.summary'),
			projectStage: expectString(site.projectStage, 'site.projectStage'),
			projectStageDetail: expectString(site.projectStageDetail, 'site.projectStageDetail'),
			theme: parseTheme(site.theme, 'site.theme'),
		},
		models: {
			pages: {
				defaults: {
					pageLayout: optionalString(pageDefaults.pageLayout, 'models.pages.defaults.pageLayout'),
					status: optionalString(pageDefaults.status, 'models.pages.defaults.status'),
					stage: optionalString(pageDefaults.stage, 'models.pages.defaults.stage'),
					audience: stringArray(pageDefaults.audience, 'models.pages.defaults.audience'),
				},
			},
			notes: {
				defaults: {
					author: optionalString(noteDefaults.author, 'models.notes.defaults.author'),
					draft: optionalBoolean(noteDefaults.draft, 'models.notes.defaults.draft'),
					tags: stringArray(noteDefaults.tags, 'models.notes.defaults.tags'),
					status: optionalString(noteDefaults.status, 'models.notes.defaults.status'),
				},
			},
			questions: {
				defaults: {
					draft: optionalBoolean(questionDefaults.draft, 'models.questions.defaults.draft'),
					tags: stringArray(questionDefaults.tags, 'models.questions.defaults.tags'),
					status: optionalString(questionDefaults.status, 'models.questions.defaults.status'),
				},
			},
			objectives: {
				defaults: {
					draft: optionalBoolean(objectiveDefaults.draft, 'models.objectives.defaults.draft'),
					tags: stringArray(objectiveDefaults.tags, 'models.objectives.defaults.tags'),
					status: optionalString(objectiveDefaults.status, 'models.objectives.defaults.status'),
				},
			},
			proposals: {
				defaults: {
					draft: optionalBoolean(proposalDefaults.draft, 'models.proposals.defaults.draft'),
					tags: stringArray(proposalDefaults.tags, 'models.proposals.defaults.tags'),
					status: optionalString(proposalDefaults.status, 'models.proposals.defaults.status'),
				},
			},
			decisions: {
				defaults: {
					draft: optionalBoolean(decisionDefaults.draft, 'models.decisions.defaults.draft'),
					tags: stringArray(decisionDefaults.tags, 'models.decisions.defaults.tags'),
					status: optionalString(decisionDefaults.status, 'models.decisions.defaults.status'),
				},
			},
			people: {
				defaults: {
					status: optionalString(peopleDefaults.status, 'models.people.defaults.status'),
					tags: stringArray(peopleDefaults.tags, 'models.people.defaults.tags'),
				},
			},
			agents: {
				defaults: {
					tags: stringArray(agentDefaults.tags, 'models.agents.defaults.tags'),
					runtimeStatus: optionalString(
						agentDefaults.runtimeStatus,
						'models.agents.defaults.runtimeStatus',
					),
				},
			},
			books: {
				defaults: {
					tags: stringArray(bookDefaults.tags, 'models.books.defaults.tags'),
				},
			},
			docs: {
				defaults: {
					tags: stringArray(docsDefaults.tags, 'models.docs.defaults.tags'),
				},
			},
		},
		access,
	};
}
