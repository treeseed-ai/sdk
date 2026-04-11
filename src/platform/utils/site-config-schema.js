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

function parseTheme(value, path) {
	const theme = optionalRecord(value, path);
	if (!theme) {
		return undefined;
	}

	const surfaces = optionalRecord(theme.surfaces, `${path}.surfaces`);
	const text = optionalRecord(theme.text, `${path}.text`);
	const border = optionalRecord(theme.border, `${path}.border`);
	const accent = optionalRecord(theme.accent, `${path}.accent`);
	const info = optionalRecord(theme.info, `${path}.info`);
	const warm = optionalRecord(theme.warm, `${path}.warm`);

	return {
		surfaces: surfaces
			? {
				background: optionalString(surfaces.background, `${path}.surfaces.background`),
				backgroundElevated: optionalString(
					surfaces.backgroundElevated,
					`${path}.surfaces.backgroundElevated`,
				),
				backgroundSoft: optionalString(surfaces.backgroundSoft, `${path}.surfaces.backgroundSoft`),
				panel: optionalString(surfaces.panel, `${path}.surfaces.panel`),
				panelStrong: optionalString(surfaces.panelStrong, `${path}.surfaces.panelStrong`),
			}
			: undefined,
		text: text
			? {
				body: optionalString(text.body, `${path}.text.body`),
				muted: optionalString(text.muted, `${path}.text.muted`),
				soft: optionalString(text.soft, `${path}.text.soft`),
			}
			: undefined,
		border: border
			? {
				base: optionalString(border.base, `${path}.border.base`),
				strong: optionalString(border.strong, `${path}.border.strong`),
				grid: optionalString(border.grid, `${path}.border.grid`),
			}
			: undefined,
		accent: accent
			? {
				base: optionalString(accent.base, `${path}.accent.base`),
				strong: optionalString(accent.strong, `${path}.accent.strong`),
				soft: optionalString(accent.soft, `${path}.accent.soft`),
			}
			: undefined,
		info: info
			? {
				base: optionalString(info.base, `${path}.info.base`),
				strong: optionalString(info.strong, `${path}.info.strong`),
				soft: optionalString(info.soft, `${path}.info.soft`),
			}
			: undefined,
		warm: warm
			? {
				base: optionalString(warm.base, `${path}.warm.base`),
				strong: optionalString(warm.strong, `${path}.warm.strong`),
			}
			: undefined,
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
	const peopleModel = expectRecord(models.people ?? {}, 'models.people');
	const agentModel = expectRecord(models.agents ?? {}, 'models.agents');
	const bookModel = expectRecord(models.books ?? {}, 'models.books');
	const docsModel = expectRecord(models.docs ?? {}, 'models.docs');
	const pageDefaults = normalizeAliasedRecord(pageDefaultsFieldAliases, expectRecord(pageModel.defaults ?? {}, 'models.pages.defaults'));
	const noteDefaults = expectRecord(noteModel.defaults ?? {}, 'models.notes.defaults');
	const questionDefaults = expectRecord(questionModel.defaults ?? {}, 'models.questions.defaults');
	const objectiveDefaults = expectRecord(objectiveModel.defaults ?? {}, 'models.objectives.defaults');
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
	};
}
