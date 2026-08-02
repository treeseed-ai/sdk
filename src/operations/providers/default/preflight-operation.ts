import { resolve } from 'node:path';
import { DEFAULT_STARTER_TEMPLATE_ID } from '../../../entrypoints/models/sdk-types.ts';
import type {
OperationContext
} from '../../operations-types.ts';
import {
listTemplateProducts,
resolveTemplateProduct,
scaffoldTemplateProject,
serializeTemplateRegistryEntry,
syncTemplateProject,
validateTemplateProduct,
} from '../../services/support/template-registry.ts';
import {
collectCliPreflight,
formatCliPreflightReport,
} from '../../services/treedx/workspaces/workspace-preflight.ts';
import { BaseOperation,contextEnv,failureResult,operationResult } from './run-git.ts';

export class PreflightOperation extends BaseOperation<{ requireAuth?: boolean }> {
	constructor(name: string, private readonly requireAuth = false) {
		super(name);
	}

	async execute(input: { requireAuth?: boolean }, context: OperationContext) {
		const report = collectCliPreflight({
			cwd: context.cwd,
			requireAuth: input.requireAuth ?? this.requireAuth,
		});
		const stdout = [formatCliPreflightReport(report)];
		for (const line of stdout) context.write?.(line, 'stdout');
		const ok = report.ok;
		return operationResult(this.metadata, {
			...report,
		}, {
			ok,
			exitCode: ok ? 0 : 1,
			stdout,
			stderr: [],
		});
	}
}

export class InitOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: OperationContext) {
		const directory = String(input.directory ?? input.target ?? '').trim();
		if (!directory) {
			return failureResult(this.metadata, 'Init requires a target directory.');
		}
		const templateId = String(input.template ?? DEFAULT_STARTER_TEMPLATE_ID);
		const writeWarning = (message: string) => context.write?.(message, 'stderr');
		const templateOptions = {
			cwd: context.cwd,
			env: contextEnv(context),
			writeWarning,
		};
		const targetRoot = resolve(context.cwd, directory);
		const projectSlug = typeof input.slug === 'string' && input.slug.trim()
			? input.slug.trim()
			: directory.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
		const projectName = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : directory;
		const siteUrl = typeof input.siteUrl === 'string' ? input.siteUrl : null;
		const definition = await scaffoldTemplateProject(
			templateId,
			targetRoot,
			{
				target: directory,
				name: projectName,
				slug: projectSlug,
				siteUrl,
				contactEmail: typeof input.contactEmail === 'string' ? input.contactEmail : null,
				repositoryUrl: typeof input.repositoryUrl === 'string' ? input.repositoryUrl : typeof input.repo === 'string' ? input.repo : null,
				discordUrl: typeof input.discordUrl === 'string' ? input.discordUrl : typeof input.discord === 'string' ? input.discord : undefined,
			},
			templateOptions,
		);
		return operationResult(this.metadata, {
			directory,
			template: definition.id,
		});
	}
}

export class TemplateOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: OperationContext) {
		const action = String(input.action ?? 'list');
		const target = typeof input.id === 'string' ? input.id : typeof input.target === 'string' ? input.target : undefined;
		const writeWarning = (message: string) => context.write?.(message, 'stderr');
		if (action === 'show') {
			if (!target) {
				return failureResult(this.metadata, 'Template show requires an id.');
			}
			return operationResult(this.metadata, {
				action,
				template: serializeTemplateRegistryEntry(await resolveTemplateProduct(target, { writeWarning })),
			});
		}
		if (action === 'validate') {
			const products = target ? [await resolveTemplateProduct(target, { writeWarning })] : await listTemplateProducts({ writeWarning });
			for (const product of products) {
				await validateTemplateProduct(product, { writeWarning });
			}
			return operationResult(this.metadata, {
				action,
				validated: products.map((product) => product.id),
			});
		}
		return operationResult(this.metadata, {
			action: 'list',
			templates: (await listTemplateProducts({ writeWarning })).map((product) => serializeTemplateRegistryEntry(product)),
		});
	}
}

export class SyncTemplateOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: OperationContext) {
		const changed = await syncTemplateProject(context.cwd, {
			check: input.check === true,
			writeWarning: (message) => context.write?.(message, 'stderr'),
		});
		return operationResult(this.metadata, {
			check: input.check === true,
			changed,
		}, {
			ok: input.check === true ? changed.length === 0 : true,
			exitCode: input.check === true && changed.length > 0 ? 1 : 0,
		});
	}
}
