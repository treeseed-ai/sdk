// @ts-nocheck
import { parse as parseYaml } from 'yaml';
import { normalizeAliasedRecord } from '../../../entrypoints/models/field-aliases.ts';


/** @typedef {import('../../../entrypoints/models/field-aliases.ts').FieldAliasRegistry} FieldAliasRegistry */

export function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function expectRecord(value, path) {
	if (!isRecord(value)) {
		throw new Error(`Expected ${path} to be an object.`);
	}

	return value;
}

export function expectString(value, path) {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`Expected ${path} to be a non-empty string.`);
	}

	return value.trim();
}

export function optionalString(value, path) {
	if (value === undefined || value === null || value === '') {
		return undefined;
	}

	return expectString(value, path);
}

export function optionalBoolean(value, path) {
	if (value === undefined || value === null) {
		return undefined;
	}

	if (typeof value !== 'boolean') {
		throw new Error(`Expected ${path} to be a boolean.`);
	}

	return value;
}

export function optionalRecord(value, path) {
	if (value === undefined || value === null) {
		return undefined;
	}

	return expectRecord(value, path);
}

export function optionalEnum(value, path, allowed) {
	if (value === undefined || value === null || value === '') {
		return undefined;
	}

	const parsedValue = expectString(value, path);
	if (!allowed.includes(parsedValue)) {
		throw new Error(`Expected ${path} to be one of: ${allowed.join(', ')}.`);
	}

	return parsedValue;
}

export function stringArray(value, path) {
	if (value === undefined || value === null) {
		return [];
	}

	if (!Array.isArray(value)) {
		throw new Error(`Expected ${path} to be an array.`);
	}

	return value.map((entry, index) => expectString(entry, `${path}[${index}]`));
}

export function parseMenuGroups(value, path) {
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

export function parseContactRouting(value, path) {
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

export const BUILT_IN_THEME_SCHEMES = new Set(['fern', 'lichen', 'cedar', 'tidepool']);

export const THEME_TOKEN_NAMES = new Set([
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

export function parseThemeSchemeId(value, path) {
	const schemeId = expectString(value, path);
	if (!/^[a-z][a-z0-9-]*$/u.test(schemeId)) {
		throw new Error(`Expected ${path} to be a stable lowercase slug.`);
	}
	return schemeId;
}

export function parseThemeTokenOverrides(value, path) {
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

export function parseThemeScheme(value, path) {
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

export function parseTheme(value, path) {
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

export function parseAccessRoles(value, path) {
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
