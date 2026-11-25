'use strict';

// Both original sharing dialogs submit a normal team-chat note. Resolve the same
// signed-in roster that supplies the sender fields when composing in the chat room.
window.shareLycheeTeamNote = async function (text, send) {
  const response = await fetch('/api/camp?roster=lychee', {
    cache: 'no-store',
    signal: AbortSignal.timeout(6000)
  });
  if (!response.ok) throw Error(response.status === 401 ? '请重新登录荔枝' : '无法读取小队成员，请重试');
  const roster = await response.json();
  const member = roster.members.find(person => person.id === roster.me);
  if (!member) throw Error('找不到当前小队成员，请重新登录');
  await send('/api/camp', {
    type: 'note', key: crypto.randomUUID(), name: member.name, avatar: member.avatar,
    body: text.slice(0, 200)
  });
  window.dispatchEvent(new Event('lychee-team-note-saved'));
};
