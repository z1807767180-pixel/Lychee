import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {Browser,until} from './browser.mjs';
import {listen} from '../server/index.mjs';

test('照记饮食：手机上传、包装标签、真实库换算、桌面读取与半份修改',async t=>{
  const visionBefore=process.env.LYCHEE_ENABLE_DIET_VISION;
  process.env.LYCHEE_ENABLE_DIET_VISION='0';
  t.after(()=>{if(visionBefore===undefined)delete process.env.LYCHEE_ENABLE_DIET_VISION;
    else process.env.LYCHEE_ENABLE_DIET_VISION=visionBefore;});
  if(process.env.LYCHEE_QA_EDGE_ISOLATED_HOST==='1')process.argv.push('--isolated-host');
  const dataDir=await mkdtemp(join(tmpdir(),'lychee-diet-ui-'));
  const app=await listen({dataDir,webRoot:process.env.LYCHEE_REVIEW_WEB});
  const browser=new Browser();
  t.after(async()=>{await browser.close();await app.close();await rm(dataDir,{recursive:true,force:true});});
  let cookie='';
  async function post(path,body) {
    const res=await fetch(app.url+path,{method:'POST',headers:{origin:app.url,cookie,'content-type':'application/json'},body:JSON.stringify(body)});
    assert.equal(res.status,200);
    const token=res.headers.getSetCookie().find(s=>s.startsWith('__Host-lychee-account='));
    if(token)cookie=token.split(';')[0];
    return res.json();
  }
  await post('/api/v640/account',{mode:'register',name:'手帐试用',password:randomBytes(18).toString('hex')});
  const ws=await post('/api/v640/workspace',{action:'create',name:'手帐测试园'});
  for(const n of ws.notices.filter(n=>!n.read))await post('/api/v640/workspace',{action:'read',noticeId:n.id});
  await browser.open();
  const [name,value]=cookie.split('=');
  await browser.call('Network.setCookie',{url:app.url+'/',name,value,path:'/',secure:true,httpOnly:true});
  const run=(fn,...args)=>browser.js('('+fn.toString()+')('+args.map(JSON.stringify).join(',')+')');
  const click=(scope,text)=>until(()=>run((sel,name)=>{
    const btn=[...document.querySelectorAll(sel)].find(b=>b.offsetWidth&&!b.disabled&&b.textContent.trim().includes(name));
    if(!btn)return false;btn.click();return true;
  },scope,text),text);
  async function openPage(mobile) {
    await browser.size(mobile?390:984,800,mobile);
    await browser.call('Page.navigate',{url:app.url+(mobile?'/mobile/':'/windows/workspace.html')+'?garden='+ws.activeGardenId});
    await click(mobile?'nav.bottom button':'.windows-nav button',mobile?'工具箱':'全部工具');
    await click('.toolbox-shortcuts button','照记饮食');
    await until(()=>browser.js("document.querySelector('.diet-v7-add')?.disabled===false"),'手帐加载完成');
  }
  const text=()=>browser.js("document.querySelector('.diet-v7').innerText");
  const btn=label=>click('.diet-v7 button',label);
  const fill=(label,value)=>run((name,val)=>{
    const node=[...document.querySelectorAll('.diet-v7-edit label')].find(l=>l.firstChild.textContent===name)?.querySelector('input');
    if(!node)throw Error('缺少字段 '+name);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,val);
    node.dispatchEvent(new Event('input',{bubbles:true}));
  },label,value);
  await openPage(true);
  assert.equal(await browser.js("document.querySelector('.diet-v7-banner').naturalWidth"),644);
  assert.equal(await browser.js("document.querySelector('nav.bottom')?.getBoundingClientRect().height>0"),true);
  await btn('记一餐');
  // Use a geometric synthetic image only to test local photo decoding and cutout.
  const uploadTestPhoto=()=>browser.js(`(async()=>{
    const canvas=document.createElement('canvas');canvas.width=120;canvas.height=100;
    const c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,120,100);c.fillStyle='brown';c.beginPath();c.arc(60,50,30,0,2*Math.PI);c.fill();
    const file=new File([await new Promise(r=>canvas.toBlob(r,'image/png'))],'test.png',{type:'image/png'});
    const dt=new DataTransfer();dt.items.add(file);const input=document.querySelector('.diet-v7 input[type=file]:not([capture])');
    input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await uploadTestPhoto();
  await until(async()=>(await text()).includes('照片识别尚未启用'),'未配置时可手动记录');
  assert.equal(await browser.js(`(async()=>{const img=document.querySelector('.diet-v7-preview');await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return c.width<120 && ctx.getImageData(0,0,1,1).data[3]===0;})()`),true);
  await fill('添加食物','白馒头');
  await btn('白馒头');
  await btn('吃了半份');
  await btn('保存这一餐');
  await until(async()=>(await text()).includes('124 千卡'),'白馒头 50 克 124 千卡');
  await openPage(false);
  await click('.diet-v7-sticker','白馒头');
  await btn('吃了半份');
  await btn('保存这一餐');
  await until(async()=>(await text()).includes('62 千卡'),'桌面修改后 25 克 62 千卡');
  await btn('记一餐');
  await btn('按包装标签添加');
  await fill('商品名称','标签样品');await fill('能量','60');await fill('蛋白质（克）','3');
  await fill('碳水（克）','6');await fill('脂肪（克）','2');
  await btn('添加到这餐');await btn('保存这一餐');
  await until(()=>browser.js("document.querySelector('.diet-v7-summary strong')?.textContent==='122'"),'按标签新增后当天合计 122');
  await openPage(true);
  assert.equal(await browser.js("document.querySelector('.diet-v7-summary strong').textContent"),'122');
  await click('.diet-v7-report-toggle','周报');
  await until(()=>browser.js("document.querySelector('.diet-v7-report .diet-v7-summary strong')?.textContent==='122'"),'七天周报汇总两餐');
  assert.equal(await browser.js("document.querySelectorAll('.diet-v7-report-day').length"),7);
  await click('.diet-v7-report-day','2 餐 · 122 千卡');
  await until(()=>browser.js("document.querySelectorAll('.diet-v7-sticker').length===2"),'从周报返回对应餐页');
  await btn('记一餐');await fill('添加食物','地三鲜盖饭');await click('.diet-v7-recipes button','地三鲜盖饭');
  const readRows=()=>browser.js("Array.from(document.querySelectorAll('.diet-v7-row')).map(row=>[row.querySelector('strong')?.textContent,Number(row.querySelector('input[type=number]')?.value)])");
  const dishRows=await readRows();
  assert.deepEqual(dishRows,[['土豆',50],['茄子',50],['青椒',50],['食用油',5],['豆瓣酱',2.5],['生抽',5],['白米饭',150]]);
  await btn('保存这一餐');await until(()=>browser.js("document.querySelector('.diet-v7-summary strong')?.textContent==='435'"),'原配方加常规熟白饭 313 千卡');
  await openPage(false);await click('.diet-v7-sticker','地三鲜盖饭');
  await browser.js("Array.from(document.querySelectorAll('.diet-v7-row')).find(row=>row.querySelector('strong')?.textContent==='白米饭').querySelector('.diet-v7-portion button').click()");
  assert.deepEqual(await readRows(),[...dishRows.slice(0,-1),['白米饭',75]]);
  await btn('保存这一餐');
  await until(()=>browser.js("document.querySelector('.diet-v7-summary strong')?.textContent==='338'"),'只改饭后整餐为 216 千卡');
  // Feed a deliberate duplicate recognition response through the real editor.
  // All non-vision traffic continues to use the authenticated local server.
  await browser.js(`{
    const realFetch=window.fetch;
    window.fetch=(url,opts)=>String(url).startsWith('/api/v7/diet/recognize?')?Promise.resolve(Response.json({
      title:'盖饭称重验证',items:[{kind:'component',partOf:'plate',name:'地三鲜',grams:320},
        {kind:'component',partOf:'plate',name:'食用油',grams:8,basis:'oil_consumed'},
        {kind:'component',partOf:'plate',name:'熟米饭',grams:100,basis:'cooked'},
        {kind:'dish',ref:'plate',name:'地三鲜盖饭',grams:470,basis:'cooked',ingredients:[
          {name:'土豆',grams:40,basis:'raw_edible'},{name:'茄子',grams:190,basis:'cooked'}]}]
    })):realFetch(url,opts);
  }`);
  await btn('记一餐');await uploadTestPhoto();
  await until(()=>browser.js("document.querySelectorAll('.diet-v7-row').length===7"),'视觉重复报菜、饭、油时只记录一组食材');
  const measured=new Map(await readRows());
  assert.equal(measured.get('土豆'),40);assert.equal(measured.get('食用油'),8);assert.equal(measured.get('白米饭'),100);
  assert.notEqual(measured.get('茄子'),190,'熟茄子的克数不能直接写进生料项目');
  const portionLabel='整盘可食净重（克）';
  async function setPortion(value){
    await fill(portionLabel,String(value));
  }
  const kcal=()=>browser.js("parseFloat(document.querySelector('.diet-v7-macros strong').textContent)");
  await setPortion(200);const small=await kcal();
  await setPortion(400);const large=await kcal();
  assert.ok(Math.abs(large-small*2)<=1&&small>0,`200g=${small} kcal, 400g=${large} kcal`);
  t.diagnostic(`盖饭所选配料与油量的页面读数：200 克 ${small} 千卡，400 克 ${large} 千卡`);
  await btn('保存这一餐');
  await until(()=>browser.js("!!document.querySelector('.diet-v7-add')"),'保存称重盖饭');
  await openPage(true);await click('.diet-v7-sticker','盖饭称重验证');
  assert.equal(await kcal(),large);
  assert.equal(await run(label=>Number([...document.querySelectorAll('label')].find(l=>l.firstChild.textContent===label).querySelector('input').value),portionLabel),400);
  await btn('补油 / 拌酱');
  await fill('实际吃了多少克','9');await btn('更新克数');
  const corrected=await readRows();
  assert.equal(corrected.filter(([name])=>name==='食用油').length,1);assert.equal(new Map(corrected).get('食用油'),9);
  assert.equal(await run(label=>Number([...document.querySelectorAll('label')].find(l=>l.firstChild.textContent===label).querySelector('input').value),portionLabel),400);
  await btn('返回');await btn('记一餐');
  await browser.js(`{
    const original=window.fetch;
    window.fetch=(url,opts)=>String(url).startsWith('/api/v7/diet/recognize?')?Promise.resolve(Response.json({
      title:'品牌饮料',items:[{kind:'packaged',brand:'样品牌',name:'酸奶饮品',amount:180,unit:'ml'}]
    })):original(url,opts);
  }`);
  await uploadTestPhoto();
  await until(()=>browser.js("document.querySelector('.diet-v7-row strong')?.textContent.includes('样品牌')"),'无标签包装保留品牌供核对');
  assert.equal(await browser.js("document.querySelector('.diet-v7-save').disabled && !document.querySelector('.diet-v7-macros')"),true);
  await click('.diet-v7-row button','填写本品标签');
  await fill('能量','42');await fill('蛋白质（克）','1.5');await fill('碳水（克）','6.3');await fill('脂肪（克）','1.2');
  await btn('应用到这项');assert.equal(await kcal(),76);
  assert.equal((await readRows()).length,1);
  await btn('保存这一餐');await btn('记一餐');
  await fill('添加食物','自选麻辣烫');await btn('按食材记「自选麻辣烫」');
  await fill('查找这道菜里的食材','水煮西兰花');await click('.diet-v7-split-results button','水煮西兰花');
  await fill('水煮西兰花（克）','40');
  await fill('查找这道菜里的食材','熟长粒米饭');await click('.diet-v7-split-results button','熟白米饭（长粒）');
  await fill('熟白米饭（长粒）（克）','125');await btn('采用这些食材');
  assert.deepEqual(await readRows(),[['水煮西兰花',40],['熟白米饭（长粒）',125]]);
  assert.equal(await kcal(),177);
  await btn('保存这一餐');await btn('记一餐');
  await browser.js(`{
    const previous=window.fetch;
    window.fetch=(url,opts)=>String(url).startsWith('/api/v7/diet/recognize?')?Promise.resolve(Response.json({
      title:'手动核对食材',items:[{kind:'food',name:'深色食物小块',grams:60,basis:'unknown'}]
    })):previous(url,opts);
  }`);
  await uploadTestPhoto();
  await until(()=>browser.js("document.querySelector('.diet-v7-row strong')?.textContent==='深色食物小块'"),'保留不明食物');
  await fill('替换食物','去皮烤鸡胸');
  await browser.js(`{const s=document.querySelector('.diet-v7-row select');s.value='usda-05064';s.dispatchEvent(new Event('change',{bubbles:true}));}`);
  assert.equal((await readRows())[0][1],60);
  await fill('添加食物','大豆油');await click('.diet-v7-options button','大豆油');
  await browser.js(`{const n=document.querySelectorAll('.diet-v7-portion input')[1];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'2');n.dispatchEvent(new Event('input',{bubbles:true}));}`);
  assert.deepEqual((await readRows()).map(r=>r[1]),[60,2]);
  assert.equal(await kcal(),117);
  await btn('保存这一餐');await btn('记一餐');await fill('添加食物','扬州炒饭');
  await click('.diet-v7-options button','扬州炒饭（新加坡食阁）');
  assert.equal((await readRows())[0][1],100,'库中实测份重不会自动当成用户吃下的量');
  await btn('388克');assert.equal((await readRows())[0][1],388);
  await btn('吃了半份');assert.equal((await readRows())[0][1],194);assert.equal(await kcal(),346);
  await btn('保存这一餐');await btn('记一餐');
  await browser.js(`{
    const previous=window.fetch;
    window.fetch=(url,opts)=>String(url).startsWith('/api/v7/diet/recognize?')?Promise.resolve(Response.json({
      title:'蔬菜净重验收',items:[{kind:'dish',name:'菠菜叶配胡萝卜丝',grams:80,basis:'cooked',
        ingredients:[{name:'菠菜',grams:70,basis:'cooked'},{name:'胡萝卜丝',grams:10,basis:'cooked'}]}]
    })):previous(url,opts);
  }`);
  await uploadTestPhoto();await until(async()=>await kcal()===20,'未经校正的照片估算');
  await setPortion(40);assert.equal(await kcal(),10);
  await btn('补油 / 拌酱');await browser.js("document.querySelector('.diet-v7-edit fieldset input[type=checkbox]').click()");
  await fill('查找食用油','橄榄油');
  await browser.js(`{const s=[...document.querySelectorAll('fieldset label')].find(l=>l.firstChild.textContent==='具体食用油').querySelector('select');s.value='tfda-M2700101';s.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await fill('实际吃了多少克','7.757576');await btn('添加这份');
  assert.equal(await kcal(),76);const withOil=await readRows();
  assert.equal(withOil.length,3);assert.ok(Math.abs(withOil.reduce((sum,r)=>sum+r[1],0)-40)<.02);
  assert.equal(withOil.at(-1)[1],7.76);await btn('保存这一餐');
  assert.equal(await browser.js("document.documentElement.scrollWidth<=innerWidth"),true);
  const errors=browser.errors.filter(e=>!e.includes('ResizeObserver loop'));
  assert.deepEqual(errors,[]);
});
