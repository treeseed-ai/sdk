import type { CompatibilityClassification } from '../contracts.ts';
import type { TypeScriptApiComparison, TypeScriptApiFinding, TypeScriptApiModel, TypeScriptApiSymbol } from './contracts.ts';

const rank: Record<CompatibilityClassification, number> = { unchanged: 0, compatible_addition: 1, breaking: 2 };

function finding(findings: TypeScriptApiFinding[], value: Omit<TypeScriptApiFinding, 'classification'>, classification: CompatibilityClassification) {
	findings.push({ ...value, classification });
}

function compareSymbol(path: string, baseline: TypeScriptApiSymbol, candidate: TypeScriptApiSymbol, findings: TypeScriptApiFinding[]) {
	if (baseline.kind !== candidate.kind) {
		finding(findings, { code: 'typescript_symbol_kind_changed', path, message: `${baseline.kind} changed to ${candidate.kind}.` }, 'breaking');
		return;
	}
	if (!baseline.deprecated && candidate.deprecated) {
		finding(findings, { code: 'typescript_symbol_deprecated', path, message: 'A deprecation marker was added.' }, 'compatible_addition');
	}
	if (baseline.definition !== candidate.definition || baseline.returnType !== candidate.returnType) {
		finding(findings, { code: 'typescript_symbol_type_changed', path, message: 'The public type or return type changed.' }, 'breaking');
	}
	const candidateMembers = new Map(candidate.members.map((entry) => [entry.name, entry]));
	for (const member of baseline.members) {
		const next = candidateMembers.get(member.name);
		if (!next) finding(findings, { code: 'typescript_member_removed', path: `${path}.${member.name}`, message: 'A public member was removed.' }, 'breaking');
		else if (member.type !== next.type || member.optional !== next.optional || member.readonly !== next.readonly) {
			finding(findings, { code: 'typescript_member_changed', path: `${path}.${member.name}`, message: 'A public member contract changed.' }, 'breaking');
		} else if (!member.deprecated && next.deprecated) {
			finding(findings, { code: 'typescript_member_deprecated', path: `${path}.${member.name}`, message: 'A member deprecation marker was added.' }, 'compatible_addition');
		}
	}
	const baselineMembers = new Set(baseline.members.map((entry) => entry.name));
	for (const member of candidate.members.filter((entry) => !baselineMembers.has(entry.name))) {
		finding(findings, { code: 'typescript_member_added', path: `${path}.${member.name}`, message: 'A public member was added.' }, member.optional ? 'compatible_addition' : 'breaking');
	}
	const baselineParameters = baseline.parameters;
	const candidateParameters = candidate.parameters;
	for (let index = 0; index < Math.max(baselineParameters.length, candidateParameters.length); index += 1) {
		const previous = baselineParameters[index];
		const next = candidateParameters[index];
		if (!previous && next) finding(findings, { code: 'typescript_parameter_added', path: `${path}.parameters[${index}]`, message: 'A parameter was added.' }, next.optional ? 'compatible_addition' : 'breaking');
		else if (previous && !next) finding(findings, { code: 'typescript_parameter_removed', path: `${path}.parameters[${index}]`, message: 'A parameter was removed.' }, 'breaking');
		else if (previous && next && (previous.type !== next.type || previous.optional !== next.optional || previous.rest !== next.rest)) {
			finding(findings, { code: 'typescript_parameter_changed', path: `${path}.parameters[${index}]`, message: 'A parameter contract changed.' }, 'breaking');
		}
	}
}

export function compareTypeScriptApi(baseline: TypeScriptApiModel, candidate: TypeScriptApiModel): TypeScriptApiComparison {
	const findings: TypeScriptApiFinding[] = [];
	const candidateEntrypoints = new Map(candidate.entrypoints.map((entry) => [entry.specifier, entry]));
	for (const entrypoint of baseline.entrypoints) {
		const nextEntrypoint = candidateEntrypoints.get(entrypoint.specifier);
		if (!nextEntrypoint) {
			finding(findings, { code: 'typescript_entrypoint_removed', path: entrypoint.specifier, message: 'A public entrypoint was removed.' }, 'breaking');
			continue;
		}
		const nextSymbols = new Map(nextEntrypoint.symbols.map((entry) => [entry.name, entry]));
		for (const previous of entrypoint.symbols) {
			const next = nextSymbols.get(previous.name);
			if (!next) finding(findings, { code: 'typescript_symbol_removed', path: `${entrypoint.specifier}.${previous.name}`, message: 'A public symbol was removed.' }, 'breaking');
			else compareSymbol(`${entrypoint.specifier}.${previous.name}`, previous, next, findings);
		}
		const previousNames = new Set(entrypoint.symbols.map((entry) => entry.name));
		for (const next of nextEntrypoint.symbols.filter((entry) => !previousNames.has(entry.name))) {
			finding(findings, { code: 'typescript_symbol_added', path: `${entrypoint.specifier}.${next.name}`, message: 'A public symbol was added.' }, 'compatible_addition');
		}
	}
	const baselineEntrypoints = new Set(baseline.entrypoints.map((entry) => entry.specifier));
	for (const entrypoint of candidate.entrypoints.filter((entry) => !baselineEntrypoints.has(entry.specifier))) {
		finding(findings, { code: 'typescript_entrypoint_added', path: entrypoint.specifier, message: 'A public entrypoint was added.' }, 'compatible_addition');
	}
	findings.sort((left, right) => `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`));
	const classification = findings.reduce<CompatibilityClassification>((current, entry) => rank[entry.classification] > rank[current] ? entry.classification : current, 'unchanged');
	return { classification, findings };
}
