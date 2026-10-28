import { z } from 'zod';
import { PlatformSchemas, CanonicalJson } from './schemas.js';
import { SeedSchemas } from './seeds.js';
import { CapacitySchemas } from './capacity.js';

class SandboxControlValidation {
  static unique(operations: string[]): boolean {
    return new Set(operations).size === operations.length;
  }
}
/** Portable messages only; private authentication, native lifecycle and host custody belong to Deployment. */
export class SandboxControlSchemas {
  static readonly version = '1.0.0-cordis.1';
  static readonly operation = z.enum([
    'ready',
    'create',
    'inspect',
    'assign',
    'execute',
    'destroy',
  ]);
  static readonly sandboxId = z
    .string()
    .regex(/^sandbox-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  static readonly phase = z.enum(['setup', 'verification']);
  static readonly scope = z.strictObject({
    installationId: SeedSchemas.key,
    serviceId: PlatformSchemas.slot,
    providerGeneration: PlatformSchemas.digest,
    serviceGeneration: PlatformSchemas.digest,
  });
  static readonly grant = z.strictObject({
    schemaVersion: z.literal('treeseed.sandbox-grant/v1'),
    id: SeedSchemas.key,
    revision: CapacitySchemas.revision,
    scope: this.scope,
    state: z.enum(['granted', 'revoked']),
    expiresAtEpochMs: CapacitySchemas.clock,
    operations: z
      .array(this.operation)
      .min(1)
      .max(6)
      .refine(SandboxControlValidation.unique)
      .meta({ uniqueItems: true }),
  });
  static readonly requestCommon = z.strictObject({
    schemaVersion: z.literal('treeseed.sandbox-control/v1'),
    requestId: SeedSchemas.key,
    scope: this.scope,
  });
  static readonly reference = z.strictObject({ sandboxId: this.sandboxId });
  static readonly assignment = z.strictObject({
    sandboxId: this.sandboxId,
    assignmentId: SeedSchemas.key,
    environmentId: SeedSchemas.key,
    environmentDigest: PlatformSchemas.digest,
    environmentRevision: PlatformSchemas.digest,
  });
  static readonly evidence = z.strictObject({
    sandboxId: this.sandboxId,
    inspectionDigest: PlatformSchemas.digest,
    assignment: this.assignment.nullable(),
  });
  static readonly availability = z.strictObject({
    state: z.literal('available'),
    configurationDigest: PlatformSchemas.digest,
    capabilityVersion: z.literal(this.version),
  });
  static readonly receipt = z.strictObject({
    sandboxId: this.sandboxId,
    environmentId: SeedSchemas.key,
    environmentRevision: PlatformSchemas.digest,
    phase: this.phase,
    entrypointDigest: PlatformSchemas.digest,
    networkDigest: PlatformSchemas.digest,
    inspectionDigest: PlatformSchemas.digest,
    exitCode: z.literal(0),
    outputBytes: z
      .number()
      .int()
      .min(0)
      .max(1024 * 1024),
  });
  static readonly destruction = z.strictObject({
    sandboxId: this.sandboxId,
    destroyed: z.literal(true),
    inspectionDigest: PlatformSchemas.digest,
  });
  static readonly request = z.discriminatedUnion('operation', [
    this.requestCommon.extend({ operation: z.literal('ready'), parameters: z.strictObject({}) }),
    this.requestCommon.extend({ operation: z.literal('create'), parameters: this.reference }),
    this.requestCommon.extend({ operation: z.literal('inspect'), parameters: this.reference }),
    this.requestCommon.extend({
      operation: z.literal('assign'),
      parameters: this.reference.extend({
        assignmentId: SeedSchemas.key,
        environmentId: SeedSchemas.key,
      }),
    }),
    this.requestCommon.extend({
      operation: z.literal('execute'),
      parameters: this.reference.extend({ phase: this.phase }),
    }),
    this.requestCommon.extend({ operation: z.literal('destroy'), parameters: this.reference }),
  ]);
  static readonly code = z.enum([
    'INVALID_SANDBOX_CONTROL_CONTRACT',
    'SANDBOX_SCOPE_MISMATCH',
    'SANDBOX_RESPONSE_MISMATCH',
    'SANDBOX_GRANT_EXPIRED',
    'SANDBOX_GRANT_REVOKED',
    'SANDBOX_OPERATION_DENIED',
    'SANDBOX_OPERATION_FAILED',
    'SANDBOX_REPAIR_REQUIRED',
    'SANDBOX_CANCELLED',
    'SANDBOX_CAPACITY_LIMIT',
    'SANDBOX_ENVIRONMENT_INVALID',
    'SANDBOX_RESOURCE_CHANGED',
    'SANDBOX_PROVIDER_UNAVAILABLE',
  ]);
  static readonly accepted = this.requestCommon.extend({
    success: z.literal(true),
    problem: z.null(),
  });
  static readonly response = z.union([
    this.accepted.extend({ operation: z.literal('ready'), result: this.availability }),
    this.accepted.extend({
      operation: z.literal('create'),
      result: this.evidence.extend({ assignment: z.null() }),
    }),
    this.accepted.extend({ operation: z.literal('inspect'), result: this.evidence }),
    this.accepted.extend({ operation: z.literal('assign'), result: this.assignment }),
    this.accepted.extend({ operation: z.literal('execute'), result: this.receipt }),
    this.accepted.extend({ operation: z.literal('destroy'), result: this.destruction }),
    this.requestCommon.extend({
      success: z.literal(false),
      operation: this.operation,
      result: z.null(),
      problem: z.strictObject({ code: this.code }),
    }),
  ]);
}
export type SandboxControlScope = z.infer<typeof SandboxControlSchemas.scope>;
export type SandboxControlGrant = z.infer<typeof SandboxControlSchemas.grant>;
export type SandboxControlRequest = z.infer<typeof SandboxControlSchemas.request>;
export type SandboxControlResponse = z.infer<typeof SandboxControlSchemas.response>;
export type SandboxAvailability = z.infer<typeof SandboxControlSchemas.availability>;
export type SandboxAssignment = z.infer<typeof SandboxControlSchemas.assignment>;
export type SandboxEvidence = z.infer<typeof SandboxControlSchemas.evidence>;
export type SandboxPhaseReceipt = z.infer<typeof SandboxControlSchemas.receipt>;
export type SandboxDestructionReceipt = z.infer<typeof SandboxControlSchemas.destruction>;
export type SandboxControlCode = z.infer<typeof SandboxControlSchemas.code>;
export interface SandboxControlClient {
  ready(signal: AbortSignal): Promise<SandboxAvailability>;
  create(sandboxId: string, signal: AbortSignal): Promise<SandboxEvidence>;
  inspect(sandboxId: string, signal: AbortSignal): Promise<SandboxEvidence>;
  assign(
    sandboxId: string,
    assignmentId: string,
    environmentId: string,
    signal: AbortSignal,
  ): Promise<SandboxAssignment>;
  execute(
    sandboxId: string,
    phase: 'setup' | 'verification',
    signal: AbortSignal,
  ): Promise<SandboxPhaseReceipt>;
  destroy(sandboxId: string, signal: AbortSignal): Promise<SandboxDestructionReceipt>;
}
export class SandboxControlError extends Error {
  constructor(readonly code: SandboxControlCode) {
    super(code);
    this.name = 'SandboxControlError';
  }
}
export class SandboxControlBinding {
  private static parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new SandboxControlError('INVALID_SANDBOX_CONTROL_CONTRACT');
    return parsed.data;
  }
  private static same(actual: unknown, expected: unknown, code: SandboxControlCode): void {
    if (CanonicalJson.stringify(actual) !== CanonicalJson.stringify(expected))
      throw new SandboxControlError(code);
  }
  static assertRequest(input: unknown, trusted: unknown, now: number): SandboxControlRequest {
    const request = this.parse(SandboxControlSchemas.request, input);
    const grant = this.parse(SandboxControlSchemas.grant, trusted);
    this.same(request.scope, grant.scope, 'SANDBOX_SCOPE_MISMATCH');
    if (grant.state !== 'granted') throw new SandboxControlError('SANDBOX_GRANT_REVOKED');
    if (!Number.isSafeInteger(now) || now < 0 || now >= grant.expiresAtEpochMs)
      throw new SandboxControlError('SANDBOX_GRANT_EXPIRED');
    if (!grant.operations.includes(request.operation))
      throw new SandboxControlError('SANDBOX_OPERATION_DENIED');
    return request;
  }
  static assertResponse(input: unknown, trusted: unknown): SandboxControlResponse {
    const response = this.parse(SandboxControlSchemas.response, input);
    const request = this.parse(SandboxControlSchemas.request, trusted);
    this.same(response.scope, request.scope, 'SANDBOX_SCOPE_MISMATCH');
    this.same(response.requestId, request.requestId, 'SANDBOX_RESPONSE_MISMATCH');
    this.same(response.operation, request.operation, 'SANDBOX_RESPONSE_MISMATCH');
    if (response.success) this.result(response, request);
    return response;
  }
  private static result(
    response: Extract<SandboxControlResponse, { success: true }>,
    request: SandboxControlRequest,
  ): void {
    if (request.operation === 'ready') return;
    if (!('sandboxId' in response.result))
      throw new SandboxControlError('SANDBOX_RESPONSE_MISMATCH');
    this.same(response.result.sandboxId, request.parameters.sandboxId, 'SANDBOX_RESPONSE_MISMATCH');
    if (response.operation === 'assign' && request.operation === 'assign')
      this.assignment(response.result, request.parameters);
    if (response.operation === 'execute' && request.operation === 'execute')
      this.same(response.result.phase, request.parameters.phase, 'SANDBOX_RESPONSE_MISMATCH');
    if (response.operation === 'inspect' && response.result.assignment)
      this.same(
        response.result.assignment.sandboxId,
        request.parameters.sandboxId,
        'SANDBOX_RESPONSE_MISMATCH',
      );
  }
  private static assignment(
    actual: SandboxAssignment,
    expected: { sandboxId: string; assignmentId: string; environmentId: string },
  ): void {
    const { sandboxId, assignmentId, environmentId } = actual;
    this.same({ sandboxId, assignmentId, environmentId }, expected, 'SANDBOX_RESPONSE_MISMATCH');
  }
}
