// In-flow dropdowns: options always appear below the trigger, never in an OS popup.
export function mountAiControls(root,{resultTab='results',onResultTab=()=>{}}={}) {
  if(!root)return;
  for (const select of root.querySelectorAll('select')) {
    if (select.dataset.enhanced) continue;
    select.dataset.enhanced='true';
    const label=select.closest('label');
    const name=label?.firstChild?.textContent.trim()||'选择';
    const box=document.createElement('div');box.className='ai-select';
    const toggle=document.createElement('button');toggle.type='button';toggle.className='ai-select-trigger';
    toggle.setAttribute('aria-label',name);toggle.setAttribute('aria-expanded','false');
    const menu=document.createElement('div');menu.className='ai-select-options';menu.hidden=true;
    const close=()=>{menu.hidden=true;toggle.setAttribute('aria-expanded','false');};
    const value=document.createElement('span');value.className='ai-select-value';
    const arrow=document.createElement('span');arrow.className='ai-select-arrow';arrow.innerHTML='<svg viewBox="0 0 16 16" width="16" height="16" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';arrow.setAttribute('aria-hidden','true');toggle.append(value,arrow);
    const sync=()=>{value.textContent=select.selectedOptions[0]?.textContent||'请选择';toggle.title=value.textContent;
      [...menu.children].forEach((b,i)=>b.setAttribute('aria-pressed',String(select.options[i].selected)));};
    [...select.options].forEach(option=>{
      const button=document.createElement('button');button.type='button';button.textContent=option.textContent;button.disabled=option.disabled;
      button.onclick=event=>{event.preventDefault();select.value=option.value;sync();close();toggle.focus();select.dispatchEvent(new Event('change',{bubbles:true}));};
      menu.append(button);
    });
    toggle.onclick=event=>{event.preventDefault();const opening=menu.hidden;
      root.querySelectorAll('.ai-select-options').forEach(m=>{m.hidden=true;m.previousElementSibling?.setAttribute('aria-expanded','false');});
      menu.hidden=!opening;toggle.setAttribute('aria-expanded',String(opening));};
    box.onkeydown=event=>{
      if(event.key==='Escape'){event.preventDefault();close();toggle.focus();}
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.preventDefault();menu.hidden=false;toggle.setAttribute('aria-expanded','true');
        const buttons=[...menu.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement);
        const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:event.key==='ArrowDown'?Math.min(index+1,buttons.length-1):Math.max(index-1,0);
        buttons[next]?.focus();
      }
    };
    box.onfocusout=event=>{if(!box.contains(event.relatedTarget))close();};
    select.hidden=true;select.after(box);box.append(toggle,menu);sync();
  }
  const form=root.querySelector('form[data-form="ai"]');if(!form)return;
  mountFilePicker(form.querySelector('[name="requirementFile"]'));
  const checks=['saveKnowledge','withTestPlan'].map(name=>form.querySelector('[name="'+name+'"]')?.closest('label')).filter(Boolean);
  if(checks.length&&!form.querySelector('.ai-check-options')){
    const group=document.createElement('div');group.className='ai-check-options';checks[0].before(group);group.append(...checks);
  }
  for(const label of root.querySelectorAll('label')){
    if(label.querySelector('input[type="checkbox"]'))continue;
    label.classList.add('ai-field');
    const nodes=[...label.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim());
    if(nodes.length){const caption=document.createElement('span');caption.className='ai-field-label';caption.textContent=nodes.map(n=>n.textContent.trim()).join(' ');nodes.forEach(n=>n.remove());label.prepend(caption);}
  }
  const phase=form.querySelector('[name="step"]');
  const phaseHelp=document.createElement('small');phaseHelp.className='muted';phase?.closest('label').append(phaseHelp);
  const update=()=>{
    phaseHelp.textContent=({all:'需求分析 → 用例生成 → 复核与导出；保存到项目需另行确认。',analyze:'仅提取需求事实与待确认项，不生成测试用例。',analysis:'输出完整测试方案，不写入项目用例。',generate:'使用已生成的需求 JSON 续跑；仍需原需求文本或文件作为证据。'})[phase?.value]||'';
    for(const name of ['featuresFile','candidateFile']){
      const input=form.querySelector('[name="'+name+'"]');if(input){input.closest('label').hidden=phase?.value!=='generate';input.disabled=phase?.value!=='generate';}
    }
    const resume=form.querySelector('[name="featuresFile"]')?.closest('label').parentElement;if(resume)resume.hidden=phase?.value!=='generate';
  };
  phase?.addEventListener('change',update);update();
  // Keep project preview, diagnostics and reusable knowledge inside one workspace.
  const panel=root.querySelector('.panel > .panel');if(!panel)return;
  const tabs=document.createElement('div');tabs.className='ai-result-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','生成工作区');
  const views=new Map(['results','logs','knowledge'].map(id=>{
    const view=document.createElement('section');view.id='ai-view-'+id;view.setAttribute('role','tabpanel');view.setAttribute('aria-labelledby','ai-tab-'+id);return [id,view];
  }));
  const children=[...panel.children],knowledgeHeading=children.find(x=>x.tagName==='H3'&&x.textContent==='个人知识库');let knowledge=false;
  for(const child of children){
    if(child===knowledgeHeading)knowledge=true;
    if(knowledge)views.get('knowledge').append(child);
    else if(child.matches('pre, details'))views.get('logs').append(child);
    else views.get('results').append(child);
  }
  const preview=root.querySelector('.ai-case-preview');if(preview)views.get('results').append(preview);
  const knowledgeView=views.get('knowledge'),file=knowledgeView.querySelector('#engine-knowledge-file');
  if(file){
    file.multiple=true;mountFilePicker(file);
    const actions=document.createElement('div');actions.className='ai-knowledge-actions';
    knowledgeView.querySelector('[data-engine-knowledge]').before(actions);
    actions.append(...knowledgeView.querySelectorAll('[data-engine-knowledge]'));
    actions.querySelector('[data-engine-knowledge="upload"]').textContent='导入到知识库';
    const fileLabel=document.createElement('label');fileLabel.className='ai-field ai-knowledge-upload';file.before(fileLabel);
    const pickerList=file.nextElementSibling;
    const caption=document.createElement('span');caption.className='ai-field-label';caption.textContent='知识文件';fileLabel.append(caption,file,pickerList);
    const hint=document.createElement('small');hint.className='muted';hint.textContent='支持 Markdown、TXT、XLSX、XLS，单文件不超过 5 MB。';fileLabel.append(hint);
    const status=document.createElement('p');status.id='engine-knowledge-status';status.className='ai-knowledge-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');actions.after(status);
    const updateFile=()=>{const selected=[...file.files];actions.querySelector('[data-engine-knowledge="upload"]').disabled=!selected.length;
      hint.textContent='支持 Markdown、TXT、XLSX、XLS；可分次添加，单文件 ≤ 5 MB，总上传 ≤ 10 MB。';};
    file.addEventListener('change',updateFile);updateFile();
  }
  if(!views.get('results').querySelector('.ai-case-preview, [data-engine-download]')){
    const hint=document.createElement('p');hint.className='muted';hint.textContent='尚无生成结果。提交需求后，完成的用例预览和下载会显示在这里。';views.get('results').append(hint);
  }
  if(!views.get('logs').querySelector('pre')){const hint=document.createElement('p');hint.className='muted';hint.textContent='任务启动后在这里查看运行日志和诊断文件。';views.get('logs').append(hint);}
  const activate=id=>{
    for(const [key,view] of views)view.hidden=key!==id;
    for(const button of tabs.children){const active=button.dataset.resultTab===id;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;}
    onResultTab(id);
  };
  for(const [id,title] of [['results','生成结果'],['logs','运行日志'],['knowledge','知识库']]){
    const button=document.createElement('button');button.type='button';button.id='ai-tab-'+id;button.dataset.resultTab=id;button.textContent=title;
    button.setAttribute('role','tab');button.setAttribute('aria-controls','ai-view-'+id);button.onclick=()=>activate(id);tabs.append(button);
  }
  tabs.onkeydown=event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
    const buttons=[...tabs.children],index=buttons.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowRight'?1:2))%3;
    activate(buttons[next].dataset.resultTab);buttons[next].focus();
  };
  panel.append(tabs,...views.values());activate(views.has(resultTab)?resultTab:'results');
}

