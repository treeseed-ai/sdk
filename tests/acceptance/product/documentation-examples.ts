import assert from 'node:assert/strict';
import ts from 'typescript';

const label='ACCEPTANCE_SDK_DOCUMENTATION',unknown=Symbol('not-a-literal');
type Literal=string|number|boolean|null|typeof unknown|Literal[]|{[key:string]:Literal};
const object=(value:Literal):value is {[key:string]:Literal}=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));

/** Inspect literal reference examples without executing documentation or trusting
 * prose/metadata as proof of normalization and omission. TypeScript is already
 * a production SDK dependency. Unknown expressions never prove an example. */
function examples(source:string):Array<{[key:string]:Literal}>{
 const observations:Array<{[key:string]:Literal}>=[],bindings=new Map<string,Literal>();
 const literal=(node:ts.Expression):Literal=>{
  if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))return node.text;
  if(ts.isNumericLiteral(node))return Number(node.text);
  if(node.kind===ts.SyntaxKind.TrueKeyword)return true;if(node.kind===ts.SyntaxKind.FalseKeyword)return false;if(node.kind===ts.SyntaxKind.NullKeyword)return null;
  if(ts.isIdentifier(node))return bindings.get(node.text)??unknown;
  if(ts.isParenthesizedExpression(node)||ts.isAsExpression(node)||ts.isSatisfiesExpression(node))return literal(node.expression);
  if(ts.isArrayLiteralExpression(node))return node.elements.map(item=>ts.isSpreadElement(item)?unknown:literal(item));
  if(!ts.isObjectLiteralExpression(node))return unknown;
  const value:{[key:string]:Literal}=Object.create(null);
  for(const property of node.properties){
   if(ts.isSpreadAssignment(property)){const spread=literal(property.expression);if(!object(spread))return unknown;Object.assign(value,spread);continue;}
   if(ts.isShorthandPropertyAssignment(property)){value[property.name.text]=bindings.get(property.name.text)??unknown;continue;}
   if(!ts.isPropertyAssignment(property))return unknown;
   const key=ts.isIdentifier(property.name)||ts.isStringLiteral(property.name)?property.name.text:undefined;if(key===undefined||Object.hasOwn(value,key))return unknown;
   Object.defineProperty(value,key,{value:literal(property.initializer),enumerable:true,configurable:true,writable:true});
  }
  return value;
 };
 for(const match of source.matchAll(/(?:^|\n)(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n\1(?=\n|$)/gu)){
  const language=match[2]!.trim().split(/\s/u)[0];if(!['ts','typescript','js','javascript','json'].includes(language!))continue;
  const text=language==='json'?'('+match[3]+');':match[3]!;
  const syntax=ts.transpileModule(text,{reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022}});
  assert.ok(!syntax.diagnostics?.some(value=>value.category===ts.DiagnosticCategory.Error),label+': Malformed reference example');
  const file=ts.createSourceFile('reference.ts',text,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS);
  const visit=(node:ts.Node)=>{
   if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer)bindings.set(node.name.text,literal(node.initializer));
   if(ts.isObjectLiteralExpression(node)){const value=literal(node);if(object(value))observations.push(value);}
   ts.forEachChild(node,visit);
  };visit(file);
 }
 return observations;
}

export function verifySdkDocumentationExamples(documents:readonly string[]):void{
 assert.ok(Array.isArray(documents)&&documents.length>0&&documents.every(value=>typeof value==='string'&&value.trim()),label+': Visible committed reference pages required');
 const source=documents.join('\n').replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/gmu,'').replace(/<!--[\s\S]*?-->/gu,'');
 const rows=examples(source),selections=rows.map(row=>row.decisionIds).filter((value):value is string[]=>Array.isArray(value)&&value.length>0&&value.every(id=>typeof id==='string'));
 assert.ok(selections.some(input=>{const trimmed=input.map(id=>id.trim());if(new Set(trimmed).size!==trimmed.length||!trimmed.every(id=>/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u.test(id)))return false;
  const normalized=[...trimmed].sort();return JSON.stringify(input)!==JSON.stringify(normalized)&&selections.some(output=>JSON.stringify(output)===JSON.stringify(normalized));
 }),label+': Literal input and exact trimmed case-sensitive sorted outbound selection required');
 for(const planningOnly of [false,true])assert.ok(rows.some(row=>row.planningOnly===planningOnly&&!Object.hasOwn(row,'decisionIds')&&row.schemaVersion==='treeseed.workday-intent/v1'&&Array.isArray(row.projects)&&row.projects.length>0),label+': Omission must preserve both independent planning states');
 const commands=[...source.matchAll(/(?:^|\n)(`{3,}|~{3,})(?:sh|bash|shell|console|text)\s*\n([\s\S]*?)\n\1(?=\n|$)/gu)].flatMap(match=>match[2]!.split('\n'));
 for(const command of ['workdays plan','workdays schedules start'])assert.ok(commands.some(line=>{
  if(!new RegExp('(?:^|\\s)'+command+'(?:\\s|$)','u').test(line)||/^\s*#/u.test(line))return false;
  const ids=[...line.matchAll(/(?:^|\s)--decision(?:=|\s+)([^\s]+)/gu)].flatMap(match=>match[1]!.replace(/^['"]|['"]$/gu,'').split(','));return ids.length>=2&&ids.every(id=>/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u.test(id));
 }),label+': Both generated command descriptors need repeatable/CSV selection examples');
 const prose=source.replace(/(?:^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1(?=\n|$)/gu,' ');
 assert.ok(/\bAPI\b[^.\n]*\b(?:alone|only)\b[^.\n]*\bcomputes?\b[^.\n]*\bintentDigest\b[^.\n]*\bpreflightDigest\b[^.\n]*\b(?:persistence|persisted)\b/iu.test(prose),label+': API-only digest and persistence ownership must be stated');
 assert.ok(/\bSDK\b[^.\n]*\bserializ\w*/iu.test(prose)&&/\bpersisted\s+`?capacityPlanId`?\b/iu.test(prose),label+': Separate SDK serialization and persisted API capacity provenance required');
 for(const field of ['executionPlanId','capacityPlanId','executionInputId','demandSetId']){
  assert.ok(rows.some(row=>Object.hasOwn(row,field)),label+': Every prohibited caller field needs an actual input example');
  assert.ok(new RegExp('(?:caller-authored|caller input)[^.\\n]*\\b'+field+'\\b[^.\\n]*\\b(?:rejected|prohibited|invalid)\\b','iu').test(prose),label+': Each caller-authored field must be explicitly denied');
 }
}
