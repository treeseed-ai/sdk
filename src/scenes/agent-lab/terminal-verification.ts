import type { MarketClient } from '../../entrypoints/clients/market-client.ts';
import { verifyCapacityAcceptanceTerminal } from '../../reconcile/capacity/capacity-core/live-acceptance-capacity-terminal.ts';

const TRANSIENT = /fetch failed|timed out|econnreset|econnrefused|socket|temporarily unavailable|http 429|http 5\d\d/iu;

export async function retryAgentLabTerminalVerification<T>(operation: () => Promise<T>, maxAttempts = 5): Promise<T> {
	let lastError: unknown = new Error('Agent Lab terminal verification was not attempted.');
	for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt += 1) {
		try {
			return await operation();
		} catch (error) {
			lastError = error;
			if (!TRANSIENT.test(error instanceof Error ? error.message : String(error)) || attempt === maxAttempts) throw error;
			await new Promise((resolve) => setTimeout(resolve, Math.min(2_000, 200 * (2 ** (attempt - 1)))));
		}
	}
	throw lastError;
}

export function verifyAgentLabTerminal(input: {
	adminClient: MarketClient;
	teamId: string;
	projectId: string;
	assignmentId: string;
}) {
	return retryAgentLabTerminalVerification(() => verifyCapacityAcceptanceTerminal({
		adminClient: input.adminClient,
		config: { teamId: input.teamId, projectId: input.projectId },
		assignmentId: input.assignmentId,
		minimumArtifactCount: 0,
	}));
}
