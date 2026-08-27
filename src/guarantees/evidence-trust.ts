import type { GuaranteeDiagnostic, GuaranteeVerifierResult } from './index.ts';

export interface UiEvidenceTrustInput {
	requestedDevice: { id: string; viewport: { width: number; height: number }; isMobile: boolean; hasTouch: boolean };
	actualDevice: { id: string; viewport: { width: number; height: number }; isMobile: boolean; hasTouch: boolean };
	consoleErrors?: Array<{ message: string; asserted?: boolean }>;
	networkErrors?: Array<{ status?: number; message: string; asserted?: boolean }>;
}

export function validateUiEvidenceTrust(input: UiEvidenceTrustInput): GuaranteeDiagnostic[] {
	const diagnostics: GuaranteeDiagnostic[] = [];
	const requested = input.requestedDevice, actual = input.actualDevice;
	if (requested.id !== actual.id || requested.viewport.width !== actual.viewport.width || requested.viewport.height !== actual.viewport.height
		|| requested.isMobile !== actual.isMobile || requested.hasTouch !== actual.hasTouch) {
		diagnostics.push({ severity: 'error', code: 'guarantee.scene_device_mismatch', message: `Requested ${requested.id}, but evidence recorded ${actual.id}.` });
	}
	for (const error of input.consoleErrors ?? []) if (!error.asserted) diagnostics.push({
		severity: 'error', code: 'guarantee.scene_unexpected_console_error', message: error.message,
	});
	for (const error of input.networkErrors ?? []) if (!error.asserted) diagnostics.push({
		severity: 'error', code: 'guarantee.scene_unexpected_network_error', message: error.message,
	});
	return diagnostics;
}

export function runUiEvidenceTrustVerifier(): GuaranteeVerifierResult {
	const startedAt = new Date().toISOString();
	const mismatch = validateUiEvidenceTrust({
		requestedDevice: { id: 'mobile_chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
		actualDevice: { id: 'desktop_chromium', viewport: { width: 1600, height: 900 }, isMobile: false, hasTouch: false },
		consoleErrors: [{ message: 'ReferenceError', asserted: false }], networkErrors: [{ status: 500, message: 'HTTP 500', asserted: false }],
	});
	const required = new Set(['guarantee.scene_device_mismatch', 'guarantee.scene_unexpected_console_error', 'guarantee.scene_unexpected_network_error']);
	const observed = new Set(mismatch.map((entry) => entry.code));
	const ok = [...required].every((code) => observed.has(code));
	return { schemaVersion: 'treeseed.guarantee-verifier-result/v1', verifierId: '@treeseed/sdk/ui-evidence-trust',
		startedAt, completedAt: new Date().toISOString(), ok, checks: [{ id: 'sdk.ui.evidence-trust', status: ok ? 'passed' : 'failed', durationMs: 0,
			diagnostics: ok ? [] : [{ severity: 'error', code: 'guarantee.ui_evidence_trust_incomplete', message: 'UI evidence trust did not reject every invalid vector.' }] }] };
}
