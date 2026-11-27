    const monthPicker=h('label',{className:'s81-diet-month'},localDate(day).getFullYear()+' 年 '+(localDate(day).getMonth()+1)+' 月',
      h('input',{type:'date',value:day,'aria-label':'选择饮食日期',onChange:e=>{if(e.target.value)pickDay(e.target.value);}}));
    const weekDays=Array.from({length:7},(_,n)=>{
      const date=shift(start,n),known=weekReport?.days?.find(item=>item.date===date);
      return button(h(React.Fragment,null,h('small',null,'一二三四五六日'[n]),h('b',null,Number(date.slice(-2))),
        h('i',{'data-logged':known?known.count>0:date===day&&entries.length>0})),()=>pickDay(date),'s81-diet-day',
        {key:date,'aria-pressed':date===day,'aria-label':date});
    });
    const controls=h('div',{className:'s81-diet-calendar'},monthPicker,h('div',null,
      button('‹',()=>pickDay(shift(day,-7)),'',{'aria-label':'上一周'}),
      button('本周',()=>pickDay(today),'',{'aria-label':'回到本周今天'}),
      button('›',()=>pickDay(shift(day,7)),'',{'aria-label':'下一周'})));
    const add=button(h(React.Fragment,null,cameraMark,'拍照记一餐'),()=>{edit(null);camera.current?.click();},'diet-v7-primary diet-v7-add',{disabled:busy==='loading'});
    const diary=h(React.Fragment,null,h('section',{className:'s81-nutrition'},
      h('img',{src:'/client/diet-banner-v7.webp',alt:''}),
      h('div',{className:'s81-energy'},h('small',null,day===today?'今日摄入估算':dayLabel(day)+'摄入估算'),
        h('span',null,h('b',null,busy==='loading'||status?'…':Math.round(total.kcal)),' 千卡')),
      h('div',{className:'s81-macros'},...keys.slice(1).map(k=>h('span',{key:k},labels[k]+' ',h('b',null,busy==='loading'||status?'…':Math.round(total[k])+' g'))))),
      add,h('div',{className:'s81-line-head'},h('h3',null,'饮食记录'),h('span',null,dayLabel(day)+' · '+entries.length+' 餐')),
      busy==='loading'?h('p',{role:'status'},'正在翻开手帐…'):!entries.length&&!status?h('p',{className:'diet-v7-empty'},'这一天还没有记录'):null,
      h('div',{className:'s81-meals'},...entries.map((entry,i)=>button(h(React.Fragment,null,
        entry.photo?h('img',{src:entry.photo,alt:''}):h('i',null,i+1),h('span',null,h('b',null,entry.title),h('small',null,(entry.items||[]).map(x=>x.name).filter(Boolean).slice(0,3).join('、'))),
        h('strong',null,Math.round(sums(entry.items).kcal),' 千卡')),()=>edit(entry),'s81-meal',{key:entry.id}))),msg,
      status&&button('重新加载',()=>refresh(n=>n+1),'diet-v7-soft'));
    return wrap(controls,h('nav',{className:'s81-diet-week','aria-label':'本周七天'},...weekDays),
      showWeek?report:diary,button(showWeek?'返回日记':'查看七天周报',()=>setShowWeek(v=>!v),'diet-v7-soft',{'aria-pressed':showWeek}),
      h('small',{className:'diet-v7-note'},'热量和营养数据为估算值，仅供日常饮食记录参考。'));
