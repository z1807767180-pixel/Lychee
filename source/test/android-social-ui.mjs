import assert from 'node:assert/strict';

export async function verifySocial({browser, click, until, screenshot, api, player, friend, joined, garden}) {
  const visible = text => until(()=>browser.js('document.body.innerText.includes('+JSON.stringify(text)+')'),text);
  const heading = label => until(()=>browser.js("(document.querySelector('.s8-header h1')||{}).textContent==="+JSON.stringify(label)),label);
  async function message(body) {
    await browser.js(`(()=>{const t=document.querySelector('textarea[aria-label="消息内容"]');t.value=${JSON.stringify(body)};t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click('发送');
    await visible(body);
  }
  await heading('青荔的首页');
  const start = await browser.js('performance.timeOrigin');
  assert.equal(await browser.js('window.lycheeAndroidShellVersion'),'8.0.0');
  assert.equal(await browser.js('Object.getOwnPropertyDescriptor(window,"lycheeAndroidShellVersion").writable'),false);
  await screenshot('social-home');
  await click('安卓问答验收园');
  await heading('安卓问答验收园');
  await message('安卓群内实测');
  await click('群成员');
  await visible('小桂');
  await click('加好友');
  await visible('已申请');
  const self=(await api(player,'/api/v640/workspace?client=mobile-web')).account.id;
  const social='/api/v8/social?accountId='+encodeURIComponent(joined.account.id);
  await api(friend,social,{action:'friendAccept',accountId:self});
  await click('荔圈');
  await heading('青荔的首页');
  await click('小桂');
  await heading('小桂');
  await message('安卓私聊实测');
  const dm=await api(friend,social+'&view=dm&id='+encodeURIComponent(self));
  assert.ok(dm.messages.some(item=>item.body==='安卓私聊实测'));
  const group=await api(friend,social+'&view=group&id='+encodeURIComponent(garden));
  assert.ok(group.messages.some(item=>item.body==='安卓群内实测'));
  assert.ok(!group.messages.some(item=>item.body==='安卓私聊实测'));
  await screenshot('social-private-chat');
  await click('荔圈');
  await heading('青荔的首页');
  await click('荔枝园');
  await heading('荔枝园');
  await screenshot('social-garden');
  await click('我');
  await click('设置');
  await until(()=>browser.js("!!document.querySelector('#lychee-shell-update')"),'安卓壳内更新');
  const updateLabel=await browser.js("document.querySelector('#lychee-shell-update').textContent");
  assert.match(updateLabel,/A8\.0\.0/);
  assert.equal(await browser.js('performance.timeOrigin'),start);
  return {privateMessage:true,groupMessage:true,friendConfirmation:true,homeRetained:true,updateLabel};
}
