// Local verification only. The original Keychain key never leaves server memory or enters app storage.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {encrypt} from '../backend/lib/crypto.js';
import {startEngine,getEngineJob} from '../backend/services/legacy-generator.js';
const exec=promisify(execFile);
const {stdout:key}=await exec('/usr/bin/security',['find-generic-password','-s','com.mystonks.test-toolbox.testcase-api-key','-a','profile:'+(process.env.VERIFY_PROFILE||'legacy_default'),'-w']);
const file=process.argv[2]||'/Users/sheep/Desktop/test_Tool/tests/fixtures/generator_smoke.md';
const config={name:'Original model verification',provider:'custom',model:process.env.VERIFY_MODEL||'qwen-vl-max',baseUrl:process.env.VERIFY_BASE_URL||'https://dashscope.aliyuncs.com/compatible-mode/v1',apiKeyEncrypted:encrypt(key.trim())};
const input={files:[{name:file.split('/').pop(),base64:(await readFile(file)).toString('base64')}],format:process.argv[3]||'excel',step:process.argv[4]||'all',saveKnowledge:true,withTestPlan:false};
for(let run=0;run<(process.env.VERIFY_REPEAT?'2':'1');run++){
  const job=await startEngine(input,[config],'verification');console.log('Job',job.id);
  const result=await new Promise(resolve=>{let last='';const timer=setInterval(()=>{const current=getEngineJob(job.id,'verification');if(current.log!==last){console.log(current.log.slice(last.length));last=current.log;}if(current.status!=='running'){clearInterval(timer);console.log(JSON.stringify({status:current.status,artifacts:current.artifacts}));resolve(current);}},2000);});
  if(result.status!=='completed'){process.exitCode=1;break;}
  if(run&&process.env.VERIFY_REPEAT&&!/图片批次.*无需重复识别/.test(result.log))throw new Error('Repeated vision run did not report cache reuse');
}
