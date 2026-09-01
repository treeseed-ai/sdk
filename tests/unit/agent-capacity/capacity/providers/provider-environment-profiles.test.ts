import { describe, expect, it } from 'vitest';
import { assignmentEnvironmentGrantSchema, providerEnvironmentProfileDescriptorSchema, providerRegistrationCodeReceiptSchema } from '../../../../../src/capacity-provider/contracts/index.ts';

const hash = (value: string) => `sha256:${value.repeat(64)}`;

describe('provider environment profile contracts', () => {
	it('keeps provider-local values structurally outside published descriptors', () => {
		const descriptor = { schemaVersion: 'treeseed.provider-environment-profile/v1', id: 'model-access', generation: 2,
			variables: [{ name: 'MODEL_TOKEN', available: true, rotatedAt: '2026-09-01T00:00:00.000Z' }], updatedAt: '2026-09-01T00:00:00.000Z' };
		expect(providerEnvironmentProfileDescriptorSchema.parse(descriptor)).toEqual(descriptor);
		expect(() => providerEnvironmentProfileDescriptorSchema.parse({ ...descriptor, variables: [{ ...descriptor.variables[0], value: 'forbidden' }] })).toThrow();
		expect(() => providerEnvironmentProfileDescriptorSchema.parse({ ...descriptor, variables: [...descriptor.variables, descriptor.variables[0]] })).toThrow(/unique/u);
	});

	it('binds grants to every authority input and jointly constrains network access', () => {
		const grant = { schemaVersion: 'treeseed.assignment-environment-grant/v1', grantId: 'grant-1', assignmentId: 'assignment-1', providerId: 'provider-1', teamId: 'team-1', projectId: 'project-1',
			profileId: 'model-access', variables: ['MODEL_TOKEN'], network: { allowed: false, destinations: [] }, policy: {
				handlerDeclarationDigest: hash('a'), providerOfferDigest: hash('b'), providerPermissionDigest: hash('c'), teamApprovalDigest: hash('d'), assignmentGrantDigest: hash('e'), sandboxPolicyDigest: hash('f'),
			}, issuedAt: '2026-09-01T00:00:00.000Z', expiresAt: '2026-09-01T00:05:00.000Z' };
		expect(assignmentEnvironmentGrantSchema.parse(grant)).toEqual(grant);
		expect(() => assignmentEnvironmentGrantSchema.parse({ ...grant, expiresAt: grant.issuedAt })).toThrow(/expire/u);
		expect(() => assignmentEnvironmentGrantSchema.parse({ ...grant, expiresAt: '2026-09-03T00:00:00.000Z' })).toThrow(/24 hours/u);
		expect(() => assignmentEnvironmentGrantSchema.parse({ ...grant, network: { allowed: false, destinations: ['api.example.test'] } })).toThrow(/Denied network/u);
	});

	it('marks the reusable registration code as credential-like response material', () => {
		expect(providerRegistrationCodeReceiptSchema.parse({ schemaVersion: 'treeseed.provider-registration-code-receipt/v1', teamId: 'team-1', generation: 3,
			codePrefix: 'trsd_reg', registrationCode: 'trsd_reg_0123456789abcdef', rotatedAt: '2026-09-01T00:00:00.000Z' })).toMatchObject({ generation: 3 });
	});
});
