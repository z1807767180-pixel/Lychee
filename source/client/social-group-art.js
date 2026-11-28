/* A personal image becomes group artwork only after its owner confirms the preview. */
(() => {
  'use strict';
  function editor(ui,group,kind,onSave){
    if(!['avatar','hero'].includes(kind))throw Error('未知的群图片类型');
    const {h,btn}=ui,name=kind==='avatar'?'群头像':'群主图';
    const scope={accountId:ui.home.me.id,gardenId:ui.home.accountToolsGardenId,gardenName:ui.home.me.name};
    const box=h('section',null,'s8-panel s8-group-art'),actions=h('div',null,'s8-actions');
    const field=h('input'),stage=h('div'),preview=h('div'),status=h('p',null,'s8-muted');
    const dismiss=btn('关闭生图',closeGenerator,'s8-quiet');
    const ai=btn('AI 生成'+name,openGenerator,'s8-quiet');
    const upload=btn('选择本地图片',()=>field.click(),'s8-quiet');
    const save=btn('保存为'+name,commit,'s8-primary'),discard=btn('放弃这张图片',clearDraft,'s8-quiet');
    let picture='',generation=0,unmount=null,observer=null,saving=false;
    status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    field.type='file';field.accept='image/*';field.hidden=true;dismiss.hidden=true;
    actions.append(upload,field,ai,dismiss);
    box.append(h('h3',name),actions,stage,preview,status);
    function controls(){
      ai.disabled=saving||!dismiss.hidden;upload.disabled=saving;field.disabled=saving;
      save.disabled=saving;discard.disabled=saving;
    }
    function closeGenerator(){
      generation++;
      if(observer){observer.disconnect();observer=null;}
      if(unmount){unmount();unmount=null;}
      stage.replaceChildren();dismiss.hidden=true;controls();
    }
    function clearDraft(){picture='';preview.replaceChildren();status.textContent='';}
    function showDraft(value){
      if(typeof value!=='string'||value.length>384000||!value.startsWith('/9j/'))throw Error('暂时无法读取这张图片');
      picture=value;
      const image=h('img');image.alt=name+'待保存预览';image.src='data:image/jpeg;base64,'+value;
      image.style.cssText=kind==='avatar'?'display:block;width:84px;height:84px;border-radius:50%;object-fit:cover':
        'display:block;width:100%;max-height:240px;object-fit:cover;border-radius:12px';
      const buttons=h('div',null,'s8-actions');buttons.append(save,discard);
      preview.replaceChildren(h('h4',name+'预览'),image,buttons);status.textContent='';
    }
    field.addEventListener('change',async()=>{
      const file=field.files&&field.files[0];field.value='';if(!file||saving)return;
      closeGenerator();
      const token=generation;status.textContent='正在读取图片…';
      try{
        if(file.size>32*1024*1024)throw Error('请选择小于 32 MB 的图片');
        const value=await window.LycheeSocialChat.compress(file);
        if(box.isConnected&&generation===token&&!saving)showDraft(value);
      }catch(error){if(box.isConnected&&generation===token)status.textContent=error.message;}
    });
    async function openGenerator(){
      if(saving||!dismiss.hidden)return;
      const token=++generation;dismiss.hidden=false;controls();status.textContent='正在打开生图…';
      // Leaving group settings must stop the old page's polling; a pending receipt
      // lives in personal storage and can be resumed from the original image tool.
      observer=new MutationObserver(()=>{if(!box.isConnected)closeGenerator();});
      observer.observe(document.documentElement,{childList:true,subtree:true});
      try{
        const tools=window.LycheeSocialTools,runtime=await tools.loadRuntime();
        if(!box.isConnected||generation!==token)return;
        const node=h('div',null,'s8-direct-tool garden-app');node.dataset.dest='ai-image';
        node.dataset.skin=box.closest('.s8')?.dataset.skin||'orchard';stage.append(node);
        unmount=runtime({dest:'ai-image',scope,node,window:tools.scopedWindow(scope),
          imageRatio:kind==='avatar'?'1:1':'16:9',open:closeGenerator,
          wallpaper:async value=>{
            if(box.isConnected&&generation===token&&!saving){
              showDraft(value);closeGenerator();save.focus();
            }
          }});
        status.textContent='';
      }catch(error){
        if(generation===token){closeGenerator();status.textContent=error.message||'暂时无法打开生图';}
      }
    }
    async function commit(){
      if(!picture||saving||!box.isConnected)return;
      saving=true;closeGenerator();status.textContent='正在保存'+name+'…';
      try{
        await onSave(picture);
        if(box.isConnected){clearDraft();status.textContent=name+'已保存';}
      }catch(error){if(box.isConnected)status.textContent=error.message||'未能保存，请重试';}
      finally{saving=false;controls();}
    }
    return box;
  }
  window.LycheeGroupArt={editor};
})();
