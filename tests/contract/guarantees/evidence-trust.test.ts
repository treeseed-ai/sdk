import { describe, expect, it } from 'vitest';
import { runUiEvidenceTrustVerifier, validateUiEvidenceTrust } from '../../../src/guarantees/evidence-trust.ts';

describe('published UI evidence trust', () => {
	it('rejects mismatched devices and unasserted runtime failures', () => {
		const diagnostics = validateUiEvidenceTrust({
			requestedDevice: { id: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
			actualDevice: { id: 'desktop', viewport: { width: 1600, height: 900 }, isMobile: false, hasTouch: false },
			consoleErrors: [{ message: 'unexpected' }], networkErrors: [{ status: 500, message: 'HTTP 500' }],
		});
		expect(diagnostics.map((entry) => entry.code)).toEqual([
			'guarantee.scene_device_mismatch', 'guarantee.scene_unexpected_console_error', 'guarantee.scene_unexpected_network_error',
		]);
	});

	it('ships an executable artifact self-check', () => {
		expect(runUiEvidenceTrustVerifier()).toMatchObject({ ok: true, checks: [{ id: 'sdk.ui.evidence-trust', status: 'passed' }] });
	});
});
