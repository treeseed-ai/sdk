import {
  ProviderProtocolClient,
  type ProviderRegistration,
  type ProviderCredentialIssue,
} from '@treeseed-cordis/sdk/provider-control';
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
  static readonly proof = {
    protected: 'ZmFrZS1oZWFkZXI',
    payload: 'ZmFrZS1wYXlsb2Fk',
    signature: 'ZmFrZS1zaWduYXR1cmU',
  };
  static readonly supplyOffer = { capabilities: ['fixture.probe'], maxConcurrentRunners: 2 };
  static readonly submission = {
    schemaVersion: 1 as const,
    displayName: 'contract fixture',
    publicJwk: { kty: 'OKP' as const, crv: 'Ed25519' as const, x: 'a'.repeat(43) },
    proof: this.proof,
    capabilitySummary: ['fixture.probe'],
    supplyOffer: this.supplyOffer,
  };
  static readonly registration = {
    id: 'fixture-request',
    teamId: 'fixture-team',
    providerId: 'fixture-provider',
    providerFingerprint: 'sha256:' + 'a'.repeat(43),
    registrationKeyGeneration: 1,
    status: 'pending',
    capabilitySummary: ['fixture.probe'],
    supplyOffer: this.supplyOffer,
    expiresAt: '2026-10-28T00:00:00.000Z',
    createdAt: this.timestamp,
    updatedAt: this.timestamp,
  };
  static readonly credential = {
    id: 'fixture-credential',
    membershipId: 'fixture-membership',
    teamId: 'fixture-team',
    providerId: 'fixture-provider',
    keyPrefix: 'fixture-prefix',
    issuanceGeneration: 1,
    status: 'active' as const,
    scopes: ['provider:availability:write' as const],
    createdAt: this.timestamp,
    updatedAt: this.timestamp,
    credential: 'FIXTURE_CREDENTIAL',
  };
  static readonly token = {
    id: 'fixture-token',
    membershipId: 'fixture-membership',
    credentialId: 'fixture-credential',
    status: 'active' as const,
    scopes: ['provider:availability:write' as const],
    issuedAt: this.timestamp,
    expiresAt: '2026-10-27T00:15:00.000Z',
    teamId: 'fixture-team',
    providerId: 'fixture-provider',
    accessToken: 'FIXTURE_TOKEN',
    identityVersion: 1,
  };
}
export interface ProviderWireResponder {
  result(request: IncomingMessage, body: unknown): unknown;
  verify(): void;
}
export class ProviderControlFixture {
  private readonly directory = mkdtempSync(join(tmpdir(), 'cordis-provider-tls-'));
  private readonly certificateArguments = [
    'req',
    '-x509',
    '-newkey',
    'ed25519',
    '-nodes',
    '-days',
    '1',
    '-subj',
    '/CN=127.0.0.1',
    '-addext',
    'subjectAltName=IP:127.0.0.1',
    '-keyout',
    join(this.directory, 'key.pem'),
    '-out',
    join(this.directory, 'cert.pem'),
  ];
  private server: Server | null = null;
  private count = 0;
  private failure: unknown = null;
  private constructor(
    private readonly mode: string,
    private readonly responder: ProviderWireResponder | null,
  ) {}
  static async open(
    mode = 'wire',
    responder: ProviderWireResponder | null = null,
  ): Promise<ProviderControlFixture> {
    const fixture = new ProviderControlFixture(mode, responder);
    try {
      await fixture.start();
      return fixture;
    } catch (error) {
      await fixture.close();
      throw error;
    }
  }
  private certificate(): void {
    chmodSync(this.directory, 0o700);
    const result = spawnSync('openssl', this.certificateArguments, {
      stdio: 'ignore',
      timeout: 10000,
    });
    assert.equal(result.status, 0, 'isolated TLS fixture requires openssl');
    chmodSync(join(this.directory, 'key.pem'), 0o600);
  }
  private async start(): Promise<void> {
    this.certificate();
    this.server = createServer(
      {
        key: readFileSync(join(this.directory, 'key.pem')),
        cert: readFileSync(join(this.directory, 'cert.pem')),
      },
      this.request.bind(this),
    );
    this.server.listen(0, '127.0.0.1');
    await once(this.server, 'listening');
  }
  private request(request: IncomingMessage, response: ServerResponse): void {
    response.setHeader('content-type', 'application/json');
    if (!['wire', 'denied'].includes(this.mode)) return this.fault(response);
    void this.respond(request, response);
  }
  private fault(response: ServerResponse): void {
    if (this.mode === 'timeout') return;
    if (this.mode === 'redirect') {
      response.writeHead(302, { location: 'https://example.invalid/SECRET_REDIRECT' });
      response.end();
      return;
    }
    const malformed: Record<string, string> = {
      duplicate: '{"data":{},"data":{}}',
      oversize: 'x'.repeat(1024 * 1024 + 1),
      malformed: '{',
    };
    if (malformed[this.mode] !== undefined) {
      response.end(malformed[this.mode]);
      return;
    }
    response.end(
      JSON.stringify({
        data: { ...ProviderWireFixtures.token, credentialId: 'foreign-credential' },
      }),
    );
  }
  private async respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString('utf8');
      const data = this.result(request, text ? JSON.parse(text) : undefined);
      response.writeHead(this.mode === 'denied' ? 403 : 200, {
        'content-type': 'application/json',
      });
      response.end(
        JSON.stringify(this.mode === 'denied' ? { detail: 'SECRET_RESPONSE_CANARY' } : { data }),
      );
    } catch (error) {
      this.failure = error;
      response.writeHead(500);
      response.end('{}');
    }
  }
  private result(request: IncomingMessage, body: unknown): unknown {
    if (this.mode === 'denied') return null;
    if (this.responder) return this.responder.result(request, body);
    this.count++;
    if (this.count === 1) return this.register(request, body);
    if (this.count === 2) return this.status(request);
    if (this.count === 3) return this.credential(request, body);
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/v1/provider/access-tokens');
    assert.equal(request.headers.authorization, 'Treeseed-Credential FIXTURE_CREDENTIAL');
    assert.equal(request.headers['idempotency-key'], 'fixture-token');
    assert.deepEqual(body, {
      credentialId: 'fixture-credential',
      proof: ProviderWireFixtures.proof,
    });
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
  async program(
    mode: string,
    entry = 'dist/tests/support/provider-control-fixture.js',
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    const child = this.launch(mode, entry);
    const output: Buffer[] = [],
      errors: Buffer[] = [];
    child.stdout.on('data', output.push.bind(output));
    child.stderr.on('data', errors.push.bind(errors));
    const [code] = await once(child, 'close');
    return {
      code,
      stdout: Buffer.concat(output).toString(),
      stderr: Buffer.concat(errors).toString(),
    };
  }
  private launch(mode: string, entry: string) {
    const port = (this.server!.address() as { port: number }).port;
    return spawn('node', [resolve(entry), 'https://127.0.0.1:' + port, mode], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_EXTRA_CA_CERTS: join(this.directory, 'cert.pem') },
      timeout: 10000,
    });
  }
  verify(): void {
    assert.equal(this.failure, null);
    if (this.responder) this.responder.verify();
    else assert.equal(this.count, 4);
  }
  async close(): Promise<void> {
    if (this.server?.listening) {
      this.server.close();
      await once(this.server, 'close');
    }
    rmSync(this.directory, { recursive: true, force: true });
  }
}

