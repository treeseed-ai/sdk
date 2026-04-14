import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
	SdkTemplateCatalogEntry,
	SdkTemplateCatalogResponse,
} from './sdk-types.ts';

export interface RemoteTemplateCatalogClientOptions {
	endpoint: string;
	fetchImpl?: typeof fetch;
}

function expectRecord(value: unknown, label: string) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Invalid template catalog response: expected ${label} to be an object.`);
	}
	return value as Record<string, unknown>;
}

function expectString(value: unknown, label: string) {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`Invalid template catalog response: expected ${label} to be a non-empty string.`);
	}
	return value.trim();
}

function optionalString(value: unknown) {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalStringArray(value: unknown, label: string) {
	if (value === undefined) {
		return undefined;
	}
	if (!Array.isArray(value)) {
		throw new Error(`Invalid template catalog response: expected ${label} to be an array.`);
	}
	return value.map((entry, index) => expectString(entry, `${label}[${index}]`));
}

function optionalBoolean(value: unknown, label: string) {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'boolean') {
		throw new Error(`Invalid template catalog response: expected ${label} to be a boolean.`);
	}
	return value;
}

function expectNumber(value: unknown, label: string) {
	if (typeof value !== 'number' || Number.isNaN(value)) {
		throw new Error(`Invalid template catalog response: expected ${label} to be a number.`);
	}
	return value;
}

function normalizeTemplateCatalogEntry(value: unknown): SdkTemplateCatalogEntry {
	const record = expectRecord(value, 'template entry');
	const publisher = expectRecord(record.publisher, 'publisher');
	const fulfillment = expectRecord(record.fulfillment, 'fulfillment');
	const source = expectRecord(fulfillment.source, 'fulfillment.source');
	const offer = record.offer === undefined ? undefined : expectRecord(record.offer, 'offer');

	return {
		id: expectString(record.id ?? record.slug, 'id'),
		displayName: expectString(record.displayName ?? record.title, 'displayName'),
		description: expectString(record.description, 'description'),
		summary: expectString(record.summary, 'summary'),
		status: expectString(record.status ?? 'draft', 'status') as SdkTemplateCatalogEntry['status'],
		featured: optionalBoolean(record.featured, 'featured'),
		category: expectString(record.category, 'category') as SdkTemplateCatalogEntry['category'],
		audience: optionalStringArray(record.audience, 'audience') ?? [],
		tags: optionalStringArray(record.tags, 'tags') ?? [],
		publisher: {
			id: expectString(publisher.id, 'publisher.id'),
			name: expectString(publisher.name, 'publisher.name'),
			url: optionalString(publisher.url),
		},
		publisherVerified: optionalBoolean(record.publisherVerified, 'publisherVerified'),
		templateVersion: expectString(record.templateVersion, 'templateVersion'),
		templateApiVersion: expectNumber(record.templateApiVersion, 'templateApiVersion'),
		minCliVersion: expectString(record.minCliVersion, 'minCliVersion'),
		minCoreVersion: optionalString(record.minCoreVersion),
		fulfillment: {
			mode: optionalString(fulfillment.mode) as SdkTemplateCatalogEntry['fulfillment']['mode'],
			source: {
				kind: 'git',
				repoUrl: expectString(source.repoUrl, 'fulfillment.source.repoUrl'),
				directory: expectString(source.directory, 'fulfillment.source.directory'),
				ref: expectString(source.ref, 'fulfillment.source.ref'),
				integrity: optionalString(source.integrity),
			},
			hooksPolicy: expectString(fulfillment.hooksPolicy ?? 'builtin_only', 'fulfillment.hooksPolicy') as SdkTemplateCatalogEntry['fulfillment']['hooksPolicy'],
			supportsReconcile: typeof fulfillment.supportsReconcile === 'boolean' ? fulfillment.supportsReconcile : true,
		},
		offer: offer
			? {
				priceModel: optionalString(offer.priceModel) as SdkTemplateCatalogEntry['offer'] extends infer T
					? T extends { priceModel?: infer U } ? U : never
					: never,
				license: optionalString(offer.license),
				support: optionalString(offer.support),
			}
			: undefined,
		relatedBooks: optionalStringArray(record.relatedBooks, 'relatedBooks') ?? [],
		relatedKnowledge: optionalStringArray(record.relatedKnowledge, 'relatedKnowledge') ?? [],
		relatedObjectives: optionalStringArray(record.relatedObjectives, 'relatedObjectives') ?? [],
	};
}

export function parseTemplateCatalogResponse(payload: unknown): SdkTemplateCatalogResponse {
	if (Array.isArray(payload)) {
		return {
			items: payload.map((entry) => normalizeTemplateCatalogEntry(entry)),
			meta: {},
		};
	}

	const record = expectRecord(payload, 'root');
	const envelopePayload = record.payload;
	const items = Array.isArray(record.items)
		? record.items
		: Array.isArray(envelopePayload)
			? envelopePayload
			: Array.isArray(expectRecord(envelopePayload ?? {}, 'payload').items)
				? expectRecord(envelopePayload ?? {}, 'payload').items as unknown[]
				: null;

	if (!items) {
		throw new Error('Invalid template catalog response: expected an item array.');
	}

	return {
		items: items.map((entry) => normalizeTemplateCatalogEntry(entry)),
		meta: typeof record.meta === 'object' && record.meta !== null ? record.meta as Record<string, unknown> : {},
	};
}

async function loadTemplateCatalogPayload(endpoint: string, fetchImpl: typeof fetch) {
	if (endpoint.startsWith('file:')) {
		const filePath = endpoint.startsWith('file://')
			? new URL(endpoint)
			: resolve(process.cwd(), endpoint.slice('file:'.length));
		const raw = readFileSync(filePath, 'utf8');
		return JSON.parse(raw) as unknown;
	}

	const response = await fetchImpl(endpoint, {
		headers: {
			accept: 'application/json',
		},
	});

	if (!response.ok) {
		throw new Error(`Template catalog request failed with ${response.status} ${response.statusText}.`);
	}

	return response.json();
}

export class RemoteTemplateCatalogClient {
	private readonly endpoint: string;
	private readonly fetchImpl: typeof fetch;

	constructor(options: RemoteTemplateCatalogClientOptions) {
		this.endpoint = options.endpoint;
		this.fetchImpl = options.fetchImpl ?? fetch;
	}

	async listTemplates(): Promise<SdkTemplateCatalogResponse> {
		return parseTemplateCatalogResponse(await loadTemplateCatalogPayload(this.endpoint, this.fetchImpl));
	}

	async getTemplate(id: string) {
		const catalog = await this.listTemplates();
		return catalog.items.find((entry) => entry.id === id) ?? null;
	}
}
