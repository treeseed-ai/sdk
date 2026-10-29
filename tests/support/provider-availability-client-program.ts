import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import * as sdk from '@treeseed-cordis/sdk/provider-control';
import { ProviderAvailabilityFixture as Fixture } from './provider-availability-program.js';
import type { ProviderWireResponder } from './provider-control-fixture.js';
type Session = typeof Fixture.session;
export interface AvailabilityClient {
  createAvailabilitySession(
    token: string,
    principal: object,
    input: unknown,
    signal: AbortSignal,
  ): Promise<Session>;
  refreshAvailabilitySession(
    token: string,
    prior: Session,
    input: unknown,
    signal: AbortSignal,
  ): Promise<Session>;
  closeAvailabilitySession(token: string, prior: Session, signal: AbortSignal): Promise<Session>;
}
export class AvailabilityWireResponder implements ProviderWireResponder {
  private count = 0;
  constructor(private readonly mode = 'wire') {}
  result(request: IncomingMessage, body: unknown): unknown {
    this.count++;
    assert.equal(request.headers.authorization, 'Bearer FIXTURE_ACCESS_TOKEN');
    assert.equal(request.headers['idempotency-key'], undefined);
    if (this.mode === 'lost') request.socket.destroy();
    const response = this.selection(request, body);
    this.mutate(response);
    return response;
  }
  private selection(request: IncomingMessage, body: unknown): Session {
    if (this.count === 1) {
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/v1/provider/availability-sessions');
      assert.deepEqual(body, Fixture.create);
      return structuredClone(Fixture.session);
    }
    assert.equal(
      request.url,
      '/v1/provider/availability-sessions/session:fixture' + (this.count === 3 ? '/close' : ''),
    );
    assert.equal(request.method, this.count === 2 ? 'PUT' : 'POST');
    assert.deepEqual(body, this.count === 2 ? { ...Fixture.create, expectedSequence: 1 } : {});
    const session = structuredClone(Fixture.session);
    session.sequence = session.snapshot.sequence = 2;
    if (this.count === 3) {
      session.status = 'closed';
      Reflect.set(session, 'closedAt', '2026-10-29T12:00:45.000Z');
    }
    return session;
  }
  private mutate(session: Session): void {
    if (this.mode === 'foreign-team') session.teamId = 'team:foreign';
    if (this.mode === 'foreign-provider') session.providerId = 'provider:foreign';
    if (this.mode === 'foreign-membership') session.membershipId = 'membership:foreign';
    if (this.mode === 'changed-runtime')
      session.snapshot.adapters[0]!.runtimeBuild = 'sha256:' + 'e'.repeat(64);
    if (this.mode === 'stale' && this.count === 2) session.sequence = session.snapshot.sequence = 1;
    if (this.mode === 'changed-offer')
      session.snapshot.adapters[0]!.offers[0]!.offerDigest = 'sha256:' + 'e'.repeat(64);
    if (this.mode === 'changed-limit')
      Reflect.set(session.snapshot.lanes[0]!, 'maxConcurrentWorkers', 2);
    if (this.mode === 'reordered') {
      session.snapshot.lanes.reverse();
      session.snapshot.adapters[0]!.laneIds.reverse();
    }
  }
  verify(): void {
    assert.equal(
      this.count,
      ['wire', 'reordered'].includes(this.mode) ? 3 : this.mode === 'stale' ? 2 : 1,
    );
  }
}
class AvailabilityClientProgram {
  private readonly client = new sdk.ProviderProtocolClient({
    baseUrl: process.argv[2]!,
    timeoutMs: process.argv[3] === 'timeout' ? 100 : 10000,
  }) as unknown as AvailabilityClient;
  private readonly signal = new AbortController().signal;
  async run(): Promise<void> {
    assert.equal(
      typeof this.client.createAvailabilitySession,
      'function',
      'Public availability lifecycle client missing',
    );
    if (process.argv[3] !== 'wire') return this.failure(process.argv[3]!);
    await this.lifecycle();
    process.stdout.write('provider-availability-client-ok\n');
  }
  private async lifecycle(): Promise<void> {
    const opened = await this.open();
    const refreshed = await this.client.refreshAvailabilitySession(
      'FIXTURE_ACCESS_TOKEN',
      opened,
      { ...Fixture.create, expectedSequence: 1 },
      this.signal,
    );
    assert.equal(refreshed.sequence, 2);
    const closed = await this.client.closeAvailabilitySession(
      'FIXTURE_ACCESS_TOKEN',
      refreshed,
      this.signal,
    );
    assert.equal(closed.id, opened.id);
    assert.equal(closed.status, 'closed');
    assert.equal(closed.sequence, 2);
  }
  private open(): Promise<Session> {
    const { membershipId, teamId, providerId } = Fixture.session;
    return this.client.createAvailabilitySession(
      'FIXTURE_ACCESS_TOKEN',
      { membershipId, teamId, providerId },
      Fixture.create,
      this.signal,
    );
  }
  private async failedOperation(mode: string): Promise<void> {
    const opened = await this.open();
    if (mode === 'stale')
      await this.client.refreshAvailabilitySession(
        'FIXTURE_ACCESS_TOKEN',
        opened,
        { ...Fixture.create, expectedSequence: 1 },
        this.signal,
      );
  }
  private async failure(mode: string): Promise<void> {
    const codes: Record<string, string> = {
      denied: 'PROVIDER_REQUEST_REJECTED',
      timeout: 'PROVIDER_CANCELLED',
      redirect: 'PROVIDER_TRANSPORT_FAILED',
      duplicate: 'INVALID_PROVIDER_RESPONSE',
      malformed: 'INVALID_PROVIDER_RESPONSE',
      oversize: 'PROVIDER_RESPONSE_LIMIT',
      lost: 'PROVIDER_TRANSPORT_FAILED',
    };
    await assert.rejects(this.failedOperation.bind(this, mode), {
      code: codes[mode] ?? 'PROVIDER_IDENTITY_MISMATCH',
    });
    process.stdout.write('provider-availability-client-denied\n');
  }
}
if (import.meta.main) await new AvailabilityClientProgram().run();
