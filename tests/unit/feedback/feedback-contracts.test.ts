import { describe, expect, it } from 'vitest';
import { FEEDBACK_CAPTURE_VERSION, FEEDBACK_EXPORT_SCHEMA, FEEDBACK_STATUSES, FEEDBACK_TYPES, isFeedbackStatus, isFeedbackType } from '../../../src/feedback/index.ts';

describe('feedback contracts', () => {
	it('publishes stable submission and lifecycle vocabularies', () => {
		expect(FEEDBACK_TYPES).toEqual(['bug', 'feature_suggestion', 'question', 'content_issue', 'ux_issue']);
		expect(FEEDBACK_STATUSES).toEqual(['new', 'triaged', 'in_progress', 'resolved']);
		expect(isFeedbackType('ux_issue')).toBe(true);
		expect(isFeedbackStatus('closed')).toBe(false);
		expect(FEEDBACK_CAPTURE_VERSION).toBe('treeseed.feedback-capture/v3');
		expect(FEEDBACK_EXPORT_SCHEMA).toBe('treeseed.feedback-export/v1');
	});

});
