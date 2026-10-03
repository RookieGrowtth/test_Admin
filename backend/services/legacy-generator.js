/** Original, self-contained macOS generator. No desktop settings or keys are copied. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, readdir, stat, symlink } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { dataDir, root } from '../config/index.js';
import { decrypt } from '../lib/crypto.js';
import {requireModelKey} from './ai-defaults.js';
import XLSX from 'xlsx-js-style';

export const enginePath = join(root, 'vendor/testcase-engine/TestCaseGeneratorEngine');
export const supportedFiles = new Set(['.doc','.docx','.pdf','.xlsx','.xls','.md','.markdown','.txt','.json','.yaml','.yml','.xmind','.png','.jpg','.jpeg']);
const jobs = new Map();
const startingOwners = new Set();
const workspace = join(dataDir, 'generator');

export function validateEngineInput(input) {
  if(input.confirmedFile&&String(input.confirmedText||'').trim())throw new Error('确认文件与确认文字请二选一，原引擎一次仅处理一份确认材料');
  if (!['all','analyze','generate','analysis'].includes(input.step || 'all')) throw new Error('无效执行阶段');
  if (!['excel','xmind','md'].includes(input.format || 'excel')) throw new Error('无效导出格式');
  if (!String(input.input || '').trim() && !input.files?.length) throw new Error('请提供需求文本或文件');
  if (input.files?.length > 10) throw new Error('最多上传 10 个文件');
  let totalBytes=0;
  for (const file of [...(input.files || []), ...[input.confirmedFile,input.featuresFile,input.candidateFile].filter(Boolean)]) {
    if (!supportedFiles.has(extname(String(file.name)).toLowerCase())) throw new Error('不支持的文档格式');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64 || '') || !file.base64) throw new Error('文件数据无效');
    if (Buffer.from(file.base64, 'base64').length > 5 * 1024 * 1024) throw new Error('单文件最大 5 MB');
    totalBytes+=Buffer.from(file.base64,'base64').length;
  }
  if(totalBytes>10*1024*1024)throw new Error('总上传最大 10 MB');
  for(const key of ['featuresFile','candidateFile'])if(input[key]&&extname(input[key].name).toLowerCase()!=='.json')throw new Error('续跑需求与候选文件必须是 JSON');
  if(input.step==='generate'&&!input.featuresFile)throw new Error('续跑需要结构化需求 JSON');
}

export function workbookPreview(buffer) {
  const book=XLSX.read(buffer,{type:'buffer'}),sheet=book.Sheets['全量用例'];
  if(!sheet)return [];
  const regressionIds=new Set(book.Sheets['回归用例']?XLSX.utils.sheet_to_json(book.Sheets['回归用例']).map(row=>String(row['序号'])):[]);
  return XLSX.utils.sheet_to_json(sheet,{defval:''}).map(row=>{
    const actions=String(row['测试步骤']).split('\n').filter(Boolean),expected=String(row['预期结果']).split('\n').filter(Boolean);
    const requirementIds=[...new Set(String(row['备注']).match(/REQ-\d+/g)||[])];
    const questionIds=[...new Set(String(row['备注']).match(/Q-\d+/g)||[])],regression=regressionIds.has(String(row['序号']));
    const level=/测试层级：([^\n；]+)/.exec(String(row['备注']))?.[1]?.trim();
    const caseType=({UI:'ui',API:'api',Performance:'performance',Security:'security',Compatibility:'compatibility'})[level]||'functional';
    return {title:String(row['用例标题']),module:String(row['模块']),caseType,priority:String(row['优先级']),
      smoke:row['是否冒烟']==='是',precondition:String(row['前置准备']),requirementIds,notes:String(row['备注']),regression,tags:[...requirementIds,...questionIds,...(regression?['回归']:[])],
      steps:actions.length===expected.length?actions.map((action,i)=>({action,expected:expected[i]})):[{action:actions.join('\n'),expected:expected.join('\n')}]};
  });
}

export function hasExpectedEngineOutput(artifacts,input) {
  const phase=input.step||'all',extension={excel:'.xlsx',xmind:'.xmind',md:'.md'}[input.format||'excel'];
  return artifacts.some(a=>a.path.startsWith('最终数据/')&&(['analyze','analysis'].includes(phase)?/\.(docx|json)$/.test(a.path):a.path.endsWith(extension)));
}

// Engine expects JSON; upstream text requests use SSE to avoid long-request gateway timeouts.
export async function collectCompletion(response) {
  if (!response.ok) {
    const payload=await response.json().catch(()=>({}));
    const error=new Error(`模型服务 HTTP ${response.status}: ${String(payload.error?.message||'请求失败').slice(0,500)}`);error.status=response.status;throw error;
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) return response.json();
  const choices = new Map(); let done = false, pending = '';const metadata={};
  const consume = line => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim(); if (data === '[DONE]') { done = true; return; }
    const item = JSON.parse(data); if (item.error) throw new Error('模型服务返回错误');
    for(const key of ['id','model','created','usage'])if(item[key]!=null)metadata[key]=item[key];
    for (const c of item.choices || []) {
      const choice = choices.get(c.index) || {index:c.index,message:{role:'assistant',content:''},finish_reason:null};
      choice.message.content += c.delta?.content || ''; if (c.finish_reason) choice.finish_reason = c.finish_reason;
      choices.set(c.index, choice);
    }
  };
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    pending += decoder.decode(chunk, {stream:true}); let newline;
    while ((newline = pending.indexOf('\n')) >= 0) { consume(pending.slice(0,newline).replace(/\r$/, '')); pending = pending.slice(newline+1); }
    if(done)break;
  }
  pending += decoder.decode(); if (pending.trim()) consume(pending);
  if (!done || !choices.size || [...choices.values()].some(c=>!c.finish_reason || c.finish_reason==='length')) throw new Error('模型流不完整，拒绝导出部分结果');
  return {...metadata,object:'chat.completion',choices:[...choices.values()]};
}

async function gateway(configs, controller) {
  let credentials;try{credentials=configs.map(c=>decrypt(c.apiKeyEncrypted));}catch{throw new Error('API Key 无法解密，请恢复原 APP_SECRET 或重新保存模型配置');}
  const token = randomUUID();
  const server = createServer(async (req,res)=>{
    try {
      if(req.headers.authorization !== `Bearer ${token}`) { res.writeHead(403); res.end(); return; }
      const match = /^\/(\d+)\/chat\/completions$/.exec(req.url || '');
      if (!match || !configs[Number(match[1])]) {res.writeHead(404);res.end();return;}
      const index=Number(match[1]); let raw='';for await(const part of req){raw+=part;if(raw.length>32*1024*1024)throw new Error('模型请求过大');}
      const payload=JSON.parse(raw); payload.model=configs[index].model;
      if (new URL(configs[index].baseUrl).hostname.endsWith('aliyuncs.com')) {
        if(payload.model.startsWith('qwen-vl-')){delete payload.reasoning_effort;delete payload.thinking_budget;}
        if(payload.model.startsWith('qwen3-vl-')){delete payload.reasoning_effort;payload.enable_thinking=false;}
      }
      payload.stream=true; payload.stream_options={include_usage:true};
      payload.max_tokens=Math.min(Number(payload.max_tokens)||8192,8192);
      const response=await fetch(configs[index].baseUrl.replace(/\/$/,'')+'/chat/completions',{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${credentials[index]}`},
        body:JSON.stringify(payload),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(600000)])});
      const result=await collectCompletion(response);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
    } catch(error) { if(!res.headersSent)res.writeHead(error.status||502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:error.message}})); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,token,base:`http://127.0.0.1:${server.address().port}`};
}

async function inventory(directory, prefix='') {
  const result=[];
  for(const item of await readdir(directory,{withFileTypes:true})){
    const relative=join(prefix,item.name);if(item.isDirectory())result.push(...await inventory(join(directory,item.name),relative));
    else if(item.isFile()) result.push({path:relative,size:(await stat(join(directory,item.name))).size});
  }
  return result;
}

export async function startEngine(input, configs, owner) {
  validateEngineInput(input);
  if(startingOwners.has(owner)||[...jobs.values()].some(j=>j.owner===owner&&j.status==='running'))throw new Error('已有运行中的任务，请等待或取消后重试');
  startingOwners.add(owner);
  try{return await launchEngine(input,configs,owner);}finally{startingOwners.delete(owner);}
}
async function launchEngine(input,configs,owner){
  configs.forEach(requireModelKey);
  if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('原工具引擎需要 macOS Apple Silicon；当前平台不支持');
  const controller=new AbortController();
  const id=randomUUID(), directory=join(workspace,'jobs',id), knowledge=join(workspace,'knowledge',String(owner));
  await mkdir(join(directory,'input'),{recursive:true}); await mkdir(knowledge,{recursive:true});
  const paths=[];
  for(const [index,file] of (input.files||[]).entries()){
    const suffix=extname(file.name).toLowerCase(),name=String(file.name).slice(0,-suffix.length).replace(/[\\/,:\x00-\x1f]/g,'_').slice(0,100)||'document';
    const path=join(directory,'input',`${index}-${name}${suffix}`);
    await writeFile(path,Buffer.from(file.base64,'base64'),{mode:0o600});paths.push(path);
  }
  // Preserve old style-profile categories, isolated per authenticated account.
  await symlink(knowledge,join(directory,'knowledge'),'dir');
  const visionIdentity=createHash('sha256').update(JSON.stringify(configs.map(c=>[c.id,c.baseUrl,c.model,c.apiKeyEncrypted]))).digest('hex');
  const visionCache=join(workspace,'vision-cache',String(owner),visionIdentity);
  await mkdir(visionCache,{recursive:true});await mkdir(join(directory,'过程数据'),{recursive:true});
  await symlink(visionCache,join(directory,'过程数据','图片识别缓存'),'dir');
  const args=['--provider','qwen','--step',input.step||'all','--format',input.format||'excel','--platform','AUTO','--depth','full','--data-classification','internal',input.withTestPlan?'--with-test-plan':'--no-test-plan'];
  if(String(input.input||'').trim()){const path=join(directory,'input','supplemental-requirement.md');await writeFile(path,String(input.input),{mode:0o600});paths.push(path);}
  if(paths.length)args.push('--files',paths.join(','));
  if(input.saveKnowledge)args.push('--save-knowledge');
  if(input.confirmedFile){const path=join(directory,'input',`confirmed${extname(input.confirmedFile.name).toLowerCase()}`);await writeFile(path,Buffer.from(input.confirmedFile.base64,'base64'),{mode:0o600});args.push('--confirmed',path);}
  if(input.confirmedText){const path=join(directory,'input','confirmed.txt');await writeFile(path,String(input.confirmedText),{mode:0o600});args.push('--confirmed',path);}
  for(const [key,flag] of [['featuresFile','--features-file'],['candidateFile','--candidate-file']])if(input[key]){const path=join(directory,'input',key+'.json');await writeFile(path,Buffer.from(input[key].base64,'base64'),{mode:0o600});args.push(flag,path);}
  const proxy=await gateway(configs,controller);
  const profiles=configs.map((c,i)=>({id:`tool_profile_${i}`,name:c.name,provider:'custom',model:c.model,vision_model:c.model,base_url:`${proxy.base}/${i}`}));
  const env={...process.env,TESTCASE_GENERATOR_ROOT:directory,TESTCASE_WORKBOOK_LAYOUT:'multi_platform',DEFAULT_PROVIDER:'qwen',
    TESTCASE_VISION_CACHE_IDENTITY:visionIdentity,
    STRICT_QUALITY_GATE:'true',TESTCASE_MODEL_PROFILES:JSON.stringify(profiles),TESTCASE_PRIMARY_PROFILE_ID:'tool_profile_0',
    TESTCASE_FALLBACK_PROFILE_ID:configs[1]?'tool_profile_1':'',AUTO_FAILOVER_ON_TRANSIENT_ERRORS:String(!!configs[1]),AUTO_FAILOVER_ON_BALANCE:String(!!configs[1]),
    QWEN_API_KEY:proxy.token,QWEN_BASE_URL:`${proxy.base}/0`,QWEN_MODEL:configs[0].model,TESTCASE_MODEL_API_KEY_0:proxy.token,
    TESTCASE_MODEL_TIMEOUT_SECONDS:'600',TOOL_MODEL_CALL_DEADLINE_SECONDS:'600',QWEN_TIMEOUT_SECONDS:'600',QWEN_MAX_RETRIES:'0',TESTCASE_MODEL_MAX_RETRIES:'0',
    GENERATION_REQUIREMENT_BATCH_SIZE:'4',EXTRACTION_CHUNK_MAX_CHARS:'3500',EXTRACTION_MIN_CHUNK_CHARS:'1200',VISION_REQUEST_BATCH_SIZE:'1',VISION_MAX_OUTPUT_TOKENS:'4096',TESTCASE_PARALLEL_WORKERS:'1',TOOL_PARALLEL_WORKERS:'1',NO_PROXY:'127.0.0.1,localhost'};
  for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])delete env[key];
  if(configs[1])Object.assign(env,{DEEPSEEK_API_KEY:proxy.token,DEEPSEEK_BASE_URL:`${proxy.base}/1`,DEEPSEEK_MODEL:configs[1].model,TESTCASE_MODEL_API_KEY_1:proxy.token,BALANCE_FALLBACK_PROVIDER:'deepseek'});
  const job={id,owner,status:'running',log:'',artifacts:[],directory,controller,createdAt:new Date().toISOString()};jobs.set(id,job);
  await writeFile(join(directory,'job.json'),JSON.stringify({id,owner,status:'running',artifacts:[],createdAt:job.createdAt}),{mode:0o600});
  const child=spawn(enginePath,args,{env,cwd:directory,stdio:['ignore','pipe','pipe']});job.child=child;
  const append=chunk=>{job.log=(job.log+chunk.toString().split(proxy.token).join('[gateway token]')).slice(-120000);};child.stdout.on('data',append);child.stderr.on('data',append);
  let finished=false;
  const finish=async(code,error)=>{
    if(finished)return;finished=true;
    controller.abort();proxy.server.closeAllConnections();proxy.server.close();clearTimeout(timer);
    job.artifacts=(await inventory(directory)).filter(f=>(f.path.startsWith('最终数据/')||f.path.startsWith('过程数据/'))&&/\.(xlsx|xmind|md|json|docx|pdf)$/.test(f.path));
    const hasExpectedOutput=hasExpectedEngineOutput(job.artifacts,input);
    job.status=['cancelled','failed'].includes(job.status)?job.status:!error&&code===0&&hasExpectedOutput?'completed':'failed';
    if(job.status==='completed'){
      const workbook=job.artifacts.find(a=>a.path.startsWith('最终数据/')&&a.path.endsWith('.xlsx'));
      if(workbook)job.cases=workbookPreview(await readFile(join(directory,workbook.path)));
    }
    if(job.status!=='completed')job.artifacts=job.artifacts.filter(a=>/\.(json|md)$/.test(a.path)&&a.path.startsWith('过程数据/'));
    if(error)append(error.message);await writeFile(join(directory,'engine.log'),job.log,{mode:0o600});await writeFile(join(directory,'job.json'),JSON.stringify({id,owner,status:job.status,artifacts:job.artifacts,cases:job.cases||[],createdAt:job.createdAt}),{mode:0o600});
  };
  const timer=setTimeout(()=>{job.status='failed';append('\n任务超过 60 分钟限制');child.kill('SIGTERM');},3600000);timer.unref();
  child.once('error',error=>finish(null,error));child.once('exit',code=>finish(code));
  return publicJob(job);
}
function publicJob(job){return {id:job.id,status:job.status,log:job.log,artifacts:job.status==='running'?[]:job.artifacts,cases:job.cases||[],createdAt:job.createdAt};}
export function getEngineJob(id,owner){const job=jobs.get(id);return job&&job.owner===owner?publicJob(job):null;}
export function listEngineJobs(owner){return [...jobs.values()].filter(job=>job.owner===owner).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,20).map(({id,status,createdAt})=>({id,status,createdAt}));}
export function cancelEngineJob(id,owner){const job=jobs.get(id);if(!job||job.owner!==owner)return false;if(job.status==='running'){job.status='cancelled';job.controller.abort();job.child.kill('SIGTERM');}return true;}
export async function engineArtifact(id,owner,path){const job=jobs.get(id);if(!job||job.owner!==owner||job.status==='running'||!job.artifacts.some(a=>a.path===path))return null;return readFile(join(job.directory,path));}
export async function listKnowledge(owner){
  const directory=join(workspace,'knowledge',String(owner));await mkdir(directory,{recursive:true});
  return Promise.all((await inventory(directory)).map(async file=>{
    const metadata=await readFile(join(workspace,'knowledge-metadata',String(owner),file.path.split('/').pop()+'.json'),'utf8').then(JSON.parse).catch(()=>({}));
    const info=await stat(join(directory,file.path));
    return {...file,name:metadata.name||file.path.split('/').pop(),category:file.path.split('/')[0],createdAt:metadata.createdAt||info.birthtime.toISOString()};
  }));
}
export async function addKnowledge(owner,input){
  const files=input.files||[input];
  if(!['testcases','test_plans'].includes(input.category)||!Array.isArray(files)||!files.length||files.some(file=>!['.md','.markdown','.txt','.xlsx','.xls'].includes(extname(String(file.name)).toLowerCase())))throw new Error('知识库支持 Markdown、TXT、XLSX、XLS，与原工具一致');
  validateEngineInput({files});
  const directory=join(workspace,'knowledge',String(owner),input.category),metadataDirectory=join(workspace,'knowledge-metadata',String(owner));
  await mkdir(directory,{recursive:true});await mkdir(metadataDirectory,{recursive:true});
  const imported=[];
  for(const file of files){const name=randomUUID()+extname(file.name).toLowerCase();await writeFile(join(directory,name),Buffer.from(file.base64,'base64'),{mode:0o600});await writeFile(join(metadataDirectory,name+'.json'),JSON.stringify({name:String(file.name).split(/[\\/]/).pop(),createdAt:new Date().toISOString()}),{mode:0o600});imported.push({name,path:input.category+'/'+name});}
  return files.length===1?imported[0]:{files:imported};
}
export async function knowledgeDetail(owner,path){
  const item=(await listKnowledge(owner)).find(file=>file.path===path);if(!item)return null;
  const buffer=await readFile(join(workspace,'knowledge',String(owner),item.path));
  if(['.xls','.xlsx'].includes(extname(item.path))){const book=XLSX.read(buffer,{type:'buffer'});return {...item,sheets:book.SheetNames.map(name=>({name,rows:XLSX.utils.sheet_to_json(book.Sheets[name],{header:1,defval:''}).slice(0,100)})),previewNote:'每个工作表预览前 100 行',base64:buffer.toString('base64')};}
  return {...item,content:buffer.toString('utf8').slice(0,64000),previewNote:'文本最多预览 64000 字符',base64:buffer.toString('base64')};
}

// Recover finished downloads after a server restart. A running job is never claimed successful.
for(const id of await readdir(join(workspace,'jobs')).catch(()=>[])){
  if(!/^[a-f0-9-]{36}$/.test(id))continue;
  try{
    const directory=join(workspace,'jobs',id),item=JSON.parse(await readFile(join(directory,'job.json'),'utf8'));
    if(item.id!==id||typeof item.owner!=='string')continue;
    const files=await inventory(directory),allowed=new Set(files.map(f=>f.path));
    const job={...item,directory,artifacts:(item.artifacts||[]).filter(a=>allowed.has(a.path)&&(a.path.startsWith('最终数据/')||a.path.startsWith('过程数据/'))),
      log:await readFile(join(directory,'engine.log'),'utf8').catch(()=>''),cases:item.cases||[]};
    if(job.status==='running'){job.status='failed';job.log+='\n服务已重启，任务中断；可用需求/候选 JSON 续跑。';}
    if(job.status==='completed'&&!job.cases.length){const file=job.artifacts.find(a=>a.path.startsWith('最终数据/')&&a.path.endsWith('.xlsx'));if(file)job.cases=workbookPreview(await readFile(join(directory,file.path)));}
    jobs.set(id,job);
  }catch{/* Ignore corrupt metadata rather than exposing files outside a verified job. */}
}