function mountFilePicker(input){
  if(!input)return;
  input.onchange=null;
  let selected=[...input.files];
  const list=document.createElement('div');list.className='ai-file-list';input.after(list);
  const sync=()=>{const transfer=new DataTransfer();selected.forEach(file=>transfer.items.add(file));input.files=transfer.files;list.replaceChildren();
    selected.forEach((file,index)=>{const row=document.createElement('div'),name=document.createElement('span'),remove=document.createElement('button');name.textContent=file.name+' · '+Math.ceil(file.size/1024)+' KB';remove.type='button';remove.className='btn ghost small';remove.textContent='移除';remove.setAttribute('aria-label','移除 '+file.name);remove.onclick=()=>{selected.splice(index,1);sync();input.dispatchEvent(new Event('change',{bubbles:true}));};row.append(name,remove);list.append(row);});
    if(selected.length){const summary=document.createElement('small');summary.textContent='共 '+selected.length+' 个文件 · '+(selected.reduce((n,f)=>n+f.size,0)/1024/1024).toFixed(2)+' MB / 10 MB';list.append(summary);}
  };
  input.addEventListener('change',()=>{if(!input.files.length)selected=[];else for(const file of input.files)if(!selected.some(f=>f.name===file.name&&f.size===file.size&&f.lastModified===file.lastModified))selected.push(file);sync();});sync();
}

