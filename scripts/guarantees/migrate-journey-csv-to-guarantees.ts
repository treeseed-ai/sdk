import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import {
	normalizeGuaranteeTaxonomy,
	slugifyGuaranteeJourney,
} from '../../src/guarantees/index.ts';

function argValue(name: string) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasArg(name: string) {
	return process.argv.includes(name);
}

function parseCsv(source: string) {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	for (let index = 0; index < source.length; index += 1) {
		const char = source[index];
		const next = source[index + 1];
		if (quoted) {
			if (char === '"' && next === '"') {
				field += '"';
				index += 1;
			} else if (char === '"') quoted = false;
			else field += char;
		} else if (char === '"') quoted = true;
		else if (char === ',') {
			row.push(field);
			field = '';
		} else if (char === '\n') {
			row.push(field.replace(/\r$/u, ''));
			rows.push(row);
			row = [];
			field = '';
		} else field += char;
	}
	if (field || row.length > 0) {
		row.push(field.replace(/\r$/u, ''));
		rows.push(row);
	}
	return rows.filter((entry) => entry.some(Boolean));
}

function ownerPackage(type: string, subtype: string) {
	if (['marketplace', 'checkout', 'service', 'capacity-discovery', 'feedback', 'commons', 'public-profile'].includes(type)) return '@treeseed/market';
	if (type === 'marketplace-seller') return '@treeseed/admin';
	if (type === 'host' && subtype === 'reconciliation') return '@treeseed/api';
	if (type === 'capacity' && ['assignment', 'usage', 'provider'].includes(subtype)) return '@treeseed/api';
	if (type === 'project' && subtype === 'treedx') return '@treeseed/api';
	if (type === 'workday' && ['diagnostics', 'artifacts', 'decision'].includes(subtype)) return '@treeseed/api';
	return '@treeseed/admin';
}

function ownerRoot(workspace: string, owner: string) {
	return owner === '@treeseed/market' ? workspace : resolve(workspace, 'packages', owner.replace('@treeseed/', ''));
}

function guaranteeId(type: string, subtype: string, journey: string, index: number) {
	return `guarantee.${type}.${subtype}.${slugifyGuaranteeJourney(journey)}.${String(index).padStart(3, '0')}`;
}

const csv = argValue('--csv');
const workspace = resolve(argValue('--workspace') ?? process.cwd());
const writePlan = argValue('--write-plan');
const write = hasArg('--write');

if (!csv) {
	console.error('Usage: node --import tsx packages/sdk/scripts/migrate-journey-csv-to-guarantees.ts --csv <path> [--workspace <root>] [--write-plan <path>] [--write]');
	process.exit(1);
}

const rows = parseCsv(readFileSync(csv, 'utf8'));
const header = rows[0] ?? [];
const records = rows.slice(1).map((row) => Object.fromEntries(header.map((key, index) => [key, row[index] ?? ''])));
const indexed = new Map(records.map((record) => [Number(record.Index), record]));

const outputs = records.map((record) => {
	const index = Number(record.Index);
	const type = normalizeGuaranteeTaxonomy(String(record.Type));
	const subtype = normalizeGuaranteeTaxonomy(String(record['Sub-Type']));
	const journey = String(record.Journey);
	const owner = ownerPackage(type, subtype);
	const journeySlug = slugifyGuaranteeJourney(journey);
	const dependencies = String(record.Dependencies ?? '').split(/[;, ]+/u).filter(Boolean).map(Number);
	const dependencyGuarantees = dependencies.map((dependency) => {
		const dep = indexed.get(dependency);
		if (!dep) return null;
		return guaranteeId(normalizeGuaranteeTaxonomy(String(dep.Type)), normalizeGuaranteeTaxonomy(String(dep['Sub-Type'])), String(dep.Journey), dependency);
	}).filter(Boolean);
	const packageRoot = ownerRoot(workspace, owner);
	const guaranteePath = resolve(packageRoot, 'guarantees', type, subtype, `${journeySlug}.guarantee.yaml`);
	const manifest = {
		schemaVersion: 'treeseed.guarantee/v1',
		id: guaranteeId(type, subtype, journey, index),
		journeyIndex: index,
		type,
		subtype,
		journey,
		ownerPackage: owner,
		summary: String(record.Notes || `Guarantee migrated from journey ${index}.`),
		status: 'planned',
		dependencies: { journeys: dependencies, guarantees: dependencyGuarantees },
		actors: { allowed: ['owner'], forbidden: ['unauthorized_user'] },
		devices: { required: ['desktop_chromium'] },
		gates: ['core', 'release'],
		preconditions: { fixtures: [] },
		scene: { required: true, manifest: `./scenes/${journeySlug}.scene.yaml` },
		api: { required: true, verifierRefs: [`todo.${type}.${subtype}.${journeySlug}.api`] },
		evidence: { required: ['playwright_trace', 'api_verification_log'] },
		notes: [String(record.Notes || '').trim()].filter(Boolean),
	};
	return { index, type, subtype, journey, ownerPackage: owner, guaranteePath, manifest };
});

const plan = {
	schemaVersion: 'treeseed.guarantee-migration-plan/v1',
	sourceCsv: resolve(csv),
	workspace,
	count: outputs.length,
	outputs: outputs.map(({ manifest, ...entry }) => ({ ...entry, id: manifest.id })),
};

if (writePlan) {
	const target = resolve(writePlan);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, `${JSON.stringify(plan, null, 2)}\n`);
}

if (write) {
	for (const output of outputs) {
		mkdirSync(dirname(output.guaranteePath), { recursive: true });
		writeFileSync(output.guaranteePath, stringifyYaml(output.manifest, { lineWidth: 0 }));
	}
}

console.log(JSON.stringify(plan, null, 2));
