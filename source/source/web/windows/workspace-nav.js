'use strict';

// The phone's shared detail opener also receives an empty ID for the app's Back button.
// A primary-tab or sidebar selection resets the stack before opening its destination.
window.lycheeWorkspaceDetail = function (pages, destination) {
  if (!destination) {
    pages.pop();
    return pages.at(-1) || '';
  }
  if (pages.at(-1) !== destination) pages.push(destination);
  return destination;
};

// Each destination invokes the mobile shell's own tab and detail handlers.
window.renderLycheeWorkspaceNav = function ({React, tab, detail, selectTab, openDetail, restartDetail}) {
  const h = React.createElement;
  const sections = [
    ['荔圈', '聊', [['荔圈首页', '']]],
    ['荔枝园', '园', [['荔枝园首页', ''], ['园中事', 'feed'], ['问一问', 'question'], ['约定倒计时', 'goal']]],
    ['工具箱', '箱', [['全部工具', ''], ['荔枝树', 'tree'], ['AI 助手', 'ai-chat'], ['AI 生图', 'ai-image'],
      ['五子棋', 'gomoku'], ['海龟汤', 'soup'], ['脑筋急转弯', 'riddles']]],
    ['我', '我', [['个人主页', ''], ['提醒事项与记事', 'tasks'], ['个人资料', 'profile'], ['通知中心', 'notifications'],
      ['我的账本', 'ledger'], ['番茄钟', 'focus'], ['设置', 'settings']]]
  ];
  return h('nav', {className: 'windows-nav', 'aria-label': '桌面工作台导航'},
    sections.map(([name, targetTab, links]) => h('section', {key: name},
      h('h2', null, name),
      links.map(([label, target]) => h('button', {
        key: label, type: 'button', 'data-page': target || targetTab,
        'aria-current': (target ? detail === target : tab === targetTab && !detail) ? 'page' : undefined,
        onClick: () => {
          if (target && target === detail) restartDetail();
          selectTab(targetTab);
          if (target) openDetail(target);
        }
      }, label))
    ))
  );
};
