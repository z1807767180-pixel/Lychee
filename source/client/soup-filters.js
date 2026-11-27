function SoupFilters({genre,setGenre,data,busy,start}) {
  const h=Ze.createElement;
  const [level,setLevel]=Ze.useState('all');
  const choices=[['all','全部难度'],['easy','简单'],['medium','中等'],['hard','困难']];
  const count=data.counts?.[genre]?.[level];
  return h(Ze.Fragment,null,
    h('label',null,'题型',h('select',{'aria-label':'题型',value:genre,onChange:e=>setGenre(e.target.value)},
      data.filters.map(name=>h('option',{key:name,value:name},name==='全部'?'全部题型':name)))),
    h('label',null,'难度',h('select',{'aria-label':'难度',value:level,disabled:!data.counts,onChange:e=>setLevel(e.target.value)},
      choices.map(([key,label])=>h('option',{key,value:key},label)))),
    typeof count==='number'&&h('small',{role:'status'},count?'可抽 '+count+' 道':'这个组合暂时没有题'),
    h('button',{disabled:busy||count===0,onClick:()=>start('start',{filter:genre,difficulty:level})},'抽题开局'));
}
