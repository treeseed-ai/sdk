import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'bun:test';
import { CanonicalJson } from '@treeseed-cordis/sdk';
import { ProviderAvailabilityFixture as Fixture } from '../support/provider-availability-program.js';
class ProviderAvailabilityBoundaries {
  projection(): void {
    const generated = JSON.parse(readFileSync('dist/contract.json', 'utf8')) as { schemas: Record<string, object> };
    const schemas = Fixture.schemas().project().schemas;
    for (const [key, name] of [['offer', 'providerCapabilityOffer'], ['create', 'providerAvailabilityCreate'], ['refresh', 'providerAvailabilityRefresh'], ['session', 'providerAvailabilitySession']])
      assert.deepEqual(generated.schemas[name!], schemas[key!]);
  }
  json(): void {
    const schema = Fixture.schemas();
    for (const [name, value] of [['offer', Fixture.offer], ['create', Fixture.create], ['session', Fixture.session]] as const) {
      const decoded = JSON.parse(JSON.stringify(value));
      const parsed = schema[name].parse(decoded);
      assert.equal(CanonicalJson.stringify(parsed), CanonicalJson.stringify(value));
    }
  }
}
const suite = new ProviderAvailabilityBoundaries();
test('integration: generated availability JSON files match public schema projections', suite.projection.bind(suite));
test('integration: provider availability JSON round-trip preserves all signed and identity fields without defaults', suite.json.bind(suite));
