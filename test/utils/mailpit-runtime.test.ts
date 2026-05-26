import { describe, expect, it } from 'vitest';
import {
	findRunningMailpitContainer,
	stopKnownMailpitContainers,
} from '../../src/operations/services/mailpit-runtime.ts';

type DockerCall = { args: string[] };

function dockerResult(status: number, stdout = '', stderr = '') {
	return { status, stdout, stderr } as never;
}

describe('Mailpit runtime helpers', () => {
	it('discovers the running Treeseed Mailpit container', () => {
		const calls: DockerCall[] = [];
		const container = findRunningMailpitContainer({
			run(args) {
				calls.push({ args });
				return dockerResult(0, [
					'postgres\tpostgres:16\t127.0.0.1:55432->5432/tcp',
					'treeseed_mailpit\taxllent/mailpit:latest\t0.0.0.0:1025->1025/tcp, 0.0.0.0:8025->8025/tcp',
				].join('\n'));
			},
		});

		expect(calls).toEqual([{ args: ['ps', '--format', '{{.Names}}\t{{.Image}}\t{{.Ports}}'] }]);
		expect(container).toMatchObject({ name: 'treeseed_mailpit' });
	});

	it('removes stopped and running Mailpit containers so reset clears the inbox', () => {
		const calls: DockerCall[] = [];
		const ok = stopKnownMailpitContainers({
			run(args) {
				calls.push({ args });
				if (args[0] === 'ps') {
					return dockerResult(0, [
						'treeseed_mailpit\taxllent/mailpit:latest\t0.0.0.0:1025->1025/tcp, 0.0.0.0:8025->8025/tcp',
						'docs_mailpit\taxllent/mailpit:latest\t0.0.0.0:1025->1025/tcp, 0.0.0.0:8025->8025/tcp',
					].join('\n'));
				}
				return dockerResult(0);
			},
		});

		expect(ok).toBe(true);
		expect(calls).toEqual([
			{ args: ['ps', '-a', '--format', '{{.Names}}\t{{.Image}}\t{{.Ports}}'] },
			{ args: ['rm', '-f', 'treeseed_mailpit'] },
			{ args: ['rm', '-f', 'docs_mailpit'] },
		]);
	});
});
