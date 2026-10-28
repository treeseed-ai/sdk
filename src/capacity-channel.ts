import {
  SandboxControlSchemas,
  SandboxControlError,
  type SandboxControlCode,
} from './sandbox-control.js';
import { z } from 'zod';
import { CanonicalJson } from './schemas.js';
import { SeedSchemas } from './seeds.js';
import { CapacitySchemas, CapacityContractError, type CapacityContractCode } from './capacity.js';
import { CapacityProtocolSchemas } from './capacity-protocol.js';
class ChannelShapes {
  static readonly common = {
    schemaVersion: z.literal('treeseed.capacity-channel/v1'),
    requestId: SeedSchemas.key,
    scope: CapacitySchemas.scope,
  };
  static readonly expected = CapacitySchemas.process;
  static readonly role = z.enum(['worker', 'runner']);
  static readonly reply = { ...this.common, generation: CapacitySchemas.process };
  static readonly success = { ...this.reply, success: z.literal(true), problem: z.null() };
  static readonly failure = {
    ...this.reply,
    success: z.literal(false),
    result: z.null(),
    problem: CapacitySchemas.blocker,
  };
  static readonly workerReady = CapacitySchemas.readiness.safeExtend({ role: z.literal('worker') });
  static readonly runnerReady = CapacitySchemas.readiness.safeExtend({ role: z.literal('runner') });
}
/** Portable wire data only. Owner transports and kernels establish authentication and live authority. */
export class CapacityChannelSchemas {
  static readonly version = '1.0.0-cordis.1';
  static readonly context = z.strictObject({
    role: ChannelShapes.role,
    scope: CapacitySchemas.scope,
    generation: CapacitySchemas.process,
  });
  static readonly request = z.union([
    z.strictObject({
      ...ChannelShapes.common,
      role: ChannelShapes.role,
      operation: z.literal('ready'),
      expectedGeneration: ChannelShapes.expected.nullable(),
      parameters: z.strictObject({}),
    }),
    z.strictObject({
      ...ChannelShapes.common,
      role: z.literal('worker'),
      operation: z.literal('reserve'),
      expectedGeneration: ChannelShapes.expected,
      parameters: z.strictObject({ request: CapacityProtocolSchemas.reserve }),
    }),
    z.strictObject({
      ...ChannelShapes.common,
      role: z.literal('worker'),
      operation: z.literal('dispatch'),
      expectedGeneration: ChannelShapes.expected,
      parameters: z.strictObject({ request: CapacityProtocolSchemas.dispatch }),
    }),
    z.strictObject({
      ...ChannelShapes.common,
      role: z.literal('runner'),
      operation: z.literal('run'),
      expectedGeneration: ChannelShapes.expected,
      parameters: z.strictObject({ request: CapacityProtocolSchemas.dispatch }),
    }),
    z.strictObject({
      ...ChannelShapes.common,
      role: ChannelShapes.role,
      operation: z.literal('cancel'),
      expectedGeneration: ChannelShapes.expected,
      parameters: z.strictObject({ lease: CapacitySchemas.lease }),
    }),
  ]);
  static readonly response = z.union([
    z.strictObject({
      ...ChannelShapes.success,
      role: z.literal('worker'),
      operation: z.literal('ready'),
      result: ChannelShapes.workerReady,
    }),
    z.strictObject({
      ...ChannelShapes.success,
      role: z.literal('runner'),
      operation: z.literal('ready'),
      result: ChannelShapes.runnerReady,
    }),
    z.strictObject({
      ...ChannelShapes.success,
      role: z.literal('worker'),
      operation: z.literal('reserve'),
      result: CapacityProtocolSchemas.reservation,
    }),
    z.strictObject({
      ...ChannelShapes.success,
      role: z.literal('worker'),
      operation: z.literal('dispatch'),
      result: CapacitySchemas.result,
    }),
    z.strictObject({
      ...ChannelShapes.success,
      role: z.literal('runner'),
      operation: z.literal('run'),
      result: CapacityProtocolSchemas.runnerOutcome,
    }),
    z.strictObject({
      ...ChannelShapes.success,
      role: z.literal('worker'),
      operation: z.literal('cancel'),
      result: CapacitySchemas.result,
    }),
    z.strictObject({
      ...ChannelShapes.success,
      role: z.literal('runner'),
      operation: z.literal('cancel'),
      result: CapacityProtocolSchemas.runnerOutcome,
    }),
    z.strictObject({
      ...ChannelShapes.failure,
      role: z.literal('worker'),
      operation: z.enum(['ready', 'reserve', 'dispatch', 'cancel']),
    }),
    z.strictObject({
      ...ChannelShapes.failure,
      role: z.literal('runner'),
      operation: z.enum(['ready', 'run', 'cancel']),
    }),
  ]);
}
export type CapacityChannelContext = z.infer<typeof CapacityChannelSchemas.context>;
export type CapacityChannelRequest = z.infer<typeof CapacityChannelSchemas.request>;
export type CapacityChannelResponse = z.infer<typeof CapacityChannelSchemas.response>;
export class CapacityChannelBinding {
  private static parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new CapacityContractError('INVALID_CAPACITY_CONTRACT');
    return parsed.data;
  }
  private static same(actual: unknown, expected: unknown, code: CapacityContractCode): void {
    if (CanonicalJson.stringify(actual) !== CanonicalJson.stringify(expected))
      throw new CapacityContractError(code);
  }
  static assertRequest(input: unknown, trusted: unknown): CapacityChannelRequest {
    const request = this.parse(CapacityChannelSchemas.request, input);
    const context = this.parse(CapacityChannelSchemas.context, trusted);
    this.same(request.scope, context.scope, 'CAPACITY_SCOPE_MISMATCH');
    this.same(request.role, context.role, 'CAPACITY_SCOPE_MISMATCH');
    if (request.expectedGeneration !== null)
      this.same(request.expectedGeneration, context.generation, 'STALE_CAPACITY_GENERATION');
    this.parameters(request, context);
    return request;
  }
  private static parameters(
    request: CapacityChannelRequest,
    context: CapacityChannelContext,
  ): void {
    if (request.operation === 'ready') return;
    if (request.operation === 'reserve') {
      this.same(request.parameters.request.scope, context.scope, 'CAPACITY_SCOPE_MISMATCH');
      this.same(
        request.parameters.request.expectedWorker,
        context.generation,
        'STALE_CAPACITY_GENERATION',
      );
      return;
    }
    const lease =
      request.operation === 'cancel' ? request.parameters.lease : request.parameters.request.lease;
    this.same(lease.scope, context.scope, 'CAPACITY_SCOPE_MISMATCH');
    this.same(lease.generations[context.role], context.generation, 'STALE_CAPACITY_GENERATION');
  }
  static assertResponse(input: unknown, trusted: unknown): CapacityChannelResponse {
    const response = this.parse(CapacityChannelSchemas.response, input);
    const request = this.parse(CapacityChannelSchemas.request, trusted);
    this.same(response.scope, request.scope, 'CAPACITY_SCOPE_MISMATCH');
    this.same(response.role, request.role, 'CAPACITY_SCOPE_MISMATCH');
    this.same(response.requestId, request.requestId, 'STALE_CAPACITY_LEASE');
    this.same(response.operation, request.operation, 'STALE_CAPACITY_LEASE');
    if (request.expectedGeneration !== null)
      this.same(response.generation, request.expectedGeneration, 'STALE_CAPACITY_GENERATION');
    this.parameters(request, {
      role: response.role,
      scope: response.scope,
      generation: response.generation,
    });
    if (response.success) this.result(response, request);
    return response;
  }
  private static result(
    response: Extract<CapacityChannelResponse, { success: true }>,
    request: CapacityChannelRequest,
  ): void {
    if (response.operation === 'ready') return this.readiness(response);
    if (response.operation === 'reserve' && request.operation === 'reserve') {
      this.same(response.result.request, request.parameters.request, 'STALE_CAPACITY_LEASE');
      this.same(
        response.result.generations.worker,
        response.generation,
        'STALE_CAPACITY_GENERATION',
      );
      return;
    }
    if (
      response.operation === 'reserve' ||
      request.operation === 'ready' ||
      request.operation === 'reserve'
    )
      throw new CapacityContractError('INVALID_CAPACITY_CONTRACT');
    const expected =
      request.operation === 'cancel' ? request.parameters.lease : request.parameters.request.lease;
    this.same(response.result.lease, expected, 'STALE_CAPACITY_LEASE');
  }
  private static readiness(
    response: Extract<CapacityChannelResponse, { success: true; operation: 'ready' }>,
  ): void {
    this.same(response.result.scope, response.scope, 'CAPACITY_SCOPE_MISMATCH');
    this.same(response.result.role, response.role, 'CAPACITY_SCOPE_MISMATCH');
    this.same(response.result.generation, response.generation, 'STALE_CAPACITY_GENERATION');
  }
}

