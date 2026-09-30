import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const extensionPath=path.join(root,"dist","extension");
const outDir=path.join(root,"test-results","phase-6");
const requested=(process.argv.find((arg)=>arg.startsWith("--browser="))?.split("=")[1]||"all").toLowerCase();
const availableBrowsers=[
  {name:"Edge",path:"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"},
  {name:"Chrome",path:"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"}
];
const browsers=availableBrowsers.filter((item)=>existsSync(item.path)&&(requested==="all"||item.name.toLowerCase()===requested));
if(!["all","edge","chrome"].includes(requested)||browsers.length==0) throw new Error(`BROWSER_SELECTION_UNAVAILABLE:${requested}`);
if(requested==="all"&&browsers.length!==2) throw new Error(`BROWSER_MATRIX_INCOMPLETE:${browsers.map((item)=>item.name).join(",")}`);
const built=spawnSync(process.execPath,[path.join(root,"scripts","build-release.mjs")],{cwd:root,stdio:"inherit"});if(built.status!==0)throw new Error("BUILD_FAILED");
await mkdir(outDir,{recursive:true});
const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
async function waitFor(fn,timeout=30000){const end=Date.now()+timeout;let cause;while(Date.now()<end){try{const value=await fn();if(value)return value}catch(error){cause=error}await sleep(50)}throw cause||new Error("TIMEOUT")}

class Cdp{constructor(url){this.url=url;this.id=0;this.pending=new Map()}async connect(){this.socket=new WebSocket(this.url);await new Promise((resolve,reject)=>{this.socket.addEventListener("open",resolve,{once:true});this.socket.addEventListener("error",reject,{once:true})});this.socket.addEventListener("message",({data})=>{const m=JSON.parse(data);if(!m.id||!this.pending.has(m.id))return;const p=this.pending.get(m.id);this.pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result)});return this}call(method,params={}){const id=++this.id;this.socket.send(JSON.stringify({id,method,params}));return new Promise((resolve,reject)=>this.pending.set(id,{resolve,reject}))}close(){this.socket?.close()}}
function value(result){if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value}

async function runBrowser(browserInfo){
  const profile=await mkdtemp(path.join(os.tmpdir(),`zui-phase6-${browserInfo.name.toLowerCase()}-`));
  const child=spawn(browserInfo.path,["--headless=new","--window-size=1366,900","--remote-debugging-port=0",`--user-data-dir=${profile}`,`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`,"--no-first-run","--no-default-browser-check"],{stdio:"ignore",windowsHide:true});
  const active=await waitFor(async()=>{const file=path.join(profile,"DevToolsActivePort");return existsSync(file)?(await readFile(file,"utf8")).trim().split(/\r?\n/):null});
  const browser=await new Cdp(`ws://127.0.0.1:${active[0]}${active[1]}`).connect();const clients=[];
  const evaluate=async(client,expression)=>value(await client.call("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true}));
  const connect=async(targetId)=>{const row=await waitFor(async()=>(await(await fetch(`http://127.0.0.1:${active[0]}/json/list`)).json()).find((item)=>item.id===targetId));const client=await new Cdp(row.webSocketDebuggerUrl).connect();clients.push(client);await client.call("Runtime.enable");await client.call("Page.enable");return client};
  try{
    const worker=await waitFor(async()=>(await browser.call("Target.getTargets")).targetInfos.find((item)=>item.type==="service_worker"&&item.url.endsWith("/service-worker.js")));
    const extensionId=new URL(worker.url).host;
    const open=async(page)=>{const id=(await browser.call("Target.createTarget",{url:`chrome-extension://${extensionId}/${page}`})).targetId;const client=await connect(id);await waitFor(()=>evaluate(client,"document.readyState==='complete'"));return client};
    const popup=await open("popup.html");assert.equal(await evaluate(popup,"document.querySelector('h1').textContent"),"ZUI Macro Recorder");assert.equal(await evaluate(popup,"document.querySelector('#version').textContent.includes('0.6.0')"),true);
    const runtime=(message)=>evaluate(popup,`chrome.runtime.sendMessage(${JSON.stringify(message)})`);
    const saved=await runtime({type:"SAVE_MACRO",allowReplace:false,macro:{schemaVersion:"1.0",id:`phase6-${browserInfo.name}`,name:`Phase 6 ${browserInfo.name}`,createdAt:"2026-09-24T00:00:00.000Z",updatedAt:"2026-09-24T00:00:00.000Z",target:{origin:"http://127.0.0.1:4173",surface:{kind:"container",locator:{strategy:"css",value:"#target"},recordedGeometry:{widthCssPx:640,heightCssPx:360}}},recordingProfile:{keyboard:true,mouse:true,mouseMode:"clicks-only",wheel:true},playbackDefaults:{speedMultiplier:1,repeatCount:1,loopDelayMs:0,stopOnError:true},events:[{id:"d1",type:"delay",enabled:true,durationMs:0}]}});assert.equal(saved.ok,true);
    const backup=await runtime({type:"GET_LIBRARY_BACKUP"});assert.equal(backup.backup.macros.length,1);assert.equal(/tabId|profilePath|cookie/i.test(JSON.stringify(backup.backup)),false);
    const editor=await open("editor.html");await waitFor(()=>evaluate(editor,"document.querySelectorAll('.macro-card').length>0"));
    const layouts=[];for(const width of [1024,1366,1920]){await editor.call("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:false});await sleep(100);layouts.push({width,overflow:await evaluate(editor,"document.documentElement.scrollWidth>document.documentElement.clientWidth")});}
    assert.deepEqual(layouts.map((row)=>row.overflow),[false,false,false]);
    const timing=await evaluate(editor,"(()=>{const n=performance.getEntriesByType('navigation')[0];return {domContentLoaded:n.domContentLoadedEventEnd,load:n.loadEventEnd}})()");assert.ok(timing.load<5000);
    const shot=await editor.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});await writeFile(path.join(outDir,`${browserInfo.name.toLowerCase()}-editor.png`),Buffer.from(shot.data,"base64"));
    const settings=await open("settings.html");await waitFor(()=>evaluate(settings,"document.querySelector('#version').textContent==='0.6.0'"));assert.ok(await evaluate(settings,"document.querySelectorAll('section').length")>=5);
    const onboarding=await open("onboarding.html?reopen=1");assert.equal(await evaluate(onboarding,"document.querySelectorAll('.steps li').length"),4);
    return {browser:browserInfo.name,version:"0.6.0",layouts,timing,backupMacros:backup.backup.macros.length};
  }finally{for(const client of clients)client.close();browser.close();if(process.platform==="win32")spawnSync("taskkill",["/PID",String(child.pid),"/T","/F"],{stdio:"ignore"});else child.kill();await rm(profile,{recursive:true,force:true}).catch(()=>{})}
}

const results=[];for(const browser of browsers){results.push(await runBrowser(browser));console.log(`phase6: ${browser.name} PASS`)}
await writeFile(path.join(outDir,"browser-matrix.json"),`${JSON.stringify({generatedAt:new Date().toISOString(),results},null,2)}\n`);
console.log(JSON.stringify(results));
