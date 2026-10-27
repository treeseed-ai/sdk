import {test,expect} from 'bun:test';
import {firefox,type Browser} from 'playwright';
class BrowserAssertions{static result():Promise<string>{return window.sdkQualification;}}
class BrowserTests{
 private javascript='';
 private handle(request:Request):Response{if(new URL(request.url).pathname==='/program.js')return new Response(this.javascript,{headers:{'content-type':'text/javascript'}});return new Response('<!doctype html><script type="module" src="/program.js"></script>',{headers:{'content-type':'text/html','content-security-policy':"default-src 'none'; script-src 'self'"}});}
 async native():Promise<void>{const build=await Bun.build({entrypoints:['tests/support/browser-program.ts'],target:'browser',format:'esm'});if(!build.success)throw new Error('Browser public export build failed');this.javascript=await build.outputs[0]!.text();for(const module of ['node:fs','node:crypto','node:path','node:child_process'])expect(this.javascript.includes(module)).toBe(false);const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:this.handle.bind(this)});let browser:Browser|null=null;try{browser=await firefox.launch({headless:true});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.port);await page.waitForFunction(BrowserTests.ready);expect(await page.evaluate(BrowserAssertions.result)).toBe('native-browser-ok');}finally{await browser?.close();await server.stop(true);}}
 static ready():boolean{return Boolean(window.sdkQualification);}
}
const suite=new BrowserTests();test('integration: built portable and native composition exports drain replace read back and clean up in real Firefox',suite.native.bind(suite),30000);
