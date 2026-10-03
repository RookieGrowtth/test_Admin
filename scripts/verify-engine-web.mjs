/** Runs the exact current application in an isolated temporary directory, never the user's DB. */
import {cp,symlink,mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
const source=new URL('../',import.meta.url).pathname,directory=await mkdtemp(join(tmpdir(),'testhub-engine-web-'));
for(const path of ['server.js','package.json','backend','public','templates','vendor'])await cp(join(source,path),join(directory,path),{recursive:true});
await symlink(join(source,'node_modules'),join(directory,'node_modules'),'dir');
const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const child=spawn(process.execPath,['server.js'],{cwd:directory,env:{...process.env,PORT:String(port),APP_SECRET:randomUUID()+randomUUID()},stdio:['ignore','pipe','pipe']});
child.stdout.on('data',part=>process.stdout.write(part));child.stderr.on('data',part=>process.stderr.write(part));
const base=`http://localhost:${port}`;console.log('Isolated verification URL:',base);
let token='';
async function request(path,body,method=body?'POST':'GET'){
  const response=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const payload=await response.json();if(!response.ok)throw new Error(JSON.stringify(payload));return payload;
}
try{
  for(let i=0;i<50;i++){try{await fetch(base+'/api/health');break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
  const login=await request('/auth/login',{username:'admin',password:'admin123'});token=login.token;
  const {stdout:key}=await promisify(execFile)('/usr/bin/security',['find-generic-password','-s','com.mystonks.test-toolbox.testcase-api-key','-a','profile:legacy_default','-w']);
  const config=await request('/ai-configs',{name:'原工具千问 验证环境',provider:'qwen',model:'qwen-vl-max',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',apiKey:key.trim()});
  const content=(await readFile(join(source,'tests/fixtures/engine-requirement.md'))).toString('base64');
  await request('/ai/engine/knowledge',{category:'testcases',name:'verification.md',base64:content});
  assert.ok((await request('/ai/engine/knowledge')).some(x=>x.path.startsWith('testcases/')));
  const cancelled=await request('/ai/engine/jobs',{configId:config.id,input:'取消测试任务 不应产生正式导出',step:'all',format:'excel'});
  await request('/ai/engine/jobs/'+cancelled.id,undefined,'DELETE');
  for(let i=0;i<50;i++){const job=await request('/ai/engine/jobs/'+cancelled.id);if(job.status==='cancelled')break;await new Promise(r=>setTimeout(r,100));}
  const started=await request('/ai/engine/jobs',{configId:config.id,files:[{name:'engine-requirement.md',base64:content}],step:'all',format:'excel',saveKnowledge:true,withTestPlan:true});
  console.log('API job:',started.id);
  let job;
  for(let i=0;i<900;i++){job=await request('/ai/engine/jobs/'+started.id);if(job.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,2000));}
  assert.equal(job.status,'completed',job.log);assert.ok(job.cases.length);
  const artifact=job.artifacts.find(a=>a.path.startsWith('最终数据/')&&a.path.endsWith('.xlsx'));assert.ok(artifact);
  const response=await fetch(base+'/api/ai/engine/jobs/'+started.id+'/artifact?path='+encodeURIComponent(artifact.path),{headers:{Authorization:`Bearer ${token}`}});assert.equal(response.status,200);assert.equal((await response.arrayBuffer()).byteLength,artifact.size);
  const unsafe=await fetch(base+'/api/ai/engine/jobs/'+started.id+'/artifact?path=../../.env',{headers:{Authorization:`Bearer ${token}`}});assert.equal(unsafe.status,404);
  console.log(JSON.stringify({webVerified:true,cases:job.cases.length,artifacts:job.artifacts.map(a=>a.path),directory,base}));
  console.log('Verification server remains open for browser QA. Ctrl-C stops only this isolated server.');
}catch(error){console.error(error.message);child.kill('SIGTERM');process.exitCode=1;}
process.on('SIGINT',()=>{child.kill('SIGTERM');process.exit(0);});
