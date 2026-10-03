import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {collectCompletion, validateEngineInput, getEngineJob, cancelEngineJob, hasExpectedEngineOutput} from '../backend/services/legacy-generator.js';

test('document inputs accept the original formats and reject traversal/unsupported files',()=>{
  for(const name of ['a.doc','a.docx','a.pdf','a.xlsx','a.xmind','a.png','a.jpg'])assert.doesNotThrow(()=>validateEngineInput({files:[{name,base64:'YWJj'}]}));
  assert.throws(()=>validateEngineInput({files:[{name:'a.sh',base64:'YWJj'}]}));
  assert.throws(()=>validateEngineInput({input:'',files:[]}));
  assert.throws(()=>validateEngineInput({input:'req',format:'zip'}));
});
test('engine gateway accepts a complete stream only',async()=>{
  const stream='data: '+JSON.stringify({choices:[{index:0,delta:{content:'result'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n';
  const response=()=>new Response(stream,{headers:{'Content-Type':'text/event-stream'}});
  assert.equal((await collectCompletion(response())).choices[0].message.content,'result');
  await assert.rejects(()=>collectCompletion(new Response(stream.replace('data: [DONE]\n',''),{headers:{'Content-Type':'text/event-stream'}})),/不完整/);
  await assert.rejects(()=>collectCompletion(new Response(stream.replace('stop','length'),{headers:{'Content-Type':'text/event-stream'}})),/不完整/);
});
test('uploads accept a 10 MB batch but enforce per-file and combined limits',()=>{
  const file={name:'a.md',base64:Buffer.alloc(5*1024*1024,65).toString('base64')};
  assert.doesNotThrow(()=>validateEngineInput({files:[file,{...file,name:'b.md'}]}));
  assert.throws(()=>validateEngineInput({files:[file,{...file,name:'b.md'}],confirmedFile:{name:'c.md',base64:'YWJj'}}),/总上传最大 10 MB/);
  assert.throws(()=>validateEngineInput({files:[{...file,base64:Buffer.alloc(5*1024*1024+1,65).toString('base64')}]}),/单文件最大 5 MB/);
});
test('missing jobs cannot be read or cancelled',()=>{assert.equal(getEngineJob('unknown','user'),null);assert.equal(cancelEngineJob('unknown','user'),false);});
test('confirmation sources cannot silently overwrite each other',()=>{
  assert.throws(()=>validateEngineInput({input:'req',confirmedText:'confirmed rule',confirmedFile:{name:'confirmed.md',base64:'YWJj'}}),/二选一/);
  assert.doesNotThrow(()=>validateEngineInput({input:'req',confirmedText:'confirmed rule'}));
  assert.doesNotThrow(()=>validateEngineInput({input:'req',confirmedFile:{name:'confirmed.md',base64:'YWJj'}}));
});
test('knowledge picker and requirement picker include the original Markdown and Excel variants',async()=>{
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.ok(source.includes('accept=".md,.markdown,.txt,.xlsx,.xls"'));
  assert.ok(source.includes("replaceAll('.xls,.md,.txt', '.xls,.md,.markdown,.txt')"));
});
test('an audit or candidate file cannot be treated as a formal successful export',()=>{
  assert.equal(hasExpectedEngineOutput([{path:'过程数据/候选用例.json'},{path:'job.json'}],{format:'excel'}),false);
  for(const [format,suffix] of [['excel','xlsx'],['xmind','xmind'],['md','md']])assert.equal(hasExpectedEngineOutput([{path:'最终数据/用例.'+suffix}],{format}),true);
  assert.equal(hasExpectedEngineOutput([{path:'最终数据/需求分析.docx'}],{step:'analyze'}),true);
  assert.equal(hasExpectedEngineOutput([{path:'最终数据/需求分析.docx'}],{step:'all',format:'excel'}),false);
});
