import { test, expect } from 'bun:test';
import { AgentContractBinding, AgentContractError, AgentSchemas, ContractProjection } from '../../src/contracts.js';
class AgentContractTests {
    private readonly generation = 'a'.repeat(64);
    private authority(): Record<string, unknown> { return { scopeId: 'installation:fixture:agent', principalId: 'subject:fixture', resourceScope: 'resource:fixture', grantId: 'grant:fixture', grantRevision: 1, state: 'granted' }; }
    private request(): Record<string, unknown> { return { protocol: 1, operation: 'composition-probe', executionId: 'execution:one', scopeId: 'installation:fixture:agent', principalId: 'subject:fixture', resourceScope: 'resource:fixture', grantId: 'grant:fixture', grantRevision: 1, expectedGeneration: this.generation, handlerId: 'fixture.echo', text: 'harmless' }; }
    bindings(): void {
        const request = this.request(), accepted = AgentContractBinding.assert(request, this.authority(), this.generation);
        expect(accepted).toEqual(request); expect(accepted).not.toBe(request);
        for (const field of ['scopeId', 'principalId', 'resourceScope', 'grantId']) expect(AgentContractBinding.assert.bind(null, { ...request, [field]: 'other:identity' }, this.authority(), this.generation)).toThrow('AGENT_SCOPE_MISMATCH');
        expect(AgentContractBinding.assert.bind(null, { ...request, grantRevision: 2 }, this.authority(), this.generation)).toThrow('AGENT_SCOPE_MISMATCH');
        expect(AgentContractBinding.assert.bind(null, request, { ...this.authority(), state: 'revoked' }, this.generation)).toThrow('AGENT_GRANT_REVOKED');
        expect(AgentContractBinding.assert.bind(null, request, this.authority(), 'b'.repeat(64))).toThrow('STALE_AGENT_GENERATION');
    }
    bounds(): void {
        const request = this.request();
        for (const extra of [{ model: 'forbidden' }, { credentials: 'secret-output-canary' }, { workId: 'forbidden' }]) expect(AgentSchemas.request.safeParse({ ...request, ...extra }).success).toBe(false);
        for (const change of [{ text: 'x'.repeat(1025) }, { handlerId: '../escape' }, { executionId: 'x'.repeat(129) }, { expectedGeneration: 'mutable' }, { grantRevision: 0 }, { grantRevision: Number.MAX_SAFE_INTEGER + 1 }, { grantRevision: 1.5 }, { protocol: 2 }, { operation: 'execute-model' }]) expect(AgentSchemas.request.safeParse({ ...request, ...change }).success).toBe(false);
        expect(AgentSchemas.request.safeParse({ ...request, text: 'x'.repeat(1024) }).success).toBe(true);
        expect(AgentSchemas.request.safeParse({ ...request, text: '' }).success).toBe(true);
        expect(AgentSchemas.authority.safeParse({ ...this.authority(), credential: 'secret' }).success).toBe(false);
    }
    results(): void {
        const { operation: _operation, expectedGeneration, text: _text, ...identity } = this.request();
        const result = { ...identity, generation: expectedGeneration, state: 'completed', output: 'harmless', blockers: [], cleanup: 'disposed' };
        expect(AgentSchemas.result.safeParse(result).success).toBe(true);
        for (const change of [{ cleanup: 'failed' }, { output: null }, { blockers: [{ code: 'AGENT_PROVIDER_FAILURE', message: 'The Agent provider failed.' }] }, { credentials: 'secret' }]) expect(AgentSchemas.result.safeParse({ ...result, ...change }).success).toBe(false);
        for (const state of ['cancelled', 'blocked', 'recovery-required']) expect(AgentSchemas.result.safeParse({ ...result, state }).success).toBe(false);
        expect(AgentSchemas.result.safeParse({ ...result, state: 'cancelled', output: null }).success).toBe(true);
        const failure = { ...result, state: 'recovery-required', output: null, cleanup: 'failed', blockers: [{ code: 'AGENT_CLEANUP_FAILED', message: 'The Agent execution cleanup failed.' }] };
        expect(AgentSchemas.result.safeParse(failure).success).toBe(true);
        expect(AgentSchemas.result.safeParse({ ...failure, blockers: [] }).success).toBe(false);
        expect(AgentSchemas.result.safeParse({ ...failure, cleanup: 'disposed' }).success).toBe(false);
        expect(AgentSchemas.result.safeParse({ ...failure, blockers: [{ code: 'AGENT_CLEANUP_FAILED', message: 'secret-output-canary' }] }).success).toBe(false);
    }
    safeErrors(): void {
        for (const request of [null, { ...this.request(), credentials: 'secret-output-canary' }, { ...this.request(), text: 'secret-output-canary'.repeat(100) }]) {
            try { AgentContractBinding.assert(request, this.authority(), this.generation); throw new Error('unexpected acceptance'); }
            catch (error) { expect(error).toBeInstanceOf(AgentContractError); expect((error as Error).message).toBe('INVALID_AGENT_CONTRACT'); expect(JSON.stringify(error)).not.toContain('secret-output-canary'); }
        }
        expect(AgentContractBinding.assert.bind(null, this.request(), null, this.generation)).toThrow('INVALID_AGENT_CONTRACT');
        expect(AgentContractBinding.assert.bind(null, this.request(), this.authority(), 'invalid')).toThrow('INVALID_AGENT_CONTRACT');
    }
    projection(): void {
        const projection = ContractProjection.generate() as { contractVersion: string; schemas: Record<string, unknown>; operations: unknown[] };
        expect(projection.contractVersion).toBe('0.6.0-cordis.1');
        for (const name of ['agentAuthority', 'agentExecutionRequest', 'agentExecutionResult']) expect(projection.schemas[name]).toBeDefined();
        expect(projection.operations.length).toBe(7);
    }
}
const suite = new AgentContractTests();
test('unit: Agent request binds exact authority revision and generation', suite.bindings.bind(suite));
test('unit: Agent probe rejects unsupported fields and unbounded identity or payload', suite.bounds.bind(suite));
test('unit: Agent result cannot claim completion with failed cleanup or unsafe output', suite.results.bind(suite));
test('unit: Agent contract errors never expose input or schema diagnostics', suite.safeErrors.bind(suite));
test('unit: generated Agent contracts preserve the seven operations', suite.projection.bind(suite));
