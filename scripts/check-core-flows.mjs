// Isolated diagnostic checks: no writes to the main project's database or model keys.
import {cp,symlink,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import XLSX from 'xlsx-js-style';
const source=new URL('../',import.meta.url).pathname,dir=await mkdtemp(join(tmpdir(),'testhub-core-check-'));
for(const name of ['server.js','package.json','backend','public','templates'])await cp(join(source,name),join(dir,name),{recursive:true});
await symlink(join(source,'node_modules'),join(dir,'node_modules'),'dir');
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const child=spawn(process.execPath,['server.js'],{cwd:dir,env:{...process.env,PORT:String(port),APP_SECRET:randomUUID()+randomUUID()},stdio:['ignore','ignore','pipe']});
const base=`http://127.0.0.1:${port}`;let token='';const results=[];
async function req(path,data,method=data?'POST':'GET'){
 const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(data?{body:JSON.stringify(data)}:{})});
 return {status:r.status,data:await r.json()};
}
const check=(name,passed,actual)=>results.push({name,status:passed?'通过':'失败',actual});
try{
 for(let n=0;n<50;n++){try{await req('/health');break;}catch{await new Promise(r=>setTimeout(r,100));}}
 check('未登录禁止读取业务数据',(await req('/bootstrap')).status===401);
 let r=await req('/auth/login',{username:'admin',password:'admin123'});token=r.data.token;check('管理员登录',r.status===200);
 const project=await req('/projects',{name:'QA isolated',code:'QA',memberIds:['u-tester']});check('创建项目',project.status===201);
 const p=project.data.id;
 const testcase=await req('/cases',{projectId:p,title:'QA isolated case',module:'QA',steps:[{action:'读取记录',expected:'记录未修改'}]});check('创建用例',testcase.status===201);
 const plan=await req('/plans',{projectId:p,name:'QA plan',caseIds:[testcase.data.id]});check('创建合法计划',plan.status===201);
 r=await req('/plans/'+plan.data.id+'/executions',{results:[{caseId:testcase.data.id,status:'passed'}]});check('保存执行结果',r.status===200&&r.data.executions[0].status==='passed');
 const defect=await req('/defects',{projectId:p,planId:plan.data.id,caseId:testcase.data.id,title:'QA defect',severity:'major'});check('创建关联缺陷',defect.status===201);
 r=await req('/reports/summary?projectId='+p);check('报告聚合与数据一致',r.data.cases===1&&r.data.executions.passed===1&&r.data.defects.major===1);
 r=await req('/reports/export',{projectId:p});check('报告生成',r.status===200&&typeof r.data.html==='string');
 r=await req('/plans',{projectId:p,name:'Invalid reference',caseIds:['nonexistent-case']});check('拒绝不存在的计划用例',[404,422].includes(r.status),{http:r.status});
 r=await req('/plans',{projectId:p,name:'Cross-project reference',caseIds:['c-login']});check('拒绝跨项目计划用例',r.status===422,{http:r.status});
 r=await req('/plans',{projectId:'nonexistent-project',name:'Missing project',caseIds:['c-login']});check('拒绝不存在的计划项目',r.status===422,{http:r.status});
 r=await req('/plans/'+plan.data.id+'/executions',{results:[{caseId:testcase.data.id,status:'failed'},{caseId:'nonexistent-case',status:'passed'}]});
 const after=(await req('/bootstrap')).data.plans.find(x=>x.id===plan.data.id).executions[0].status;
 check('非法批次拒绝且不留下部分修改',r.status===422&&after==='passed',{http:r.status,expected:'passed',actual:after});
 r=await req('/plans/'+plan.data.id+'/executions',{results:[null]});check('空执行条目明确拒绝而不崩溃',r.status===422,{http:r.status});
 r=await req('/plans/'+plan.data.id+'/executions',{results:[{caseId:testcase.data.id,status:'failed'},{caseId:testcase.data.id,status:'invalid-status'}]});
 const afterStatus=(await req('/bootstrap')).data.plans.find(x=>x.id===plan.data.id).executions[0].status;
 check('批次含非法状态时不修改已有结果',r.status===422&&afterStatus==='passed',{http:r.status,actual:afterStatus});
 r=await req('/cases',{projectId:'nonexistent-project',title:'invalid project'});check('拒绝不存在的用例项目',[404,422].includes(r.status),{http:r.status});
 r=await req('/cases/import',{projectId:p,rows:[{title:'Blank step',module:'QA',steps:[{action:'',expected:''}]}]});check('拒绝操作与预期均为空的导入步骤',r.status===422,{http:r.status});
 for(const steps of [[null],[''],[{action:'do',expected:' '}],['do | ']]){
  r=await req('/cases/import',{projectId:p,rows:[{title:'Malformed step',module:'QA',steps}]});check('拒绝异常步骤 '+JSON.stringify(steps),r.status===422,{http:r.status});
 }
 const beforeImport=(await req('/bootstrap')).data.cases.length;
 r=await req('/cases/import',{projectId:p,rows:[{title:'Valid but blocked by bad batch',module:'QA',steps:[{action:'do',expected:'ok'}]},{title:'Invalid',module:'QA',steps:[{action:'',expected:''}]}]});
 check('混合合法与非法导入不部分入库',r.status===422&&(await req('/bootstrap')).data.cases.length===beforeImport,{http:r.status});
 r=await req('/cases/import',{projectId:p,rows:[{title:'Valid import',module:'QA',steps:[{action:' do ',expected:' ok '}]}]});check('合法结构化步骤保持可导入',r.status===201&&r.data.cases[0].steps[0].action==='do');
 r=await req('/auth/login',{username:'tester',password:'demo123'});token=r.data.token;
 check('测试工程师不能创建用户',(await req('/users',{username:'should-not-create'})).status===403);
 r=await req('/bootstrap');check('测试工程师不能读取模型管理配置',r.status===200&&r.data.aiConfigs.length===0);
 r=await req('/ai/engine/knowledge');check('知识库空列表可读取',r.status===200&&Array.isArray(r.data));
 r=await req('/ai/engine/knowledge',{category:'testcases',name:'qa.md',base64:Buffer.from('合成知识库测试，不包含私有数据').toString('base64')});check('知识文件可导入',r.status===201);
 r=await req('/ai/engine/knowledge');check('导入后的知识可查询',r.status===200&&r.data.length===1);
 const knowledgePath=r.data[0].path;
 r=await req('/ai/engine/knowledge/detail?path='+encodeURIComponent(knowledgePath));check('知识详情保留原文件名与内容',r.status===200&&r.data.name==='qa.md'&&r.data.content.includes('合成知识库测试'));
 r=await req('/ai/engine/knowledge/detail?path='+encodeURIComponent('../../ai-testhub.db'));check('知识详情拒绝目录穿越',r.status===404);
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['标题','预期'],['合成用例','正确结果']]),'QA');
 r=await req('/ai/engine/knowledge',{category:'testcases',files:[{name:'qa-batch.md',base64:Buffer.alloc(4*1024*1024,65).toString('base64')},{name:'qa-batch.txt',base64:Buffer.alloc(4*1024*1024,66).toString('base64')},{name:'qa.xlsx',base64:XLSX.write(book,{type:'base64',bookType:'xlsx'})}]});check('多文件总量超过 5MB 且低于 10MB 可导入',r.status===201&&r.data.files?.length===3);
 const excelPath=r.data.files?.[2]?.path;
 r=await req('/ai/engine/knowledge/detail?path='+encodeURIComponent(excelPath));check('Excel知识详情展示工作表和单元格',r.status===200&&r.data.sheets?.[0]?.rows?.[1]?.[0]==='合成用例');
 const beforeKnowledge=(await req('/ai/engine/knowledge')).data.length;
 r=await req('/ai/engine/knowledge',{category:'testcases',files:[{name:'valid.md',base64:'YWJj'},{name:'bad.pdf',base64:'YWJj'}]});check('非法知识批次不会部分导入',r.status===422&&(await req('/ai/engine/knowledge')).data.length===beforeKnowledge);
 r=await req('/auth/login',{username:'admin',password:'admin123'});const testerToken=token;token=r.data.token;
 r=await req('/ai/engine/knowledge/detail?path='+encodeURIComponent(knowledgePath));check('不同账户无法读取知识详情',r.status===404);token=testerToken;
 r=await req('/ai/engine/knowledge',{category:'testcases',name:'qa.pdf',base64:'YWJj'});check('不支持的知识格式明确拒绝',r.status===422);
 console.log(JSON.stringify({directory:dir,results,total:results.length,passed:results.filter(x=>x.status==='通过').length,failed:results.filter(x=>x.status==='失败').length},null,2));
 if(results.some(x=>x.status==='失败'))process.exitCode=1;
}finally{
 if(process.env.QA_KEEP&& !process.exitCode){console.log('Browser QA URL: '+base);process.on('SIGINT',()=>{child.kill('SIGTERM');process.exit(0);});}
 else child.kill('SIGTERM');
}
