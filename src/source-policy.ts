import ts from 'typescript';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve, relative, dirname, extname, join, isAbsolute, sep } from 'node:path';

class SourceVisitor {
  readonly errors:string[]=[];
  private readonly concrete=new Set<string>();
  private readonly deploymentNamespaces=new Set<string>();
  constructor(readonly file:string,readonly root:string) {}
  visit(node:ts.Node):void {
    if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)&&node.moduleSpecifier.text==='@treeseed-cordis/deployment') {
      const bindings=node.importClause?.namedBindings;
      if(bindings&&ts.isNamedImports(bindings))for(const item of bindings.elements)if((item.propertyName??item.name).text==='ComposeDeploymentHost')this.concrete.add(item.name.text);
      if(bindings&&ts.isNamespaceImport(bindings))this.deploymentNamespaces.add(bindings.name.text);
    }
    if(ts.isNewExpression(node)&&!this.deploymentOwner()&&this.file.replaceAll('\\','/').startsWith('src/')) {
      const expression=node.expression;
      if((ts.isIdentifier(expression)&&this.concrete.has(expression.text))||(ts.isPropertyAccessExpression(expression)&&ts.isIdentifier(expression.expression)&&this.deploymentNamespaces.has(expression.expression.text)&&expression.name.text==='ComposeDeploymentHost'))this.errors.push(`${this.file}: consumers must use the selected Deployment capability`);
    }

    if(ts.isFunctionDeclaration(node)||ts.isArrowFunction(node)||ts.isFunctionExpression(node)||(ts.isMethodDeclaration(node)&&ts.isObjectLiteralExpression(node.parent))) this.errors.push(`${this.file}: behavior must use class methods`);
    if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)) {
      if(node.moduleSpecifier)this.module(node.moduleSpecifier);
    }
    if(ts.isImportEqualsDeclaration(node)&&ts.isExternalModuleReference(node.moduleReference))this.module(node.moduleReference.expression);
    if(ts.isImportTypeNode(node)&&ts.isLiteralTypeNode(node.argument))this.module(node.argument.literal);
    if(ts.isCallExpression(node)&&!this.verifiedImport(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(node.expression)&&node.expression.text==='require')||(ts.isPropertyAccessExpression(node.expression)&&ts.isIdentifier(node.expression.expression)&&node.expression.expression.text==='require'&&node.expression.name.text==='resolve')))this.module(node.arguments[0]);
    ts.forEachChild(node,this.visit.bind(this));
  }
  private deploymentOwner():boolean {try{return (JSON.parse(readFileSync(join(this.root,'package.json'),'utf8')) as {name?:unknown}).name==='@treeseed-cordis/deployment';}catch{return false;}}
  private verifiedImport(node:ts.CallExpression):boolean {
    if(this.file.replaceAll('\\','/')!=='src/runtime.ts'||node.expression.kind!==ts.SyntaxKind.ImportKeyword||node.arguments.length!==1)return false;
    let ownerName:unknown;try{ownerName=(JSON.parse(readFileSync(join(this.root,'package.json'),'utf8')) as {name?:unknown}).name;}catch{return false;}
    const argument=node.arguments[0],method=node.parent.parent;
    return ownerName==='@treeseed-cordis/sdk'&&!!argument&&ts.isPropertyAccessExpression(argument)&&ts.isIdentifier(argument.expression)&&argument.expression.text==='verified'&&argument.name.text==='url'&&ts.isReturnStatement(node.parent)&&ts.isMethodDeclaration(method.parent)&&method.parent.name.getText()==='importVerified'&&ts.isClassDeclaration(method.parent.parent)&&method.parent.parent.name?.text==='InstalledProviderLoader';
  }
  private module(expression:ts.Expression|undefined):void {
    if(!expression||!(ts.isStringLiteral(expression)||ts.isNoSubstitutionTemplateLiteral(expression))) {this.errors.push(`${this.file}: imports require literal owner/package paths`);return;}
    const name=expression.text.replaceAll('\\','/');
    const outside=relative(this.root,resolve(this.root,dirname(this.file),name));
    if(isAbsolute(name)||(/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(name)&&!name.startsWith('node:')&&!name.startsWith('bun:'))||(name.startsWith('.')&&(outside==='..'||outside.startsWith('..'+sep))))this.errors.push(`${this.file}: source import escapes owner`);
  }
}
export class SourcePolicy {
  inspect(file:string,source:string,root=process.cwd()):string[] {
    if(['.js','.jsx','.mjs','.cjs'].includes(extname(file))) return [`${file}: handwritten JavaScript is forbidden`];
    const visitor=new SourceVisitor(file,root);
    visitor.visit(ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS));
    return visitor.errors;
  }
  private files(directory:string,root=directory):string[] {
    const files:string[]=[];
    for(const entry of readdirSync(directory,{withFileTypes:true})) {
      if(directory===root&&['.git','.agents','.codegraph','node_modules','dist','vendor'].includes(entry.name)) continue;
      const file=join(directory,entry.name);
      if(entry.isSymbolicLink()) throw new Error(`Source symlink forbidden: ${file}`);
      if(entry.isDirectory()) files.push(...this.files(file,root));
      else if(/\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/.test(entry.name)) files.push(file);
    }
    return files;
  }
  check(root=process.cwd(),emit=false):void {
    const directory=resolve(root), files=this.files(directory), errors:string[]=[];
    for(const file of files) errors.push(...this.inspect(relative(directory,file),readFileSync(file,'utf8'),directory));
    if(errors.length) throw new Error(errors.join('\n'));
    const options:ts.CompilerOptions={strict:true,noUncheckedIndexedAccess:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,skipLibCheck:true,esModuleInterop:true,declaration:true,noEmit:!emit,noEmitOnError:true,rootDir:directory,outDir:join(directory,'dist'),types:['bun','node'],jsx:ts.JsxEmit.Preserve};
    const program=ts.createProgram(files,options);
    const diagnostics=ts.getPreEmitDiagnostics(program);
    if(diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics,new DiagnosticHost()));
    if(emit) { rmSync(join(directory,'dist'),{recursive:true,force:true});const result=program.emit(); if(result.emitSkipped||result.diagnostics.length) throw new Error('TypeScript emission failed'); }
  }
}
class DiagnosticHost implements ts.FormatDiagnosticsHost {
  getCanonicalFileName(file:string):string {return file;}
  getCurrentDirectory():string {return process.cwd();}
  getNewLine():string {return '\n';}
}
export class ProjectTooling {
  static run():void { new SourcePolicy().check(process.cwd(),process.argv[2]==='build'); }
}

if(import.meta.main)ProjectTooling.run();
