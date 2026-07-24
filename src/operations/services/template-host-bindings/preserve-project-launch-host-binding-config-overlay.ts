import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
	TEMPLATE_CONFIG_MERGE_STRATEGIES,
	TEMPLATE_CONFIG_WRITE_TARGETS,
	type ProjectEnvironmentName,
	type TemplateConfigMergeStrategy,
	type TemplateConfigWriteTarget,
	type TemplateSecretTarget,
	type TemplateSecretSensitivity,
} from '../../../entrypoints/models/sdk-types.ts';
import type {
	ProjectLaunchConfigWritePlanItem,
	ProjectLaunchResolvedHostBinding,
	ProjectLaunchSecretDeploymentPlanItem,
} from '../../../entrypoints/templates/template-launch-requirements.ts';
import { ApplyProjectLaunchHostBindingConfigOptions, assertTarget, getPath, hasPath, parseStructuredContent, safePathSegments, setDotPath, stringifyStructuredContent } from './mutable-record.ts';

export function preserveProjectLaunchHostBindingConfigOverlay(options: {
	target: TemplateConfigWriteTarget;
	currentContent: string;
	nextContent: string;
	hostBindingPlans?: ApplyProjectLaunchHostBindingConfigOptions['hostBindingPlans'];
}) {
	assertTarget(options.target);
	const configWrites = options.hostBindingPlans?.configWrites ?? [];
	const shouldPreserveConfigWrites = configWrites.some((write) => write.target === options.target);
	const shouldPreserveEnvironmentEntries = options.target === 'src/env.yaml';
	if (!shouldPreserveConfigWrites && !shouldPreserveEnvironmentEntries) {
		return options.nextContent;
	}

	const currentDocument = parseStructuredContent(options.currentContent, options.target);
	const nextDocument = parseStructuredContent(options.nextContent, options.target);

	for (const write of configWrites) {
		if (write.target !== options.target) continue;
		safePathSegments(write.path);
		if (!hasPath(currentDocument, write.path)) continue;
		setDotPath(nextDocument, write.path, getPath(currentDocument, write.path), 'replace');
	}

	if (options.target === 'src/env.yaml') {
		const currentEntries = currentDocument.entries && typeof currentDocument.entries === 'object' && !Array.isArray(currentDocument.entries)
			? currentDocument.entries as Record<string, unknown>
			: {};
		nextDocument.entries = nextDocument.entries && typeof nextDocument.entries === 'object' && !Array.isArray(nextDocument.entries)
			? nextDocument.entries
			: {};
		for (const [entryId, entry] of Object.entries(currentEntries)) {
			if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
			if (typeof (entry as Record<string, unknown>).sourceRequirement !== 'string') continue;
			nextDocument.entries[entryId] = entry;
		}
	}

	return stringifyStructuredContent(nextDocument, options.target);
}
