import { test, expect } from 'bun:test';
import * as sdk from '@treeseed-cordis/sdk';
import { ActivityFixtures } from '../support/activity-contract-program.js';

interface Binding {
  resolve(definition: unknown, capabilities: unknown): unknown[];
}

class ActivityBindingTests {
  private readonly binding = Reflect.get(sdk, 'ActivityContractBinding') as Binding;

  graph(): void {
    const other = {
      ...ActivityFixtures.profile,
      id: 'fixture.other',
      dependsOn: [ActivityFixtures.profile.id],
    };
    const definition = {
      ...ActivityFixtures.definition,
      profiles: [other, ActivityFixtures.profile],
    };
    expect(this.binding.resolve(definition, [ActivityFixtures.capability])).toHaveLength(2);
  }

  safeErrors(): void {
    try {
      this.binding.resolve({ credential: 'secret-output-canary' }, []);
      throw new Error('unexpected acceptance');
    } catch (error) {
      expect((error as Error).message).toBe('INVALID_ACTIVITY_CONTRACT');
      expect(JSON.stringify(error)).not.toContain('secret-output-canary');
    }
  }
}

const suite = new ActivityBindingTests();
test(
  'unit: activity dependency admission accepts declaration order independent of execution order',
  suite.graph.bind(suite),
);
test(
  'unit: activity contract failures cannot disclose supplied credentials',
  suite.safeErrors.bind(suite),
);
