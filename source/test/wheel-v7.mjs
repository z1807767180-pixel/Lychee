import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Browser, until } from './browser.mjs';
import { listen } from '../server/index.mjs';

test('交给命运从两端工具箱打开，编辑分区、转动和指针结果吻合', async t => {
  if (process.env.LYCHEE_QA_EDGE_ISOLATED_HOST === '1') process.argv.push('--isolated-host');
  const dataDir = await mkdtemp(join(tmpdir(), 'lychee-wheel-test-'));
  const app = await listen({ dataDir, webRoot: process.env.LYCHEE_REVIEW_WEB });
  const browser = new Browser();
  t.after(async () => {
    await browser.close();
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  let cookie = '';
  async function post(path, body) {
    const res = await fetch(app.url + path, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: app.url, cookie },
      body: JSON.stringify(body)
    });
    assert.equal(res.status, 200);
    const login = res.headers.getSetCookie().find(value => value.startsWith('__Host-lychee-account='));
    if (login) cookie = login.split(';')[0];
    return res.json();
  }
  await post('/api/v640/account', { mode: 'register', name: '转盘试用员', password: randomBytes(20).toString('hex') });
  const { activeGardenId, notices } = await post('/api/v640/workspace', { action: 'create', name: '转盘测试园' });
  for (const notice of notices.filter(item => !item.read)) {
    await post('/api/v640/workspace', { action: 'read', noticeId: notice.id });
  }
  await browser.open();
  const [name, value] = cookie.split('=');
  await browser.call('Network.setCookie', { url: app.url + '/', name, value, path: '/', secure: true, httpOnly: true });
  async function click(selector, label) {
    const x = await until(() => browser.js(`(()=>{
      const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.offsetWidth&&!e.disabled&&(!${JSON.stringify(label || '')}||e.textContent.includes(${JSON.stringify(label || '')})));
      if(!el)return false;
      el.scrollIntoView({block:'center',behavior:'instant'});const r=el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))&&{x:r.x+r.width/2,y:r.y+r.height/2};
    })()`), label || selector).catch(async error => {
      const page = await browser.js("document.body.innerText.slice(0,600)");
      throw new Error(error.message + '\n当前页面：' + page + '\n浏览器错误：' + browser.errors.join('\n'), { cause: error });
    });
    for (const type of ['mousePressed', 'mouseReleased']) {
      await browser.call('Input.dispatchMouseEvent', { type, ...x, button: 'left', clickCount: 1 });
    }
  }
  async function fill(selector, text) {
    await browser.js(`{ const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.select(); }`);
    await browser.call('Input.insertText', { text });
  }
  const count = () => browser.js("[...document.querySelectorAll('.v7-wheel-editor li input')].filter(el=>el.value.trim()).length");
  const frameWidth = () => browser.js("document.querySelector('.v7-wheel-frame').getBoundingClientRect().width");
  async function snapshot(name) {
    if (!process.env.LYCHEE_WHEEL_EVIDENCE) return;
    await mkdir(process.env.LYCHEE_WHEEL_EVIDENCE, { recursive:true });
    await browser.js("document.querySelector('.ph-scroll.v7-tool').scrollTo(0,0);document.fonts.ready.then(()=>true)");
    const shot = await browser.call('Page.captureScreenshot',{format:'png'});
    await writeFile(join(process.env.LYCHEE_WHEEL_EVIDENCE, name+'.png'), Buffer.from(shot.data,'base64'));
  }
  const views = [
    ['mobile', '/mobile/', 390, 844], ['narrow', '/mobile/', 324, 690], ['windows', '/windows/workspace.html', 984, 698]
  ];
  for (const [view, entry, width, height] of views) {
    const mobile = view !== 'windows';
    await browser.size(width, height, mobile);
    await browser.call('Page.navigate', { url: app.url + entry + '?garden=' + activeGardenId });
    await click(mobile ? 'nav.bottom button' : '.windows-nav button', mobile ? '工具箱' : '全部工具');
    await click('.toolbox-shortcuts button', '交给命运');
    await until(() => browser.js("document.querySelector('.v7-wheel-spin')?.offsetWidth"), '打开转盘');
    assert.equal(await count(), 4);
    assert.equal(await browser.js('document.documentElement.scrollWidth <= innerWidth'), true);
    const initialDiameter = await frameWidth();
    assert.equal(Math.abs(initialDiameter - await browser.js("document.querySelector('.v7-wheel-frame').getBoundingClientRect().height")) < 1, true);
    await until(() => browser.js("document.querySelector('.v7-wheel-banner').naturalWidth>0"), '已批准的转盘横幅');
    assert.equal(await browser.js("document.querySelector('.v7-wheel-editor ol').getBoundingClientRect().height"), 0);
    await snapshot(view + '-initial');
    await fill('.v7-wheel-topic input', '周末去哪玩？');
    await click('.v7-wheel-add');
    assert.equal(await count(), 4, '空行不占扇区');
    await fill('.v7-wheel-editor li:last-child input', '东湖');
    assert.equal(await count(), 5);
    await click('.v7-wheel-editor li:nth-child(2) button');
    assert.equal(await count(), 4);
    await click('.v7-wheel-editor li:nth-child(2) button');
    assert.equal(await count(), 3);
    await browser.js(`{
      const native = crypto.getRandomValues.bind(crypto);
      window.wheelSamples = [4294967295, 2, 0, 1];
      crypto.getRandomValues = values => {
        if (values instanceof Uint32Array && values.length===1 && window.wheelSamples.length) {
          values[0]=window.wheelSamples.shift();return values;
        }
        return native(values);
      };
    }`);
    for (const [turn, winner] of [2, 0, 1].entries()) {
      await browser.call('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: turn ? 'reduce' : 'no-preference' }]
      });
      await click('.v7-wheel-spin');
      if (turn === 0) {
        assert.equal(await browser.js("document.querySelector('.v7-wheel-disc').getAnimations().length > 0"), true);
        assert.equal(await browser.js("document.querySelector('.v7-wheel-add').disabled"), true);
      }
      await until(() => browser.js("document.querySelector('.v7-wheel-result').textContent.startsWith('选中了')"), '显示选择');
      const actual = await browser.js(`(()=>{
        const disc=document.querySelector('.v7-wheel-disc'),matrix=new DOMMatrix(getComputedStyle(disc).transform);
        const labels=[...disc.querySelectorAll('span')].map(e=>e.textContent);
        const degrees=(360 - Math.atan2(matrix.b,matrix.a)*180/Math.PI)%360;
        const pointerIndex=Math.floor(degrees * labels.length/360);
        return {pointerIndex,expected:'选中了「'+labels[pointerIndex]+'」',result:document.querySelector('.v7-wheel-result').textContent};
      })()`);
      assert.equal(actual.pointerIndex, winner);
      assert.equal(actual.result, actual.expected);
    }
    // Grow the real editor with its own add button/input events, including two identical long options.
    const long = '周末和朋友一起去东湖散步看落日，傍晚到书店挑一本书。'.repeat(5);
    for (const size of [8, 16, 40, 100]) {
      await browser.js(`(async()=>{
        const frame=()=>new Promise(r=>setTimeout(r,0));
        const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
        for(let index=document.querySelectorAll('.v7-wheel-editor li').length;index<${size};index++){
          document.querySelector('.v7-wheel-add').click();await frame();
          const el=document.querySelector('.v7-wheel-editor li:last-child input');
          set.call(el,index===${size}-2||index===${size}-1 ? ${JSON.stringify(long)} : '选项'+(index+1));
          el.dispatchEvent(new Event('input',{bubbles:true}));await frame();
        }
      })()`);
      assert.equal(await count(), size);
      const measures = await browser.js(`(()=>{
        const list=document.querySelector('.v7-wheel-editor ol'), wheel=document.querySelector('.v7-wheel-frame').getBoundingClientRect();
        const labels=[...document.querySelectorAll('.v7-wheel-label')];
        const exterior=document.querySelector('.v7-tool'),outerScroll=exterior.scrollTop;
        list.scrollTop=0;list.scrollTop=list.scrollHeight;
        const deltas=[...document.querySelector('.v7-wheel-disc').style.backgroundImage.matchAll(/([0-9.]+)deg/g)].map(x=>Number(x[1]));
        return {w:wheel.width,h:wheel.height,listHeight:list.clientHeight,scrollHeight:list.scrollHeight,
          font:Math.min(...labels.map(e=>parseFloat(getComputedStyle(e).fontSize))),
          scrollsIndependently:list.scrollTop>0 && exterior.scrollTop===outerScroll,
          equalSectors:Array.from({length:${size}},(_,i)=>360*(i+1)/${size}).every(end=>deltas.some(x=>Math.abs(x-end)<.02)),
          labels:labels.map(e=>e.textContent),pageFits:document.documentElement.scrollWidth<=innerWidth};
      })()`);
      assert.ok(Math.abs(measures.w-initialDiameter)<1 && Math.abs(measures.h-initialDiameter)<1);
      assert.ok(measures.listHeight<=230 && measures.scrollHeight>measures.listHeight);
      assert.ok(measures.font>=11 && measures.pageFits && measures.scrollsIndependently && measures.equalSectors);
      if (size>=40) {
        assert.ok(measures.labels.length<size);
        assert.ok(measures.labels.every(label=>/^\d+$/.test(label)));
      }
      await browser.js('window.wheelSamples.push('+ (size-1) +','+(size-1)+')');
      for(let repeat=0;repeat<2;repeat++){
        await click('.v7-wheel-spin');
        await until(()=>browser.js("document.querySelector('.v7-wheel-result').textContent.startsWith('选中了第 "+size+" 项')"),'完整结果及重复选项编号');
        assert.equal(await browser.js("document.querySelector('.v7-wheel-result').textContent"), '选中了第 '+size+' 项「'+long+'」');
        const stopped = await browser.js(`(()=>{
          const matrix=new DOMMatrix(getComputedStyle(document.querySelector('.v7-wheel-disc')).transform);
          const pointer=Math.floor(((360-Math.atan2(matrix.b,matrix.a)*180/Math.PI)%360)*${size}/360);
          return [pointer,document.querySelector('.v7-wheel-editor li[aria-current] .v7-wheel-key').textContent];
        })()`);
        assert.deepEqual(stopped, [size-1,String(size)]);
      }
      if(size===100) await snapshot(view+'-100');
    }
    await browser.js(`(async()=>{
      while(document.querySelectorAll('.v7-wheel-editor li').length>3){
        document.querySelector('.v7-wheel-editor li:last-child button').click();
        await new Promise(r=>setTimeout(r,0));
      }
    })()`);
    await click('.v7-wheel-editor li:last-child button');
    await click('.v7-wheel-editor li:last-child button');
    assert.equal(await count(), 1);
    assert.equal(await browser.js("document.querySelector('.v7-wheel-spin').disabled"), true);
    await click('.v7-wheel-editor li:last-child button');
    assert.equal(await count(), 0);
  }
  assert.deepEqual(browser.errors, []);
});
