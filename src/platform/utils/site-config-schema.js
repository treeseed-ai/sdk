import { parse as parseYaml } from 'yaml';
import { normalizeAliasedRecord } from '../../field-aliases.ts';

/** @typedef {import('../../field-aliases.ts').TreeseedFieldAliasRegistry} TreeseedFieldAliasRegistry */

function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectRecord(value, path) {
	if (!isRecord(value)) {
		throw new Error(`Expected ${path} to be an object.`);
	}

	return value;
}

function expectString(value, path) {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`Expected ${path} to be a non-empty string.`);
	}

	return value.trim();
}

function optionalString(value, path) {
	if (value === undefined || value === null || value === '') {
		return undefined;
	}

	return expectString(value, path);
}

function optionalBoolean(value, path) {
	if (value === undefined || value === null) {
		return undefined;
	}

	if (typeof value !== 'boolean') {
		throw new Error(`Expected ${path} to be a boolean.`);
	}

	return value;
}

function optionalRecord(value, path) {
	if (value === undefined || value === null) {
		return undefined;
	}

	return expectRecord(value, path);
}

function optionalEnum(value, path, allowed) {
	if (value === undefined || value === null || value === '') {
		return undefined;
	}

	const parsedValue = expectString(value, path);
	if (!allowed.includes(parsedValue)) {
		throw new Error(`Expected ${path} to be one of: ${allowed.join(', ')}.`);
	}

	return parsedValue;
}

function stringArray(value, path) {
	if (value === undefined || value === null) {
		return [];
	}

	if (!Array.isArray(value)) {
		throw new Error(`Expected ${path} to be an array.`);
	}

	return value.map((entry, index) => expectString(entry, `${path}[${index}]`));
}

function parseMenuGroups(value, path) {
	if (!Array.isArray(value)) {
		throw new Error(`Expected ${path} to be an array.`);
	}

	return value.map((group, groupIndex) => {
		const parsedGroup = expectRecord(group, `${path}[${groupIndex}]`);
		const items = parsedGroup.items;
		if (!Array.isArray(items) || items.length === 0) {
			throw new Error(`Expected ${path}[${groupIndex}].items to contain at least one menu item.`);
		}

		return {
			label: expectString(parsedGroup.label, `${path}[${groupIndex}].label`),
			items: items.map((item, itemIndex) => {
				const parsedItem = expectRecord(item, `${path}[${groupIndex}].items[${itemIndex}]`);
				return {
					label: expectString(parsedItem.label, `${path}[${groupIndex}].items[${itemIndex}].label`),
					href: expectString(parsedItem.href, `${path}[${groupIndex}].items[${itemIndex}].href`),
				};
			}),
		};
	});
}

function parseContactRouting(value, path) {
	const parsedValue = expectRecord(value ?? {}, path);
	const keys = ['default', 'question', 'feedback', 'collaboration', 'issue'];

	return Object.fromEntries(
		keys.flatMap((key) => {
			if (!(key in parsedValue)) {
				return [];
			}

			return [[key, stringArray(parsedValue[key], `${path}.${key}`)]];
		}),
	);
}

const BUILT_IN_THEME_SCHEMES = new Set(['fern', 'lichen', 'cedar', 'tidepool']);
const THEME_TOKEN_NAMES = new Set([
	'canvas',
	'canvasSubtle',
	'surface',
	'surfaceMuted',
	'surfaceRaised',
	'surfaceOverlay',
	'text',
	'textMuted',
	'textSubtle',
	'textInverse',
	'link',
	'linkHover',
	'border',
	'borderMuted',
	'borderStrong',
	'focus',
	'accent',
	'accentHover',
	'accentStrong',
	'accentSoft',
	'accentText',
	'info',
	'infoSoft',
	'infoText',
	'infoBorder',
	'success',
	'successSoft',
	'successText',
	'successBorder',
	'warning',
	'warningSoft',
	'warningText',
	'warningBorder',
	'danger',
	'dangerSoft',
	'dangerText',
	'dangerBorder',
	'shadow',
	'grid',
]);

