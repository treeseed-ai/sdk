import { describe, expect, it } from 'vitest';
import { FEEDBACK_CAPTURE_VERSION, FEEDBACK_EXPORT_SCHEMA, FEEDBACK_STATUSES, FEEDBACK_TYPES, isFeedbackStatus, isFeedbackType } from '../../../src/feedback/index.ts';
import { DEFAULT_PERMISSIONS, DEFAULT_ROLES, principalHasPlatformPermission } from '../../../src/api/auth/rbac.ts';

describe('feedback contracts', () => {
	it('publishes stable submission and lifecycle vocabularies', () => {
		expect(FEEDBACK_TYPES).toEqual(['bug', 'feature_suggestion', 'question', 'content_issue', 'ux_issue']);
		expect(FEEDBACK_STATUSES).toEqual(['new', 'triaged', 'in_progress', 'resolved']);
		expect(isFeedbackType('ux_issue')).toBe(true);
		expect(isFeedbackStatus('closed')).toBe(false);
		expect(FEEDBACK_CAPTURE_VERSION).toBe('treeseed.feedback-capture/v3');
		expect(FEEDBACK_EXPORT_SCHEMA).toBe('treeseed.feedback-export/v1');
	});

	it('defines global feedback permissions without granting non-platform roles', () => {
		const keys = DEFAULT_PERMISSIONS.map((permission) => permission.key);
		expect(keys).toEqual(expect.arrayContaining(['feedback:read:global', 'feedback:manage:global', 'feedback:export:global']));
		for (const role of DEFAULT_ROLES.filter((item) => item.key !== 'platform_admin')) {
			expect(role.permissions.some((permission) => permission.startsWith('feedback:'))).toBe(false);
		}
		expect(DEFAULT_ROLES.find((role) => role.key === 'platform_admin')?.permissions).toContain('*:*:*');
	});

	it('recognizes platform feedback access from canonical role and permission grants', () => {
		expect(principalHasPlatformPermission({ roles: ['platform_admin'] }, 'feedback:read:global')).toBe(true);
		expect(principalHasPlatformPermission({ permissions: ['*:*:*'] }, 'feedback:read:global')).toBe(true);
		expect(principalHasPlatformPermission({ permissions: ['feedback:read:global'] }, 'feedback:read:global')).toBe(true);
		expect(principalHasPlatformPermission({ roles: ['market_admin'] }, 'feedback:read:global')).toBe(false);
	});
});
