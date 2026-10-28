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
