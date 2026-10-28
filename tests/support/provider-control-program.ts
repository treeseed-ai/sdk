import assert from 'node:assert/strict';
import { ProviderProtocolClient } from '@treeseed-cordis/sdk/provider-control';
import { ProviderWireFixtures as Fixture } from './provider-control-fixture.js';

class ProviderControlProgram {
  private readonly client = new ProviderProtocolClient({ baseUrl: process.argv[2]! });
  async run(): Promise<void> {
    if (process.argv[3] === 'denied') return this.denied();
    const registered = await this.client.register('FIXTURE_REGISTRATION', Fixture.submission, 'fixture-register', new AbortController().signal);
    assert.equal(registered.status, 'pending');
    assert.equal(registered.teamId, 'fixture-team');
    const status = await this.client.registration(registered.id, Fixture.proof, new AbortController().signal);
    assert.equal(status.status, 'approved');
    const credential = await this.client.exchangeCredential(registered.id, Fixture.proof, 'fixture-credential', new AbortController().signal);
    assert.equal(credential.membershipId, 'fixture-membership');
    const token = await this.client.issueAccessToken(credential.credential, { credentialId: credential.id, proof: Fixture.proof }, 'fixture-token', new AbortController().signal);
    assert.equal(token.teamId, registered.teamId);
    assert.equal(token.providerId, registered.providerId);
    assert.equal(token.credentialId, credential.id);
    process.stdout.write('provider-control-ok\n');
  }
  private async denied(): Promise<void> {
    try {
      await this.client.issueAccessToken('SECRET_CREDENTIAL_CANARY', { credentialId: 'fixture-credential', proof: Fixture.proof }, 'fixture-denial', new AbortController().signal);
      assert.fail('denied transport must reject');
    } catch (error) {
      assert.equal((error as { code: string }).code, 'PROVIDER_REQUEST_REJECTED');
      assert.equal((error as { status: number }).status, 403);
      assert(!String(error).includes('SECRET'));
      assert(!JSON.stringify(error).includes('SECRET'));
    }
    process.stdout.write('provider-control-denied\n');
  }
}
await new ProviderControlProgram().run();
