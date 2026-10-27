import { test, expect } from 'bun:test';
import {
  AgentContractBinding,
  AgentContractError,
  AgentSchemas,
  ContractProjection,
  type AgentExecutionRequest,
  type AgentAuthorityBinding,
} from '../../src/contracts.js';
class AgentContractTests {
  private readonly generation = 'a'.repeat(64);
  private authority(): AgentAuthorityBinding {
    return {
      scopeId: 'installation:fixture:agent',
      principalId: 'subject:fixture',
      resourceScope: 'resource:fixture',
      grantId: 'grant:fixture',
      grantRevision: 1,
      state: 'granted',
    };
  }
  private request(): AgentExecutionRequest {
    return {
      protocol: 1,
      operation: 'composition-probe',
      executionId: 'execution:one',
      scopeId: 'installation:fixture:agent',
      principalId: 'subject:fixture',
      resourceScope: 'resource:fixture',
      grantId: 'grant:fixture',
      grantRevision: 1,
      expectedGeneration: this.generation,
      handlerId: 'fixture.echo',
      text: 'harmless',
    };
  }
  private static readonly invalidRequests = [
    { text: 'x'.repeat(1025) },
    { handlerId: '../escape' },
    { executionId: 'x'.repeat(129) },
    { expectedGeneration: 'mutable' },
    { grantRevision: 0 },
    { grantRevision: Number.MAX_SAFE_INTEGER + 1 },
    { grantRevision: 1.5 },
    { protocol: 2 },
    { operation: 'execute-model' },
  ];
  private static readonly unsupportedFields = [
    { model: 'forbidden' },
    { credentials: 'secret-output-canary' },
    { workId: 'forbidden' },
  ];
  private static readonly invalidCompleted = [
    { cleanup: 'failed' },
    { output: null },
    { credentials: 'secret' },
    { blockers: [{ code: 'AGENT_PROVIDER_FAILURE', message: 'The Agent provider failed.' }] },
  ];
  private static readonly cleanupFailure = {
    state: 'recovery-required',
    output: null,
    cleanup: 'failed',
    blockers: [{ code: 'AGENT_CLEANUP_FAILED', message: 'The Agent execution cleanup failed.' }],
  };

  bindings(): void {
    const request = this.request();
    const accepted = AgentContractBinding.assert(request, this.authority(), this.generation);
    expect(accepted).toEqual(request);
    expect(accepted).not.toBe(request);
    this.identityFields(request);
    this.revocationAndGeneration(request);
  }

  private identityFields(request: AgentExecutionRequest): void {
    for (const field of ['scopeId', 'principalId', 'resourceScope', 'grantId']) {
      const forged = { ...request, [field]: 'other:identity' };
      expect(
        AgentContractBinding.assert.bind(null, forged, this.authority(), this.generation),
      ).toThrow('AGENT_SCOPE_MISMATCH');
    }
    const forged = { ...request, grantRevision: 2 };
    expect(
      AgentContractBinding.assert.bind(null, forged, this.authority(), this.generation),
    ).toThrow('AGENT_SCOPE_MISMATCH');
  }

  private revocationAndGeneration(request: AgentExecutionRequest): void {
    const revoked = { ...this.authority(), state: 'revoked' };
    expect(AgentContractBinding.assert.bind(null, request, revoked, this.generation)).toThrow(
      'AGENT_GRANT_REVOKED',
    );
    expect(
      AgentContractBinding.assert.bind(null, request, this.authority(), 'b'.repeat(64)),
    ).toThrow('STALE_AGENT_GENERATION');
  }

  bounds(): void {
    const request = this.request();
    for (const change of AgentContractTests.unsupportedFields) this.rejectRequest(request, change);
    for (const change of AgentContractTests.invalidRequests) this.rejectRequest(request, change);
    expect(AgentSchemas.request.safeParse({ ...request, text: 'x'.repeat(1024) }).success).toBe(
      true,
    );
    expect(AgentSchemas.request.safeParse({ ...request, text: '' }).success).toBe(true);
    const extra = { ...this.authority(), credential: 'secret' };
    expect(AgentSchemas.authority.safeParse(extra).success).toBe(false);
  }

  private rejectRequest(request: AgentExecutionRequest, change: object): void {
    expect(AgentSchemas.request.safeParse({ ...request, ...change }).success).toBe(false);
  }

  private completed(): object {
    const { operation: _operation, expectedGeneration, text: _text, ...identity } = this.request();
    return {
      ...identity,
      generation: expectedGeneration,
      state: 'completed',
      output: 'harmless',
      blockers: [],
      cleanup: 'disposed',
    };
  }

  results(): void {
    const result = this.completed();
    expect(AgentSchemas.result.safeParse(result).success).toBe(true);
    for (const change of AgentContractTests.invalidCompleted) this.rejectResult(result, change);
    for (const state of ['cancelled', 'blocked', 'recovery-required'])
      this.rejectResult(result, { state });
    expect(
      AgentSchemas.result.safeParse({ ...result, state: 'cancelled', output: null }).success,
    ).toBe(true);
    this.failedCleanup(result);
  }

  private failedCleanup(result: object): void {
    const failure = { ...result, ...AgentContractTests.cleanupFailure };
    expect(AgentSchemas.result.safeParse(failure).success).toBe(true);
    this.rejectResult(failure, { blockers: [] });
    this.rejectResult(failure, { cleanup: 'disposed' });
    this.rejectResult(failure, {
      blockers: [{ code: 'AGENT_CLEANUP_FAILED', message: 'secret-output-canary' }],
    });
  }

  private rejectResult(result: object, change: object): void {
    expect(AgentSchemas.result.safeParse({ ...result, ...change }).success).toBe(false);
  }

  safeErrors(): void {
    for (const request of [
      null,
      { ...this.request(), credentials: 'secret-output-canary' },
      { ...this.request(), text: 'secret-output-canary'.repeat(100) },
    ]) {
      try {
        AgentContractBinding.assert(request, this.authority(), this.generation);
        throw new Error('unexpected acceptance');
      } catch (error) {
        expect(error).toBeInstanceOf(AgentContractError);
        expect((error as Error).message).toBe('INVALID_AGENT_CONTRACT');
        expect(JSON.stringify(error)).not.toContain('secret-output-canary');
      }
    }
    expect(AgentContractBinding.assert.bind(null, this.request(), null, this.generation)).toThrow(
      'INVALID_AGENT_CONTRACT',
    );
    expect(
      AgentContractBinding.assert.bind(null, this.request(), this.authority(), 'invalid'),
    ).toThrow('INVALID_AGENT_CONTRACT');
  }
  projection(): void {
    const projection = ContractProjection.generate() as {
      contractVersion: string;
      schemas: Record<string, unknown>;
      operations: unknown[];
    };
    expect(projection.contractVersion).toBe('0.7.0-cordis.1');
    for (const name of ['agentAuthority', 'agentExecutionRequest', 'agentExecutionResult'])
      expect(projection.schemas[name]).toBeDefined();
    expect(projection.operations.length).toBe(7);
  }
}
const suite = new AgentContractTests();
test(
  'unit: Agent request binds exact authority revision and generation',
  suite.bindings.bind(suite),
);
test(
  'unit: Agent probe rejects unsupported fields and unbounded identity or payload',
  suite.bounds.bind(suite),
);
test(
  'unit: Agent result cannot claim completion with failed cleanup or unsafe output',
  suite.results.bind(suite),
);
test(
  'unit: Agent contract errors never expose input or schema diagnostics',
  suite.safeErrors.bind(suite),
);
test('unit: generated Agent contracts preserve the seven operations', suite.projection.bind(suite));
