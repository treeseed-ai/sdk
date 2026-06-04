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

	it('discovers a worktree-scoped Mailpit container from configured name and ports', () => {
		const previousName = process.env.TREESEED_MAILPIT_CONTAINER_NAME;
		const previousSmtpPort = process.env.TREESEED_MAILPIT_SMTP_PORT;
		const previousUiPort = process.env.TREESEED_MAILPIT_UI_PORT;
		try {
			process.env.TREESEED_MAILPIT_CONTAINER_NAME = 'treeseed-mailpit-worktree';
			process.env.TREESEED_MAILPIT_SMTP_PORT = '1035';
			process.env.TREESEED_MAILPIT_UI_PORT = '8035';

			const container = findRunningMailpitContainer({
				run() {
					return dockerResult(0, [
						'treeseed_mailpit\taxllent/mailpit:latest\t0.0.0.0:1025->1025/tcp, 0.0.0.0:8025->8025/tcp',
						'treeseed-mailpit-worktree\taxllent/mailpit:latest\t127.0.0.1:1035->1025/tcp, 127.0.0.1:8035->8025/tcp',
					].join('\n'));
				},
			});

			expect(container).toMatchObject({ name: 'treeseed-mailpit-worktree' });
		} finally {
			if (previousName === undefined) delete process.env.TREESEED_MAILPIT_CONTAINER_NAME;
			else process.env.TREESEED_MAILPIT_CONTAINER_NAME = previousName;
			if (previousSmtpPort === undefined) delete process.env.TREESEED_MAILPIT_SMTP_PORT;
			else process.env.TREESEED_MAILPIT_SMTP_PORT = previousSmtpPort;
			if (previousUiPort === undefined) delete process.env.TREESEED_MAILPIT_UI_PORT;
			else process.env.TREESEED_MAILPIT_UI_PORT = previousUiPort;
		}
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