class RunnerGrantValidation {
  static unique(values: string[]): boolean {
    return new Set(values).size === values.length;
  }
}
/** Logical guest traffic only; trusted host custody and actual session lifecycle stay in Deployment. */
export class SandboxRunnerSchemas {
  static readonly version = '1.0.0-cordis.1';
  static readonly operation = z.enum(['ready', 'run', 'cancel']);
  static readonly frame = z.union([
    CapacityChannelSchemas.request.options[0].extend({ role: z.literal('runner') }),
    CapacityChannelSchemas.request.options[3],
    CapacityChannelSchemas.request.options[4].extend({ role: z.literal('runner') }),
  ]);
  static readonly guestResponse = z.union([
    CapacityChannelSchemas.response.options[1],
    CapacityChannelSchemas.response.options[4],
    CapacityChannelSchemas.response.options[6],
    CapacityChannelSchemas.response.options[8],
  ]);
  static readonly grant = z.strictObject({
    schemaVersion: z.literal('treeseed.sandbox-runner-grant/v1'),
    id: SeedSchemas.key,
    revision: CapacitySchemas.revision,
    scope: SandboxControlSchemas.scope,
    capacityScope: CapacitySchemas.scope,
    state: z.enum(['granted', 'revoked']),
    expiresAtEpochMs: CapacitySchemas.clock,
    operations: z
      .array(this.operation)
      .min(1)
      .max(3)
      .refine(RunnerGrantValidation.unique)
      .meta({ uniqueItems: true }),
  });
  static readonly common = z.strictObject({
    schemaVersion: z.literal('treeseed.sandbox-runner/v1'),
    requestId: SeedSchemas.key,
    scope: SandboxControlSchemas.scope,
    sandboxId: SandboxControlSchemas.sandboxId,
  });
  static readonly request = this.common.extend({ frame: this.frame });
  static readonly response = z.union([
    this.common.extend({ success: z.literal(true), result: this.guestResponse, problem: z.null() }),
    this.common.extend({
      success: z.literal(false),
      result: z.null(),
      problem: z.strictObject({ code: SandboxControlSchemas.code }),
    }),
  ]);
}
export type SandboxRunnerGrant = z.infer<typeof SandboxRunnerSchemas.grant>;
export type SandboxRunnerRequest = z.infer<typeof SandboxRunnerSchemas.request>;
export type SandboxRunnerResponse = z.infer<typeof SandboxRunnerSchemas.response>;
export interface SandboxRunnerClient {
  exchange(request: SandboxRunnerRequest, signal: AbortSignal): Promise<SandboxRunnerResponse>;
}
export class SandboxRunnerBinding {
  private static parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new SandboxControlError('INVALID_SANDBOX_CONTROL_CONTRACT');
    return parsed.data;
  }
  private static same(actual: unknown, expected: unknown, code: SandboxControlCode): void {
    if (CanonicalJson.stringify(actual) !== CanonicalJson.stringify(expected))
      throw new SandboxControlError(code);
  }
  static assertGrant(input: unknown, trusted: unknown, now: number): SandboxRunnerRequest {
    const request = this.parse(SandboxRunnerSchemas.request, input);
    const grant = this.parse(SandboxRunnerSchemas.grant, trusted);
    this.same(request.scope, grant.scope, 'SANDBOX_SCOPE_MISMATCH');
    this.same(request.frame.scope, grant.capacityScope, 'SANDBOX_SCOPE_MISMATCH');
    this.identities(request);
    if (grant.state !== 'granted') throw new SandboxControlError('SANDBOX_GRANT_REVOKED');
    if (!Number.isSafeInteger(now) || now < 0 || now >= grant.expiresAtEpochMs)
      throw new SandboxControlError('SANDBOX_GRANT_EXPIRED');
    if (!grant.operations.includes(request.frame.operation))
      throw new SandboxControlError('SANDBOX_OPERATION_DENIED');
    if (
      request.frame.operation !== 'ready' &&
      this.lease(request).expiresAtEpochMs > grant.expiresAtEpochMs
    )
      throw new SandboxControlError('SANDBOX_GRANT_EXPIRED');
    return request;
  }
  static assertRequest(
    input: unknown,
    trusted: unknown,
    generation: unknown,
    now: number,
  ): SandboxRunnerRequest {
    const request = this.assertGrant(input, trusted, now);
    CapacityChannelBinding.assertRequest(request.frame, {
      role: 'runner',
      scope: request.frame.scope,
      generation,
    });
    return request;
  }
  private static identities(request: SandboxRunnerRequest): void {
    this.same(
      request.scope.installationId,
      request.frame.scope.installationId,
      'SANDBOX_SCOPE_MISMATCH',
    );
    this.same(request.requestId, request.frame.requestId, 'SANDBOX_RESPONSE_MISMATCH');
    if (request.frame.operation !== 'ready')
      this.same(this.lease(request).sandboxId, request.sandboxId, 'SANDBOX_SCOPE_MISMATCH');
  }
  private static lease(request: SandboxRunnerRequest) {
    if (request.frame.operation === 'run') return request.frame.parameters.request.lease;
    if (request.frame.operation === 'cancel') return request.frame.parameters.lease;
    throw new SandboxControlError('INVALID_SANDBOX_CONTROL_CONTRACT');
  }
  static assertResponse(input: unknown, trusted: unknown): SandboxRunnerResponse {
    const response = this.parse(SandboxRunnerSchemas.response, input);
    const request = this.parse(SandboxRunnerSchemas.request, trusted);
    this.identities(request);
    this.same(response.scope, request.scope, 'SANDBOX_SCOPE_MISMATCH');
    this.same(response.requestId, request.requestId, 'SANDBOX_RESPONSE_MISMATCH');
    this.same(response.sandboxId, request.sandboxId, 'SANDBOX_RESPONSE_MISMATCH');
    if (response.success) CapacityChannelBinding.assertResponse(response.result, request.frame);
    return response;
  }
}
