import { describe, expect, it } from 'vitest';
import { NOTIFICATION_CONTENT_CAPABILITIES, isValidPersonalThemeDraft, normalizeNotificationPreferences } from '../../../src/account-contracts.ts';
import { defineTreeseedRoute, validateTreeseedRouteCapabilities } from '../../../src/platform/plugin.ts';

describe('account redesign contracts', () => {
	it('normalizes notification preferences as deterministic exact state', () => {
		const result = normalizeNotificationPreferences({
			emailCadence: 'weekly',
			timeZone: 'America/New_York',
			globalContentTypes: ['questions', 'questions', 'not-a-capability'],
			projectOverrides: [{ projectId: 'project-b', contentTypes: ['notes'] }, { projectId: 'project-a', contentTypes: ['decisions'] }],
		});
		expect(result).toEqual({
			emailCadence: 'weekly',
			timeZone: 'America/New_York',
			globalContentTypes: ['questions'],
			projectOverrides: [{ projectId: 'project-a', contentTypes: ['decisions'] }, { projectId: 'project-b', contentTypes: ['notes'] }],
		});
		expect(NOTIFICATION_CONTENT_CAPABILITIES.map((entry) => entry.id)).toEqual(['objectives', 'questions', 'notes', 'proposals', 'decisions', 'agents']);
	});

	it('validates guided personal-theme drafts', () => {
		expect(isValidPersonalThemeDraft({ name: 'Research dusk', baseScheme: 'fern', palette: {
			light: { canvas: '#ffffff', surface: '#f5f5f5', text: '#111111', accent: '#176b45' },
			dark: { canvas: '#101510', surface: '#182018', text: '#f5fff5', accent: '#69d69a' },
		} })).toBe(true);
		expect(isValidPersonalThemeDraft({ name: 'x', baseScheme: 'fern', palette: {} })).toBe(false);
	});

	it('rejects route collisions and incomplete capabilities', () => {
		const capability = { owner: 'admin' as const, id: 'admin.auth.test', responseKind: 'page' as const, archetype: 'auth-form' as const, shell: 'AuthShell', template: 'AuthCard', surface: 'auth' as const, resourceType: 'auth-session', accessPolicy: ['anonymous'], viewModelDependencies: ['Admin auth facade'], navigation: 'hidden' as const, states: ['success' as const], selector: 'auth-test', status: 'active' as const, guarantees: [], description: 'Test route.' };
		const route = defineTreeseedRoute({ pattern: '/auth/test', resourcePath: 'pages/auth/test.astro', capability });
		expect(() => validateTreeseedRouteCapabilities([route, route])).toThrow(/Duplicate TreeSeed route pattern/u);
	});
});
