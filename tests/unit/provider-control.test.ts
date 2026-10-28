import { expect, test } from 'bun:test';
import {
  ProviderProtocolClient,
  ProviderControlError,
} from '@treeseed-cordis/sdk/provider-control';
import { ProviderControlSchemas } from '@treeseed-cordis/sdk/provider-control-contracts';
import { ProviderWireFixtures as Fixture } from '../support/provider-control-fixture.js';

class ProviderControlContractTests {
  origins(): void {
    for (const baseUrl of [
      'http://127.0.0.1',
      'https://user:password@example.invalid',
      'https://example.invalid/path',
      'https://example.invalid/?secret=canary',
      'https://example.invalid/#fragment',
    ])
      expect(ProviderControlContractTests.construct.bind(null, baseUrl)).toThrow(
        'INVALID_PROVIDER_CONFIGURATION',
      );
  }
  private static construct(baseUrl: string): void {
    new ProviderProtocolClient({ baseUrl });
  }
  contracts(): void {
    expect(ProviderControlSchemas.submission.parse(Fixture.submission)).toEqual(Fixture.submission);
    expect(ProviderControlSchemas.tokenIssue.parse(Fixture.token)).toEqual(Fixture.token);
    expect(
      ProviderControlSchemas.tokenIssue.safeParse({ ...Fixture.token, identityVersion: 0 }).success,
    ).toBe(false);
    expect(
      ProviderControlSchemas.credentialIssue.safeParse({
        ...Fixture.credential,
        scopes: ['agent.probe'],
      }).success,
    ).toBe(false);
    expect(
      ProviderControlSchemas.proof.safeParse({ ...Fixture.proof, privateKey: 'SECRET' }).success,
    ).toBe(false);
  }
  safeErrors(): void {
    const error = new ProviderControlError('PROVIDER_TRANSPORT_FAILED', 0);
    expect(error.message).toBe('PROVIDER_TRANSPORT_FAILED');
    expect(Object.keys(error).sort()).toEqual(['code', 'name', 'status']);
  }
  async invalidInputs(): Promise<void> {
    const client = new ProviderProtocolClient({ baseUrl: 'https://example.invalid' });
    await expect(
      client.registration('../escape', Fixture.proof, new AbortController().signal),
    ).rejects.toThrow('INVALID_PROVIDER_REQUEST');
    await expect(
      client.register(
        'secret\nheader',
        Fixture.submission,
        'fixture-key',
        new AbortController().signal,
      ),
    ).rejects.toThrow('INVALID_PROVIDER_REQUEST');
    await expect(
      client.exchangeCredential('fixture-request', Fixture.proof, '', new AbortController().signal),
    ).rejects.toThrow('INVALID_PROVIDER_REQUEST');
  }
  projection(): void {
    const projected = ProviderControlSchemas.project();
    expect(projected.version).toBe('treeseed.provider-control/v1');
    expect(Object.keys(projected.schemas)).toEqual([
      'submission',
      'registration',
      'credentialIssue',
      'tokenIssue',
    ]);
  }
  validity(): void {
    const request = { credentialId: 'fixture-credential', proof: Fixture.proof };
    for (const requestedValiditySeconds of [60, 900, 604800])
      expect(ProviderControlSchemas.tokenRequest.safeParse({ ...request, requestedValiditySeconds }).success).toBe(true);
    for (const requestedValiditySeconds of [59, 604801, 60.5])
      expect(ProviderControlSchemas.tokenRequest.safeParse({ ...request, requestedValiditySeconds }).success).toBe(false);
  }
  offers(): void {
    for (const change of [{ weight: 0 }, { sharePercent: 101 }, { weight: 1, sharePercent: 50 }, { maxConcurrentRunners: 0 }])
      expect(ProviderControlSchemas.supplyOffer.safeParse({ ...Fixture.supplyOffer, ...change }).success).toBe(false);
  }
}
const suite = new ProviderControlContractTests();
test('unit: provider token validity preserves the existing sixty-second through seven-day contract', suite.validity.bind(suite));
test('unit: provider supply offer preserves existing positive and unambiguous distribution limits', suite.offers.bind(suite));
test(
  'unit: provider enrollment accepts only credential-free HTTPS origins',
  suite.origins.bind(suite),
);
test(
  'unit: existing provider schemas preserve exact native scope and credential identities',
  suite.contracts.bind(suite),
);
test('unit: provider failures have only fixed safe code and status', suite.safeErrors.bind(suite));
test(
  'unit: provider caller inputs reject paths header injection and missing idempotency before transport',
  suite.invalidInputs.bind(suite),
);
test(
  'unit: provider contract has a separate versioned JSON projection',
  suite.projection.bind(suite),
);