class ProviderControlProgram {
  private readonly client = new ProviderProtocolClient({
    baseUrl: process.argv[2]!,
    timeoutMs: process.argv[3] === 'timeout' ? 100 : 10000,
  });
  async run(): Promise<void> {
    if (process.argv[3] === 'denied') return this.denied();
    if (process.argv[3] !== 'wire') return this.fault();
    const registered = await this.enrollment();
    const credential = await this.credential(registered);
    await this.token(registered, credential);
    process.stdout.write('provider-control-ok\n');
  }
  private async enrollment(): Promise<ProviderRegistration> {
    const registered = await this.client.register(
      'FIXTURE_REGISTRATION',
      ProviderWireFixtures.submission,
      'fixture-register',
      new AbortController().signal,
    );
    assert.equal(registered.status, 'pending');
    assert.equal(registered.teamId, 'fixture-team');
    return registered;
  }
  private async credential(registered: ProviderRegistration): Promise<ProviderCredentialIssue> {
    const status = await this.client.registration(
      registered.id,
      ProviderWireFixtures.proof,
      new AbortController().signal,
    );
    assert.equal(status.status, 'approved');
    const credential = await this.client.exchangeCredential(
      registered.id,
      ProviderWireFixtures.proof,
      'fixture-credential',
      new AbortController().signal,
    );
    assert.equal(credential.membershipId, 'fixture-membership');
    return credential;
  }
  private async token(
    registered: ProviderRegistration,
    credential: ProviderCredentialIssue,
  ): Promise<void> {
    const token = await this.client.issueAccessToken(
      credential.credential,
      { credentialId: credential.id, proof: ProviderWireFixtures.proof },
      'fixture-token',
      new AbortController().signal,
    );
    assert.equal(token.teamId, registered.teamId);
    assert.equal(token.providerId, registered.providerId);
    assert.equal(token.credentialId, credential.id);
  }
  private async fault(): Promise<void> {
    const expected: Record<string, string> = {
      duplicate: 'INVALID_PROVIDER_RESPONSE',
      malformed: 'INVALID_PROVIDER_RESPONSE',
      oversize: 'PROVIDER_RESPONSE_LIMIT',
      redirect: 'PROVIDER_TRANSPORT_FAILED',
      'foreign-credential': 'PROVIDER_IDENTITY_MISMATCH',
      timeout: 'PROVIDER_CANCELLED',
    };
    await assert.rejects(
      this.client.issueAccessToken(
        'FIXTURE_CREDENTIAL',
        { credentialId: 'fixture-credential', proof: ProviderWireFixtures.proof },
        'fixture-fault',
        new AbortController().signal,
      ),
      { code: expected[process.argv[3]!] },
    );
    process.stdout.write('provider-control-fault-ok\n');
  }
  private async denied(): Promise<void> {
    try {
      await this.client.issueAccessToken(
        'SECRET_CREDENTIAL_CANARY',
        { credentialId: 'fixture-credential', proof: ProviderWireFixtures.proof },
        'fixture-denial',
        new AbortController().signal,
      );
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
if (import.meta.main) await new ProviderControlProgram().run();