export function renderKnowledgeFiles(view,items,api){
  if(!view)return;
  view.querySelector(':scope > pre')?.remove();
  let list=view.querySelector('.knowledge-files');if(!list){list=document.createElement('div');list.className='knowledge-files';view.append(list);}list.replaceChildren();
  if(!items.length){list.textContent='知识库暂无文件，选择文件后点击“导入到知识库”。';return;}
  for(const item of items){const card=document.createElement('article'),title=document.createElement('strong'),meta=document.createElement('small'),button=document.createElement('button'),detail=document.createElement('div');
    title.textContent=item.name||item.path;meta.textContent=(item.category==='test_plans'?'测试方案':'测试用例')+' · '+Math.ceil(item.size/1024)+' KB · '+new Date(item.createdAt).toLocaleString('zh-CN',{hour12:false});button.type='button';button.className='btn ghost small';button.textContent='查看详情';detail.hidden=true;
    button.onclick=async()=>{if(!detail.hidden){detail.hidden=true;button.textContent='查看详情';return;}button.disabled=true;try{const data=await api('/ai/engine/knowledge/detail?path='+encodeURIComponent(item.path));detail.replaceChildren();const note=document.createElement('p');note.textContent=data.previewNote;detail.append(note);
      if(data.sheets)for(const sheet of data.sheets){const heading=document.createElement('h4'),table=document.createElement('table'),wrap=document.createElement('div');heading.textContent=sheet.name;wrap.className='knowledge-sheet';for(const row of sheet.rows){const tr=document.createElement('tr');for(const value of row){const td=document.createElement('td');td.textContent=String(value);tr.append(td);}table.append(tr);}wrap.append(table);detail.append(heading,wrap);}
      else{const text=document.createElement('pre');text.textContent=data.content;detail.append(text);}
      const download=document.createElement('a');download.className='btn ghost small';download.textContent='下载原文件';download.download=data.name;download.href='data:application/octet-stream;base64,'+data.base64;detail.append(download);detail.hidden=false;button.textContent='收起详情';
    }catch(error){detail.textContent=error.message;detail.hidden=false;}finally{button.disabled=false;}};
    card.append(title,meta,button,detail);list.append(card);
  }
}