function parseThemeSchemeId(value, path) {
	const schemeId = expectString(value, path);
	if (!/^[a-z][a-z0-9-]*$/u.test(schemeId)) {
		throw new Error(`Expected ${path} to be a stable lowercase slug.`);
	}
	return schemeId;
}

function parseThemeTokenOverrides(value, path) {
	const record = optionalRecord(value, path);
	if (!record) {
		return undefined;
	}

	return Object.fromEntries(
		Object.entries(record).map(([tokenName, tokenValue]) => {
			if (!THEME_TOKEN_NAMES.has(tokenName)) {
				throw new Error(`Unknown theme token ${path}.${tokenName}.`);
			}
			return [tokenName, expectString(tokenValue, `${path}.${tokenName}`)];
		}),
	);
}

function parseThemeScheme(value, path) {
	const scheme = expectRecord(value, path);
	const allowedKeys = new Set(['light', 'dark']);
	for (const key of Object.keys(scheme)) {
		if (!allowedKeys.has(key)) {
			throw new Error(`Unknown theme scheme key ${path}.${key}.`);
		}
	}
	return {
		light: parseThemeTokenOverrides(scheme.light, `${path}.light`),
		dark: parseThemeTokenOverrides(scheme.dark, `${path}.dark`),
	};
}

function parseTheme(value, path) {
	const theme = optionalRecord(value, path);
	if (!theme) {
		return undefined;
	}

	const allowedKeys = new Set(['defaultScheme', 'defaultMode', 'schemes']);
	for (const key of Object.keys(theme)) {
		if (!allowedKeys.has(key)) {
			throw new Error(`Unknown theme key ${path}.${key}.`);
		}
	}

	const schemes = optionalRecord(theme.schemes, `${path}.schemes`);
	const parsedSchemes = schemes
		? Object.fromEntries(
			Object.entries(schemes).map(([schemeId, scheme]) => [
				parseThemeSchemeId(schemeId, `${path}.schemes.${schemeId}`),
				parseThemeScheme(scheme, `${path}.schemes.${schemeId}`),
			]),
		)
		: undefined;
	const defaultScheme = optionalString(theme.defaultScheme, `${path}.defaultScheme`);
	if (defaultScheme) {
		parseThemeSchemeId(defaultScheme, `${path}.defaultScheme`);
		if (!BUILT_IN_THEME_SCHEMES.has(defaultScheme) && !(parsedSchemes && defaultScheme in parsedSchemes)) {
			throw new Error(`Expected ${path}.defaultScheme to reference a built-in or configured scheme.`);
		}
	}

	return {
		defaultScheme,
		defaultMode: optionalEnum(theme.defaultMode, `${path}.defaultMode`, ['light', 'dark', 'system']),
		schemes: parsedSchemes,
	};
}

function parseAccessRoles(value, path) {
	const record = optionalRecord(value, path);
	if (!record) {
		return {};
	}

	return Object.fromEntries(
		Object.entries(record).map(([roleId, rawRole]) => {
			const parsedRole = expectRecord(rawRole, `${path}.${roleId}`);
			return [
				roleId,
				{
					grants: stringArray(parsedRole.grants, `${path}.${roleId}.grants`),
				},
			];
		}),
	);
}

function parseAccessPolicies(value, path) {
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

function parseAccessDefaults(value, path) {
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

function parseAccessBootstrap(value, path) {
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

function parseAccess(value, path) {
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
const siteFieldAliases = {
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
const pageDefaultsFieldAliases = {
	pageLayout: { key: 'pageLayout', aliases: ['page_layout'] },
};

/** @type {TreeseedFieldAliasRegistry} */
const agentDefaultsFieldAliases = {
	runtimeStatus: { key: 'runtimeStatus', aliases: ['runtime_status'] },
};

/** @type {TreeseedFieldAliasRegistry} */
const formsFieldAliases = {
	apiBaseUrl: { key: 'apiBaseUrl', aliases: ['api_base_url'] },
};

/** @type {TreeseedFieldAliasRegistry} */
const emailNotificationFieldAliases = {
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
