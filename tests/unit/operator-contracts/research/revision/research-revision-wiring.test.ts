import{expect,it}from'vitest';import{readFileSync}from'node:fs';import ts from'typescript';

it('selected SDK product acceptance awaits original research revision proof on complete public assignments and the owning published source repository through supported exact library reads',()=>{
 const source=readFileSync(new URL('../../../../acceptance/golden-product.test.ts',import.meta.url),'utf8'),parsed=ts.createSourceFile('golden-product.test.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),calls:ts.CallExpression[]=[];
 const inspect=(node:ts.Node)=>{if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='verifySdkResearchRevision')calls.push(node);ts.forEachChild(node,inspect);};inspect(parsed);
 expect(calls,'normal SDK acceptance must execute the actual research revision proof once').toHaveLength(1);const call=calls[0];if(!call)return;
 expect(ts.isAwaitExpression(call.parent)).toBe(true);expect(call.arguments.slice(0,4).map(value=>value.getText(parsed))).toEqual(['full','actorAttempt','testRepository','frozenBase']);
 expect(call.arguments[4]?.getText(parsed)).toContain('sdkGoldenLibraryFiles');expect(call.arguments[4]?.getText(parsed)).toContain("'library', 'read'");
 expect(source.indexOf('const testRepository = sdkPublishedRepository')).toBeLessThan(call.getStart(parsed));expect(source.indexOf("read(['assignments', 'show', item.id])")).toBeLessThan(call.getStart(parsed));
 expect(source).not.toMatch(/from ['"].*src\//u);
});
