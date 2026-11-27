"""Compose the V8.1 tool views around the UI handlers in the verified release inputs."""
from pathlib import Path

HERE = Path(__file__).resolve().parent


def change(source, old, new):
    if source.count(old) != 1:
        raise ValueError("Tool view source changed: " + old[:90])
    return source.replace(old, new)


def clock_ledger(source):
    source = change(source, 'function open(row) {\n    setError("");setDraft(row?',
                    'function open(row,entryKind="expense") {\n    setError("");setDraft(row?')
    source = change(source, 'label:"",kind:"expense",category:"餐饮",day:selected',
                    'label:"",kind:entryKind,category:entryKind==="income"?incomeCats[0]:expenseCats[0],day:selected')
    source = change(source, 'h("button",{className:"solid",onClick:()=>open(null)},"＋ 记一笔")',
                    'h("button",{className:"solid",onClick:()=>open(null,"expense")},"记支出"),h("button",{onClick:()=>open(null,"income")},"记收入")')
    source = change(source, 'h("div",{className:"ledger-header"},h("h2",{},"本月支出")',
                    'h("div",{className:"ledger-header"},h("small",null,month.replace("-"," 年 ")+" 月"),h("h2",{},"本月支出")')
    source = change(source, 'h("p",{className:"focus-total"},data?"今日已完成 "+daily.rounds+" 轮 · "+daily.minutes+" 分钟":"读取计时中…")',
                    '''h("section",{className:"s81-focus-count"},h("div",{className:"s81-line-head"},h("h3",null,"今日专注"),h("button",{onClick:()=>setTab("专注记录")},"查看记录 ›")),
                       data?h("div",{className:"s81-totals"},h("span",null,h("b",null,daily.rounds)," 个番茄"),h("span",null,h("b",null,daily.minutes)," 分钟")):h("p",null,"读取计时中…"))''')
    return source


def tasks(source):
    start=source.index("h('div',{className:'v61-hero v61-notes-hero'},")
    end=source.index("h('div',{className:'v61-row v61-chipline'},",start)
    original=source[start:end]
    assistant=original[original.index("h('section',{className:'v61-card'},"):]
    assistant=change(assistant,"h('section',{className:'v61-card'},h('h3',null,'✦ AI 快速创建')",
                     "h('details',{className:'v61-card s81-ai-task'},h('summary',null,'AI 快速创建')")
    source=change(source,original,"""h('div',{className:'s81-date-hero'},h('div',null,h('small',null,new Date().getMonth()+1+' 月'),h('strong',null,new Date().getDate()),h('small',null,new Date().toLocaleDateString('zh-CN',{weekday:'long'}))),
      h('div',null,h('h2',null,'今天要做的事'),h('p',null,state.data?'还有 '+all.filter(x=>x.kind==='task'&&!x.done&&x.due&&dayKey(x.due)===today).length+' 件今日待办':'正在读取…')),
      h('img',{src:'/mobile/ai-icon-write.webp',alt:''})),
      h('div',{className:'s81-task-actions'},btn('＋ 新建提醒',newTask,'v61-primary'),btn(calendar?'收起日历':'日历',()=>{C(!calendar);SEL('')},'v61-pill')),
      """+assistant)
    source=change(source,"rows.sort((a,b)=>Number(a.done)-Number(b.done)||(a.due||Infinity)-(b.due||Infinity)||(b.created-a.created));",
        """const dueGroup=t=>t.due?dayKey(t.due):'undated',tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);
        rows.sort((a,b)=>dueGroup(a).localeCompare(dueGroup(b))||Number(a.done)-Number(b.done)||(a.due||Infinity)-(b.due||Infinity)||(b.created-a.created));""")
    # Preserve all filters, repeat rules and edits while grouping the visible real tasks by due date.
    source=change(source, "rows.map(x=>{const r=ruleOf(x);return h('article'", """rows.map((x,index)=>{
        const key=dueGroup(x);
        const heading=key===today?'今天':key===dayKey(tomorrow)?'明天':key==='undated'?'未设提醒日期':new Date(x.due).toLocaleDateString('zh-CN',{month:'long',day:'numeric'});
        const r=ruleOf(x);return h(React.Fragment,{key:x.id},(!index||dueGroup(rows[index-1])!==key)&&h('h3',{className:'s81-task-group'},heading),h('article'""")
    source=change(source, "id:x.id}))}))) }),state.data&&!rows.length", "id:x.id}))})))) }),state.data&&!rows.length")
    return change(source,",btn(calendar?'列表':'日历',()=>{C(!calendar);SEL('')},'v61-pill')","")


def ai(source):
    greeting="h('h2',{className:'a62-greeting'},'你好，我是你的 AI 助手 ♡')"
    source=change(source,greeting,"h('h2',{className:'a62-greeting'},art('chat-tile'),'有什么想聊的？')")
    source=change(source,"h('p',{className:'a62-lead'},'我可以陪你聊天、解答问题、提供建议，\\n也能帮你写文案、整理思路和制定计划～'),h('h3',{className:'a62-section-title'},'✦ 你可以试试：'),","")
    source=change(source,"h('div',{className:'a624-prompt'},\n        h('textarea'",
                  "h('div',{className:'a624-prompt'},h('label',{className:'s81-prompt-label',htmlFor:'s81-image-prompt'},art('image-tile'),'画面描述'),\n        h('textarea'")
    source=change(source,"h('textarea',{ref:textarea,rows:2,value:prompt","h('textarea',{id:'s81-image-prompt',ref:textarea,rows:2,value:prompt")
    source=change(source,"body = h(React.Fragment,null,\n      h('div',{className:'a624-prompt'}",
                  "body = h('section',{className:'s81-atelier'},art('image-hero',{className:'s81-atelier-art'}),\n      h('div',{className:'a624-prompt'}")
    # Put both mode toggles and submit inside the same composer as its actual controlled textarea.
    start=source.index("h('div',{className:'a62-modes'},btn('深度思考'")
    end=source.index("h('small',{className:'a62-disclaimer'}",start)
    composer=source[start:end]
    form=composer.index("h('form',{className:'a62-composer'")
    send=composer.index("h('button',{className:'a62-send'")
    modes=composer[:form].removesuffix('),')
    field=composer[form:send].replace("className:'a62-composer'","className:'s81-chat-compose'")
    submit=composer[send:].removesuffix('),').replace("'➤'","'发送'")
    source=change(source,composer,field+modes+','+submit+')),')
    return source


def diet(source):
    start=source.index("    return wrap(h('img',{className:'diet-v7-banner'")
    end=source.index('\n  }\n  w.LycheeDietV7',start)
    return change(source,source[start:end],(HERE/'tool-diet-view.js').read_text(encoding='utf8'))
