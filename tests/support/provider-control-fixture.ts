import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:https';
import { readFileSync, mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Legacy-shaped contract data and isolated TLS server, never an enrollment authority. */
export class ProviderWireFixtures {
  static readonly timestamp = '2026-10-27T00:00:00.000Z';
  static readonly proof = { protected: 'ZmFrZS1oZWFkZXI', payload: 'ZmFrZS1wYXlsb2Fk', signature: 'ZmFrZS1zaWduYXR1cmU' };
  static readonly supplyOffer = { capabilities: ['fixture.probe'], maxConcurrentRunners: 2 };
  static readonly submission = {
    schemaVersion: 1 as const, displayName: 'contract fixture',
    publicJwk: { kty: 'OKP' as const, crv: 'Ed25519' as const, x: 'a'.repeat(43) },
    proof: this.proof, capabilitySummary: ['fixture.probe'], supplyOffer: this.supplyOffer,
  };
  static readonly registration = {
    id: 'fixture-request', teamId: 'fixture-team', providerId: 'fixture-provider',
    providerFingerprint: 'sha256:' + 'a'.repeat(43), registrationKeyGeneration: 1,
    status: 'pending', capabilitySummary: ['fixture.probe'], supplyOffer: this.supplyOffer,
    expiresAt: '2026-10-28T00:00:00.000Z', createdAt: this.timestamp, updatedAt: this.timestamp,
  };
  static readonly credential = {
    id: 'fixture-credential', membershipId: 'fixture-membership', teamId: 'fixture-team',
    providerId: 'fixture-provider', keyPrefix: 'fixture-prefix', issuanceGeneration: 1,
    status: 'active', scopes: ['provider:availability:write'], createdAt: this.timestamp,
    updatedAt: this.timestamp, credential: 'FIXTURE_CREDENTIAL',
  };
  static readonly token = {
    id: 'fixture-token', membershipId: 'fixture-membership', credentialId: 'fixture-credential',
    status: 'active', scopes: ['provider:availability:write'], issuedAt: this.timestamp,
    expiresAt: '2026-10-27T00:15:00.000Z', teamId: 'fixture-team',
    providerId: 'fixture-provider', accessToken: 'FIXTURE_TOKEN', identityVersion: 1,
  };
}
export class ProviderControlFixture {
  private readonly directory = mkdtempSync(join(tmpdir(), 'cordis-provider-tls-'));
  private server: Server | null = null;
  private count = 0;
  private failure: unknown = null;
  private constructor(private readonly mode: string) {}
  static async open(mode = 'wire'): Promise<ProviderControlFixture> {
    const fixture = new ProviderControlFixture(mode);
    try { await fixture.start(); return fixture; }
    catch (error) { await fixture.close(); throw error; }
  }
  private certificate(): void {
    chmodSync(this.directory, 0o700);
    const result = spawnSync('openssl', ['req', '-x509', '-newkey', 'ed25519', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', join(this.directory, 'key.pem'), '-out', join(this.directory, 'cert.pem')], { stdio: 'ignore', timeout: 10000 });
    assert.equal(result.status, 0, 'isolated TLS fixture requires openssl');
    chmodSync(join(this.directory, 'key.pem'), 0o600);
  }
  private async start(): Promise<void> {
    this.certificate();
    this.server = createServer({ key: readFileSync(join(this.directory, 'key.pem')), cert: readFileSync(join(this.directory, 'cert.pem')) }, this.request.bind(this));
    this.server.listen(0, '127.0.0.1');
    await once(this.server, 'listening');
  }
  private request(request: IncomingMessage, response: ServerResponse): void {
    void this.respond(request, response);
  }
  private async respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString('utf8');
      const data = this.result(request, text ? JSON.parse(text) : undefined);
      response.writeHead(this.mode === 'denied' ? 403 : 200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(this.mode === 'denied' ? { detail: 'SECRET_RESPONSE_CANARY' } : { data }));
    } catch (error) { this.failure = error; response.writeHead(500); response.end('{}'); }
  }
  private result(request: IncomingMessage, body: unknown): unknown {
    if (this.mode === 'denied') return null;
    this.count++;
    if (this.count === 1) return this.register(request, body);
    if (this.count === 2) return this.status(request);
    if (this.count === 3) return this.credential(request, body);
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/v1/provider/access-tokens');
    assert.equal(request.headers.authorization, 'Treeseed-Credential FIXTURE_CREDENTIAL');
    assert.equal(request.headers['idempotency-key'], 'fixture-token');
    assert.deepEqual(body, { credentialId: 'fixture-credential', proof: ProviderWireFixtures.proof });
    return ProviderWireFixtures.token;
  }
  private register(request: IncomingMessage, body: unknown): unknown {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/v1/provider-registrations');
    assert.equal(request.headers.authorization, 'Treeseed-Registration FIXTURE_REGISTRATION');
    assert.equal(request.headers['idempotency-key'], 'fixture-register');
    assert.deepEqual(body, ProviderWireFixtures.submission);
    return ProviderWireFixtures.registration;
  }
  private status(request: IncomingMessage): unknown {
    assert.equal(request.method, 'GET');
    assert.equal(request.url, '/v1/provider-registrations/fixture-request');
    assert.equal(request.headers.authorization, undefined);
    const bytes = Buffer.from(String(request.headers['x-treeseed-provider-proof']), 'base64url');
    assert.deepEqual(JSON.parse(bytes.toString()), ProviderWireFixtures.proof);
    return { ...ProviderWireFixtures.registration, status: 'approved' };
  }
  private credential(request: IncomingMessage, body: unknown): unknown {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/v1/provider-registrations/fixture-request/credential');
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers['idempotency-key'], 'fixture-credential');
    assert.deepEqual(body, { proof: ProviderWireFixtures.proof });
    return ProviderWireFixtures.credential;
  }
  async program(mode: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
    const port = (this.server!.address() as { port: number }).port;
    const child = spawn('node', [resolve('dist/tests/support/provider-control-program.js'), 'https://127.0.0.1:' + port, mode], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_EXTRA_CA_CERTS: join(this.directory, 'cert.pem') }, timeout: 10000 });
    const output: Buffer[] = [], errors: Buffer[] = [];
    child.stdout.on('data', output.push.bind(output));
    child.stderr.on('data', errors.push.bind(errors));
    const [code] = await once(child, 'close');
    return { code, stdout: Buffer.concat(output).toString(), stderr: Buffer.concat(errors).toString() };
  }
  verify(): void { assert.equal(this.failure, null); assert.equal(this.count, 4); }
  async close(): Promise<void> {
    if (this.server?.listening) { this.server.close(); await once(this.server, 'close'); }
    rmSync(this.directory, { recursive: true, force: true });
  }
}
