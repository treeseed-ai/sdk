import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('SDK contribution policy', () => {
	it('does not impose the AGPL commercial-license approval process', () => {
		const root = process.cwd();
		const template = readFileSync(resolve(root, '.github/PULL_REQUEST_TEMPLATE.md'), 'utf8');
		const guidance = readFileSync(resolve(root, 'CONTRIBUTING.md'), 'utf8');
		const historicalMigration = readFileSync(resolve(root, 'drizzle/market/0021_project_contribution_authorizations.sql'), 'utf8');
		const removalMigration = readFileSync(resolve(root, 'drizzle/market/0022_remove_project_contribution_authorizations.sql'), 'utf8');
		expect(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).license).toBe('Apache-2.0');
		expect(existsSync(resolve(root, '.github/workflows/contributor-license.yml'))).toBe(false);
		expect(existsSync(resolve(root, '.github/approved-committers.json'))).toBe(false);
		expect(template).not.toContain('Contribution grant');
		expect(template).not.toContain('contribution-attestation');
		expect(guidance).toContain('does not require a separate contributor-grant checkbox');
		expect(historicalMigration).toContain('CREATE TABLE IF NOT EXISTS "project_contribution_authorizations"');
		expect(removalMigration).toContain('DROP TABLE IF EXISTS "project_contribution_attestation_receipts"');
		expect(removalMigration).toContain('DROP TABLE IF EXISTS "project_contribution_authorizations"');
	});
});
