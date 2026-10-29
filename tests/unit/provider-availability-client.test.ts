import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  ProviderProtocolClient,
  type ProviderControlRequest,
  type ProviderControlTransport,
} from '@treeseed-cordis/sdk/provider-control';
import { ProviderAvailabilityFixture as Fixture } from '../support/provider-availability-program.js';
import type { AvailabilityClient } from '../support/provider-availability-client-program.js';
class AvailabilityTransport implements ProviderControlTransport {
  calls = 0;
  requestValue: ProviderControlRequest | null = null;
  response: unknown = structuredClone(Fixture.session);
  async request(input: ProviderControlRequest): Promise<unknown> {
    this.calls++;
    this.requestValue = input;
    return this.response;
  }
}
class AvailabilityClientSemantics {
  private client(transport: AvailabilityTransport): AvailabilityClient {
    return new ProviderProtocolClient({
      baseUrl: 'https://example.invalid',
      transport,
    }) as unknown as AvailabilityClient;
  }
  async invalid(mode: string): Promise<void> {
    const transport = new AvailabilityTransport(),
      client = this.client(transport);
    const { prior, principal } = this.invalidScope(mode);
    const signal = new AbortController().signal;
    const pending = ['principal', 'header', 'getter'].includes(mode)
      ? client.createAvailabilitySession(
          mode === 'header' ? 'SECRET\nHEADER' : 'TOKEN',
          principal,
          Fixture.create,
          signal,
        )
      : client.refreshAvailabilitySession(
          'TOKEN',
          prior,
          { ...Fixture.create, expectedSequence: mode === 'sequence' ? 2 : 1 },
          signal,
        );
    await assert.rejects(pending, { code: 'INVALID_PROVIDER_REQUEST' });
    assert.equal(transport.calls, 0);
  }
  private invalidScope(mode: string) {
    const prior = structuredClone(Fixture.session);
    const principal = {
      membershipId: prior.membershipId,
      teamId: prior.teamId,
      providerId: prior.providerId,
    };
    if (mode === 'principal') Reflect.set(principal, 'account', 'foreign');
    if (mode === 'getter')
      Object.defineProperty(principal, 'membershipId', { get: this.fault.bind(this) });
    if (mode === 'provider') prior.providerId = 'provider:foreign';
    if (mode === 'expired') prior.status = 'expired';
    return { prior, principal };
  }
  private fault(): never {
    throw new Error('PRIVATE_GETTER_CANARY');
  }
  async closeScope(): Promise<void> {
    const transport = new AvailabilityTransport(),
      client = this.client(transport);
    const prior = structuredClone(Fixture.session);
    prior.providerId = 'provider:foreign';
    await assert.rejects(
      client.closeAvailabilitySession('TOKEN', prior, new AbortController().signal),
      { code: 'INVALID_PROVIDER_REQUEST' },
    );
    assert.equal(transport.calls, 0);
  }
  async snapshot(): Promise<void> {
    const transport = new AvailabilityTransport(),
      client = this.client(transport);
    const input = structuredClone(Fixture.create);
    const prior = Fixture.session;
    const pending = client.createAvailabilitySession(
      'TOKEN',
      { membershipId: prior.membershipId, teamId: prior.teamId, providerId: prior.providerId },
      input,
      new AbortController().signal,
    );
    input.adapters[0]!.runtimeBuild = 'sha256:' + 'e'.repeat(64);
    const result = await pending;
    assert.equal(result.id, prior.id);
    assert.equal(transport.calls, 1);
    assert.deepEqual(JSON.parse(transport.requestValue!.body!), Fixture.create);
  }
  async cancelled(): Promise<void> {
    const transport = new AvailabilityTransport(),
      client = this.client(transport),
      prior = Fixture.session;
    await assert.rejects(
      client.createAvailabilitySession(
        'TOKEN',
        { membershipId: prior.membershipId, teamId: prior.teamId, providerId: prior.providerId },
        Fixture.create,
        AbortSignal.abort(),
      ),
      { code: 'PROVIDER_CANCELLED' },
    );
    assert.equal(transport.calls, 0);
  }
  async closed(): Promise<void> {
    const transport = new AvailabilityTransport(),
      client = this.client(transport),
      prior = structuredClone(Fixture.session);
    prior.status = 'closed';
    Reflect.set(prior, 'closedAt', '2026-10-29T12:00:45.000Z');
    transport.response = prior;
    assert.deepEqual(
      await client.closeAvailabilitySession('TOKEN', prior, new AbortController().signal),
      prior,
    );
    assert.equal(transport.calls, 1);
    assert.equal(transport.requestValue!.body, '{}');
  }
}
const suite = new AvailabilityClientSemantics();
for (const mode of ['principal', 'header', 'getter', 'provider', 'expired', 'sequence'])
  test(
    'unit: availability rejects invalid ' + mode + ' before transport',
    suite.invalid.bind(suite, mode),
  );
test('unit: availability captures request data before caller mutation', suite.snapshot.bind(suite));
test('unit: availability cancellation prevents transport admission', suite.cancelled.bind(suite));
test(
  'unit: explicit repeated close preserves exact identity without a hidden retry',
  suite.closed.bind(suite),
);
test(
  'unit: availability close refuses mismatched conformance provider before transport',
  suite.closeScope.bind(suite),
);
