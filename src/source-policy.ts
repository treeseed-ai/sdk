import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative, dirname, extname, join, isAbsolute } from 'node:path';

class SourceVisitor {
  readonly errors:string[]=[];
  constructor(readonly file:string,readonly root:string) {}
  visit(node:ts.Node):void {
    if(ts.isFunctionDeclaration(node)||ts.isArrowFunction(node)||ts.isFunctionExpression(node)||(ts.isMethodDeclaration(node)&&ts.isObjectLiteralExpression(node.parent))) this.errors.push(`${this.file}: behavior must use class methods`);
    if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)) {
      const name=node.moduleSpecifier.text;
      if(isAbsolute(name)||(name.startsWith('.')&&relative(this.root,resolve(this.root,dirname(this.file),name)).startsWith('..'))) this.errors.push(`${this.file}: source import escapes owner`);
    }
    ts.forEachChild(node,this.visit.bind(this));
  }
}
export class SourcePolicy {
  inspect(file:string,source:string,root=process.cwd()):string[] {
    if(['.js','.jsx','.mjs','.cjs'].includes(extname(file))) return [`${file}: handwritten JavaScript is forbidden`];
    const visitor=new SourceVisitor(file,root);
    visitor.visit(ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS));
    return visitor.errors;
  }
  private files(directory:string):string[] {
    const files:string[]=[];
    for(const entry of readdirSync(directory,{withFileTypes:true})) {
      if(['.git','.agents','.codegraph','node_modules','dist','vendor'].includes(entry.name)) continue;
      const file=join(directory,entry.name);
      if(entry.isSymbolicLink()) throw new Error(`Source symlink forbidden: ${file}`);
      if(entry.isDirectory()) files.push(...this.files(file));
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
    if(emit) { const result=program.emit(); if(result.emitSkipped||result.diagnostics.length) throw new Error('TypeScript emission failed'); }
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
