import { z } from 'zod';
import { parse, visit, type ParseError } from 'jsonc-parser';
import {
  ProviderControlSchemas as Schemas,
  type ProviderSignedProof,
  type ProviderRegistrationSubmission,
  type ProviderRegistration,
  type ProviderCredentialIssue,
  type ProviderTokenRequest,
  type ProviderTokenIssue,
  ProviderAvailabilitySchemas as Availability,
  type ProviderAvailabilityCreate,
  type ProviderAvailabilityRefresh,
  type ProviderAvailabilitySession,
  type ProviderExecutionAdapter,
} from './provider-control-contracts.js';
import { CanonicalJson } from './schemas.js';
export * from './provider-control-contracts.js';

type ProviderControlCode =
  | 'INVALID_PROVIDER_CONFIGURATION'
  | 'INVALID_PROVIDER_REQUEST'
  | 'INVALID_PROVIDER_RESPONSE'
  | 'PROVIDER_REQUEST_REJECTED'
  | 'PROVIDER_TRANSPORT_FAILED'
  | 'PROVIDER_RESPONSE_LIMIT'
  | 'PROVIDER_CANCELLED'
  | 'PROVIDER_IDENTITY_MISMATCH';
export class ProviderControlError extends Error {
  constructor(
    readonly code: ProviderControlCode,
    readonly status = 0,
  ) {
    super(code);
    this.name = 'ProviderControlError';
  }
}
export interface ProviderControlRequest {
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  headers: Record<string, string>;
  body?: string;
}
export interface ProviderControlTransport {
  request(input: ProviderControlRequest, signal: AbortSignal): Promise<unknown>;
}
class ProviderJsonKeys {
  private readonly stack: Set<string>[] = [];
  private duplicate = false;
  private begin(): void {
    this.stack.push(new Set());
  }
  private property(name: string): void {
    const keys = this.stack[this.stack.length - 1]!;
    if (keys.has(name) || name === '__proto__') this.duplicate = true;
    keys.add(name);
  }
  private end(): void {
    this.stack.pop();
  }
  read(bytes: Uint8Array): unknown {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const errors: ParseError[] = [];
    const options = { disallowComments: true, allowTrailingComma: false };
    visit(
      text,
      {
        onObjectBegin: this.begin.bind(this),
        onObjectProperty: this.property.bind(this),
        onObjectEnd: this.end.bind(this),
      },
      options,
    );
    const result: unknown = parse(text, errors, options);
    if (this.duplicate || errors.length)
      throw new ProviderControlError('INVALID_PROVIDER_RESPONSE');
    return result;
  }
}
class ProviderResponseReader {
  private static readonly envelope = z.strictObject({
    data: z.json(),
    meta: Schemas.metadata.optional(),
    links: z.record(z.string(), z.string()).optional(),
  });
  constructor(private readonly response: Response) {}
  async read(): Promise<unknown> {
    if (
      !this.response.body ||
      !this.response.headers.get('content-type')?.split(';')[0]?.trim().endsWith('/json')
    )
      throw new ProviderControlError('INVALID_PROVIDER_RESPONSE');
    const reader = this.response.body.getReader();
    try {
      const bytes = await this.bytes(reader);
      const decoded = ProviderResponseReader.envelope.safeParse(new ProviderJsonKeys().read(bytes));
      if (!decoded.success) throw new ProviderControlError('INVALID_PROVIDER_RESPONSE');
      return decoded.data.data;
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  }
  private async bytes(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > 1024 * 1024) throw new ProviderControlError('PROVIDER_RESPONSE_LIMIT');
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }
}
export class ProviderFetchTransport implements ProviderControlTransport {
  async request(input: ProviderControlRequest, signal: AbortSignal): Promise<unknown> {
    const response = await fetch(input.url, {
      method: input.method,
      headers: input.headers,
      body: input.body,
      redirect: 'error',
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderControlError('PROVIDER_REQUEST_REJECTED', response.status);
    }
    return new ProviderResponseReader(response).read();
  }
}
export interface ProviderProtocolOptions {
  baseUrl: string;
  timeoutMs?: number;
  transport?: ProviderControlTransport;
}
export interface ProviderAvailabilityPrincipal {
  membershipId: string;
  teamId: string;
  providerId: string;
}
interface AvailabilitySelection {
  adapters: ProviderExecutionAdapter[];
  lanes: Array<{
    id: string;
    purpose: string;
    priority: number;
    reservedConcurrentWorkers: number;
    maxConcurrentWorkers: number;
    capabilities?: string[];
  }>;
}
/** Snapshot data and bind read-back; live membership and signature authority remain server-owned. */
class ProviderAvailabilityBinding {
  private static readonly principal = z.strictObject({
    membershipId: Schemas.key,
    teamId: Schemas.key,
    providerId: Schemas.key,
  });
  private static read<T>(schema: z.ZodType<T>, input: unknown): T {
    try {
      const result = schema.safeParse(input);
      if (result.success) return result.data;
    } catch {}
    throw new ProviderControlError('INVALID_PROVIDER_REQUEST');
  }
  static create(
    inputPrincipal: unknown,
    input: unknown,
  ): { principal: ProviderAvailabilityPrincipal; body: ProviderAvailabilityCreate } {
    const principal = this.read(this.principal, inputPrincipal),
      body = this.read(Availability.create, input);
    this.providers(principal, body);
    return { principal, body };
  }
  static refresh(
    inputPrior: unknown,
    input: unknown,
  ): { prior: ProviderAvailabilitySession; body: ProviderAvailabilityRefresh } {
    const prior = this.read(Availability.session, inputPrior),
      body = this.read(Availability.refresh, input);
    if (prior.status !== 'open' || prior.sequence !== body.expectedSequence)
      throw new ProviderControlError('INVALID_PROVIDER_REQUEST');
    this.providers(prior, body);
    return { prior, body };
  }
  static close(input: unknown): ProviderAvailabilitySession {
    const prior = this.read(Availability.session, input);
    if (prior.status === 'expired') throw new ProviderControlError('INVALID_PROVIDER_REQUEST');
    this.providers(prior, prior.snapshot);
    return prior;
  }
  private static providers(
    principal: ProviderAvailabilityPrincipal,
    selection: AvailabilitySelection,
  ): void {
    for (const adapter of selection.adapters)
      for (const offer of adapter.offers)
        for (const receipt of offer.conformance)
          if (receipt.providerId !== principal.providerId)
            throw new ProviderControlError('INVALID_PROVIDER_REQUEST');
  }
  static accept(
    principal: ProviderAvailabilityPrincipal,
    selection: AvailabilitySelection,
    result: ProviderAvailabilitySession,
    status: 'open' | 'closed',
    sequence: number,
    id?: string,
  ): ProviderAvailabilitySession {
    if (
      result.membershipId !== principal.membershipId ||
      result.teamId !== principal.teamId ||
      result.providerId !== principal.providerId ||
      result.status !== status ||
      result.sequence !== sequence ||
      (id !== undefined && result.id !== id)
    )
      throw new ProviderControlError('PROVIDER_IDENTITY_MISMATCH');
    if (
      CanonicalJson.stringify(this.selection(result.snapshot)) !==
      CanonicalJson.stringify(this.selection(selection))
    )
      throw new ProviderControlError('PROVIDER_IDENTITY_MISMATCH');
    return result;
  }
  private static selection(value: AvailabilitySelection): object {
    return {
      adapters: value.adapters.map(this.adapter).sort(this.order),
      lanes: value.lanes.map(this.lane).sort(this.order),
    };
  }
  private static adapter(value: ProviderExecutionAdapter): { id: string; [key: string]: unknown } {
    return {
      id: value.id,
      adapter: value.adapter,
      runtimeBuild: value.runtimeBuild,
      isolation: value.isolation,
      offers: [...value.offers].sort(ProviderAvailabilityBinding.offerOrder),
      capabilities: [...value.capabilities].sort(),
      laneIds: [...value.laneIds].sort(),
      maxConcurrentWorkers: value.maxConcurrentWorkers,
      nativeLimits: value.nativeLimits,
    };
  }
  private static lane(value: AvailabilitySelection['lanes'][number]): {
    id: string;
    [key: string]: unknown;
  } {
    return {
      id: value.id,
      purpose: value.purpose,
      priority: value.priority,
      reservedConcurrentWorkers: value.reservedConcurrentWorkers,
      maxConcurrentWorkers: value.maxConcurrentWorkers,
      capabilities: [...(value.capabilities ?? [])].sort(),
    };
  }
  private static order(left: { id: string }, right: { id: string }): number {
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  }
  private static offerOrder(left: { offerId: string }, right: { offerId: string }): number {
    return left.offerId < right.offerId ? -1 : left.offerId > right.offerId ? 1 : 0;
  }
}
export class ProviderProtocolClient {
  private readonly origin: string;
  private readonly timeout: number;
  private readonly transport: ProviderControlTransport;
  constructor(options: ProviderProtocolOptions) {
    this.origin = ProviderProtocolClient.origin(options.baseUrl);
    this.timeout = options.timeoutMs ?? 30000;
    if (!Number.isInteger(this.timeout) || this.timeout < 1 || this.timeout > 30000)
      throw new ProviderControlError('INVALID_PROVIDER_CONFIGURATION');
    this.transport = options.transport ?? new ProviderFetchTransport();
  }
  private static origin(input: string): string {
    try {
      const url = new URL(input);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      )
        throw new Error();
      return url.origin;
    } catch {
      throw new ProviderControlError('INVALID_PROVIDER_CONFIGURATION');
    }
  }
  private static input<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) throw new ProviderControlError('INVALID_PROVIDER_REQUEST');
    return result.data;
  }
  private static authorization(kind: string, value: string): Record<string, string> {
    return { authorization: kind + ' ' + ProviderProtocolClient.input(Schemas.secret, value) };
  }
  private static idempotency(key: string): Record<string, string> {
    return { 'idempotency-key': ProviderProtocolClient.input(Schemas.key, key) };
  }
  async register(
    key: string,
    input: ProviderRegistrationSubmission,
    idempotencyKey: string,
    signal: AbortSignal,
  ): Promise<ProviderRegistration> {
    const body = ProviderProtocolClient.input(Schemas.submission, input);
    return this.invoke(
      'POST',
      '/v1/provider-registrations',
      body,
      {
        ...ProviderProtocolClient.authorization('Treeseed-Registration', key),
        ...ProviderProtocolClient.idempotency(idempotencyKey),
      },
      Schemas.registration,
      signal,
    );
  }
  async registration(
    requestId: string,
    proof: ProviderSignedProof,
    signal: AbortSignal,
  ): Promise<ProviderRegistration> {
    const id = ProviderProtocolClient.input(Schemas.key, requestId);
    const value = ProviderProtocolClient.input(Schemas.proof, proof);
    const headers = {
      'x-treeseed-provider-proof': Buffer.from(JSON.stringify(value)).toString('base64url'),
    };
    const result = await this.invoke(
      'GET',
      '/v1/provider-registrations/' + id,
      undefined,
      headers,
      Schemas.registration,
      signal,
    );
    if (result.id !== id) throw new ProviderControlError('PROVIDER_IDENTITY_MISMATCH');
    return result;
  }
  async exchangeCredential(
    requestId: string,
    proof: ProviderSignedProof,
    idempotencyKey: string,
    signal: AbortSignal,
  ): Promise<ProviderCredentialIssue> {
    const id = ProviderProtocolClient.input(Schemas.key, requestId);
    const body = { proof: ProviderProtocolClient.input(Schemas.proof, proof) };
    return this.invoke(
      'POST',
      '/v1/provider-registrations/' + id + '/credential',
      body,
      ProviderProtocolClient.idempotency(idempotencyKey),
      Schemas.credentialIssue,
      signal,
    );
  }
  async issueAccessToken(
    credential: string,
    input: ProviderTokenRequest,
    idempotencyKey: string,
    signal: AbortSignal,
  ): Promise<ProviderTokenIssue> {
    const body = ProviderProtocolClient.input(Schemas.tokenRequest, input);
    const headers = {
      ...ProviderProtocolClient.authorization('Treeseed-Credential', credential),
      ...ProviderProtocolClient.idempotency(idempotencyKey),
    };
    const result = await this.invoke(
      'POST',
      '/v1/provider/access-tokens',
      body,
      headers,
      Schemas.tokenIssue,
      signal,
    );
    if (result.credentialId !== body.credentialId)
      throw new ProviderControlError('PROVIDER_IDENTITY_MISMATCH');
    return result;
  }
  async createAvailabilitySession(
    token: string,
    principal: ProviderAvailabilityPrincipal,
    input: ProviderAvailabilityCreate,
    signal: AbortSignal,
  ): Promise<ProviderAvailabilitySession> {
    const prepared = ProviderAvailabilityBinding.create(principal, input);
    const result = await this.invoke(
      'POST',
      '/v1/provider/availability-sessions',
      prepared.body,
      ProviderProtocolClient.authorization('Bearer', token),
      Availability.session,
      signal,
    );
    return ProviderAvailabilityBinding.accept(prepared.principal, prepared.body, result, 'open', 1);
  }
  async refreshAvailabilitySession(
    token: string,
    prior: ProviderAvailabilitySession,
    input: ProviderAvailabilityRefresh,
    signal: AbortSignal,
  ): Promise<ProviderAvailabilitySession> {
    const prepared = ProviderAvailabilityBinding.refresh(prior, input);
    const result = await this.invoke(
      'PUT',
      '/v1/provider/availability-sessions/' + prepared.prior.id,
      prepared.body,
      ProviderProtocolClient.authorization('Bearer', token),
      Availability.session,
      signal,
    );
    return ProviderAvailabilityBinding.accept(
      prepared.prior,
      prepared.body,
      result,
      'open',
      prepared.prior.sequence + 1,
      prepared.prior.id,
    );
  }
  async closeAvailabilitySession(
    token: string,
    input: ProviderAvailabilitySession,
    signal: AbortSignal,
  ): Promise<ProviderAvailabilitySession> {
    const prior = ProviderAvailabilityBinding.close(input);
    const result = await this.invoke(
      'POST',
      '/v1/provider/availability-sessions/' + prior.id + '/close',
      {},
      ProviderProtocolClient.authorization('Bearer', token),
      Availability.session,
      signal,
    );
    return ProviderAvailabilityBinding.accept(
      prior,
      prior.snapshot,
      result,
      'closed',
      prior.sequence,
      prior.id,
    );
  }
  private async invoke<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body: unknown,
    headers: Record<string, string>,
    schema: z.ZodType<T>,
    parent: AbortSignal,
  ): Promise<T> {
    const signal = AbortSignal.any([parent, AbortSignal.timeout(this.timeout)]);
    try {
      signal.throwIfAborted();
      const request = this.request(method, path, body, headers);
      const input = await this.transport.request(request, signal);
      signal.throwIfAborted();
      const result = schema.safeParse(input);
      if (!result.success) throw new ProviderControlError('INVALID_PROVIDER_RESPONSE');
      return result.data;
    } catch (error) {
      if (signal.aborted) throw new ProviderControlError('PROVIDER_CANCELLED');
      if (error instanceof ProviderControlError)
        throw new ProviderControlError(error.code, error.status);
      throw new ProviderControlError('PROVIDER_TRANSPORT_FAILED');
    }
  }
  private request(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body: unknown,
    headers: Record<string, string>,
  ): ProviderControlRequest {
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    if (encoded && Buffer.byteLength(encoded) > 65536)
      throw new ProviderControlError('INVALID_PROVIDER_REQUEST');
    return {
      method,
      url: this.origin + path,
      headers: { accept: 'application/json', 'content-type': 'application/json', ...headers },
      body: encoded,
    };
  }
}
