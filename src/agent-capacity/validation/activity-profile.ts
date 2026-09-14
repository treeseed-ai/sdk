import type { AgentActivityProfile, AgentActivityType } from '../../types/agents.ts';
import { activityProfilesSchema, diagnosticsFromZod } from './agent-definition-schema.ts';

export interface AgentActivityProfileDiagnostic {
	code: string;
	path: string;
	message: string;
}

export interface AgentActivityProfileValidation {
	ok: boolean;
	diagnostics: AgentActivityProfileDiagnostic[];
}

export function validateAgentActivityProfilesConfiguration(value: unknown): AgentActivityProfileValidation {
	const parsed = activityProfilesSchema.safeParse(value);
	return parsed.success
		? { ok: true, diagnostics: [] }
		: { ok: false, diagnostics: diagnosticsFromZod(parsed.error, 'activityProfiles') };
}

export type ValidAgentActivityProfilesConfiguration = Partial<Record<AgentActivityType, AgentActivityProfile>>;
