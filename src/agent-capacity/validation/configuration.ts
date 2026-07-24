import type { AgentActivityProfilesConfiguration } from '../../types/agents.ts';
import type { ProjectAgentClass } from '../contracts/projects/agents/project-agent-class.ts';

export interface CapacityConfigurationDiagnostic { code: string; path: string; message: string }
export interface CapacityConfigurationValidation { ok: boolean; diagnostics: CapacityConfigurationDiagnostic[] }

function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.trim().length > 0) && new Set(value).size === value.length; }

export function validateProjectAgentClassConfiguration(value: unknown): CapacityConfigurationValidation {
	const diagnostics: CapacityConfigurationDiagnostic[] = [];
	const add = (code: string, path: string, message: string) => diagnostics.push({ code, path, message });
	if (!record(value)) return { ok: false, diagnostics: [{ code: 'project_agent_class_configuration_invalid', path: '', message: 'Project agent class configuration must be an object.' }] };
	const allowed = new Set(['id', 'slug', 'name', 'status', 'allowedModes', 'requiredCapabilities', 'kernelProfile', 'kernelPolicy', 'handlerRefs', 'outputContracts', 'metadata']);
	for (const key of Object.keys(value)) if (!allowed.has(key)) add('project_agent_class_configuration_unknown_field', key, `Unknown project agent class field ${key}.`);
	for (const key of ['id', 'slug']) if (typeof value[key] !== 'string' || !String(value[key]).trim()) add('project_agent_class_configuration_field_required', key, `${key} is required.`);
	if (value.name !== undefined && (typeof value.name !== 'string' || !value.name.trim())) add('project_agent_class_configuration_name_invalid', 'name', 'name must be a non-empty string.');
	if (value.status !== undefined && !['active', 'paused', 'archived'].includes(String(value.status))) add('project_agent_class_configuration_status_invalid', 'status', 'status is invalid.');
	if (!strings(value.allowedModes) || value.allowedModes.some((mode) => mode !== 'planning' && mode !== 'acting')) add('project_agent_class_configuration_modes_invalid', 'allowedModes', 'allowedModes must contain unique planning and/or acting values.');
	if (!strings(value.requiredCapabilities)) add('project_agent_class_configuration_capabilities_invalid', 'requiredCapabilities', 'requiredCapabilities must contain unique non-empty strings.');
	for (const key of ['kernelProfile', 'kernelPolicy', 'handlerRefs', 'outputContracts', 'metadata']) if (value[key] !== undefined && !record(value[key])) add('project_agent_class_configuration_object_invalid', key, `${key} must be an object.`);
	return { ok: diagnostics.length === 0, diagnostics };
}

export type ProjectAgentClassConfiguration = Pick<ProjectAgentClass, 'id' | 'slug' | 'name' | 'status' | 'allowedModes' | 'requiredCapabilities' | 'kernelProfile' | 'kernelPolicy' | 'handlerRefs' | 'outputContracts' | 'metadata'>;
export type PortableActivityProfilesConfiguration = AgentActivityProfilesConfiguration;
