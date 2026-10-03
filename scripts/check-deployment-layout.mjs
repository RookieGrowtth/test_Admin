// Check the actual Docker COPY payload and production dependency installation on this host.
// This is not a replacement for building/running the Linux container with Docker.
import {mkdtemp,cp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const source=new URL('../',import.meta.url).pathname,dir=await mkdtemp(join(tmpdir(),'testhub-deployment-check-'));
const dockerfile=await readFile(join(source,'Dockerfile'),'utf8');
for(const line of dockerfile.split('\n').filter(line=>line.startsWith('COPY '))){
 const items=line.split(/\s+/).slice(1),destination=items.pop();
 for(const name of items)await cp(join(source,name),join(dir,destination==='./'?name:destination),{recursive:true});
}
const {stdout}=await promisify(execFile)('npm',['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:dir});console.log(stdout.trim());
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
let errors='';const child=spawn(process.execPath,['server.js'],{cwd:dir,env:{...process.env,PORT:String(port),APP_SECRET:randomUUID()+randomUUID()},stdio:['ignore','ignore','pipe']});child.stderr.on('data',s=>errors+=s);
try{
 let response;for(let n=0;n<50;n++){try{response=await fetch(`http://127.0.0.1:${port}/api/health`);break;}catch{await new Promise(r=>setTimeout(r,100));}}
 assert.equal(response?.status,200,errors);assert.equal((await response.json()).ok,true);
 const index=await fetch(`http://127.0.0.1:${port}/`);assert.equal(index.status,200);
 console.log(JSON.stringify({status:'通过',directory:dir,productionDependencies:true,health:200,index:200,linuxContainer:'未执行：本机没有 Docker'}));
}finally{child.kill('SIGTERM');}
