import {requireThat, uuid} from './acceptance-flow.mjs';

// This exercise is limited to the private garden recorded by this release's pilot.
export async function verifyMemberEditing({session, users, name, preparation, gardenId}) {
  requireThat(preparation.state === 'ready' && uuid(gardenId) &&
    preparation.gardenId === gardenId && uuid(preparation.ownerAccountId), 'member-pilot-garden');
  const workspace = '/api/v640/workspace';
  async function signIn(index) {
    const call = session();
    const user = users[index];
    await call('/api/v640/account', {mark:'member-login', body:{mode:'login', name:user.name, password:user.password}});
    const state = await call(workspace);
    requireThat(state.account?.username === user.name, 'member-pilot-user');
    return {call, state};
  }
  function onlyGarden(state, role) {
    const garden = state.gardens?.[0];
    requireThat(state.gardens?.length === 1 && garden?.id === gardenId &&
      state.activeGardenId === gardenId && garden.role === role, 'member-pilot-membership');
    return garden;
  }
  const owner = await signIn(0), member = await signIn(1), outsider = await signIn(2);
  requireThat(owner.state.account.id === preparation.ownerAccountId && outsider.state.gardens?.length === 0, 'member-pilot-participants');
  onlyGarden(owner.state,'owner');
  const garden = onlyGarden(member.state,'member');
  const revised = name + '·共编', subtitle = '朋友们共同编辑';
  requireThat(garden.name === name || garden.name === revised, 'member-pilot-name');
  const edit = {action:'edit',gardenId,name:revised,subtitle,revision:garden.revision};
  await outsider.call(workspace,{mark:'outside-edit',body:edit,expected:403});
  await outsider.call(workspace,{mark:'outside-invite',body:{action:'invite',gardenId},expected:403});
  await outsider.call(workspace,{mark:'outside-rotate',body:{action:'rotateInvite',gardenId},expected:403});
  if (garden.name !== revised || garden.subtitle !== subtitle) {
    await member.call(workspace,{mark:'member-edit',body:edit});
  }
  const previous = await member.call(workspace,{mark:'member-invite',body:{action:'invite',gardenId}});
  const next = await member.call(workspace,{mark:'member-rotate',body:{action:'rotateInvite',gardenId}});
  requireThat(typeof previous.inviteCode === 'string' && typeof next.inviteCode === 'string' &&
    next.inviteCode.length > 20 && previous.inviteCode !== next.inviteCode,'member-pilot-invite');
  const observed = onlyGarden(await owner.call(workspace),'owner');
  const fresh = onlyGarden((await signIn(1)).state,'member');
  requireThat([observed,fresh].every(g => g.name === revised && g.subtitle === subtitle),'member-pilot-readback');
  return {members:true, outsidersBlocked:true};
}
