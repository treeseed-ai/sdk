import { describe, expect, it } from 'vitest';
import { agentActivityEventSchema, agentActivityQuerySchema, agentForensicPayloadSchema, agentReplayRequestSchema, agentTranscriptPayloadSchema } from '../../../../../src/agent-capacity/validation/agent-lab-forensics-schema.ts';

const activity = {
	id: 'event-1', sequence: 7, sourceEventId: 'source-1', timestamp: '2026-08-12T15:00:00.000Z', teamId: 'team-1', projectId: 'project-1', workdayId: 'workday-1', assignmentId: 'assignment-1', modeRunId: 'mode-1', executionRunId: 'execution-1', agentId: 'agent-1', agentClassId: 'class-1', activityType: 'acting', handlerId: 'handler-1', capacityProviderId: 'provider-1', providerManagerId: 'manager-1', runnerId: 'runner-1', executionProviderId: 'codex', eventType: 'tool.completed', severity: 'info' as const, summary: 'Verification completed.', transcriptRef: 'transcript-1', artifactRefs: [{ id: 'artifact-1' }], contextPackDigest: 'digest', usageDelta: { inputTokens: 25 }, durationMs: 1200, errorCategory: null, recoveryState: null, redactionStatus: 'sanitized', payloadDigest: 'payload-digest',
};

describe('Agent Lab forensic schemas', () => {
	it('validates exact activity and redacted transcript payloads', () => {
		expect(agentActivityEventSchema.parse(activity)).toEqual(activity);
		const transcript = agentTranscriptPayloadSchema.parse({ executionRunId: 'execution-1', redactionStatus: 'sanitized', entries: [{ kind: 'tool', secret: '<redacted>' }], page: { limit: 100, hasMore: false, nextCursor: null } });
		expect(agentForensicPayloadSchema.parse({ contract: 'treeseed.agent-forensic-payload/v1', activity, transcript, diagnostics: [] }).transcript).toEqual(transcript);
	});

	it('coerces bounded query input and rejects ambiguous replay requests', () => {
		expect(agentActivityQuerySchema.parse({ after: '4', limit: '25', severity: 'error,warning' })).toMatchObject({ after: 4, limit: 25 });
		expect(agentReplayRequestSchema.safeParse({ includeDiagnostics: true }).success).toBe(false);
		expect(agentReplayRequestSchema.parse({ at: '2026-08-12T15:00:00.000Z' })).toMatchObject({ includeDiagnostics: false, includePayloads: false });
	});

	it('rejects malformed timestamps, negative durations, and unknown fields', () => {
		expect(agentActivityEventSchema.safeParse({ ...activity, timestamp: 'today' }).success).toBe(false);
		expect(agentActivityEventSchema.safeParse({ ...activity, durationMs: -1 }).success).toBe(false);
		expect(agentActivityEventSchema.safeParse({ ...activity, credential: 'unsafe' }).success).toBe(false);
	});
});
