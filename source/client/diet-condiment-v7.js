/* Record only the amount of oil or sauce the person actually ate. */
(function (w) {
  'use strict';
  const GROUPS = { oil:'食用油', sauce:'酱料' };
  const normalized = name => String(name || '').normalize('NFKC').replace(/\s/g, '').replace(/蕃茄/g, '番茄');
  const oils = /^(?:油|食用油|植物油|烹饪油|烹调油|炒菜油|色拉油|大豆油|橄榄油|花生油|菜籽油|香油|芝麻油|玉米油|葵花籽油|猪油|黄油)$/;
  const sauces = /^(?:酱|酱料|蘸料|拌酱|拌料|生抽|老抽|蚝油|美乃滋|蛋黄酱|芝麻酱|麻酱|沙拉酱|凯撒沙拉酱|番茄酱|酱油|蛋黄沙拉酱|辣椒酱|花生酱|甜面酱|豆瓣酱)$/;

  function kindOf(food) {
    const name = normalized(food.name);
    if (/^tfda-M/.test(food.id) || food.basis === 'oil_consumed' || oils.test(name)) return 'oil';
    if (/^tfda-P/.test(food.id) && /酱|醋|蚝油|美乃滋/.test(name) || sauces.test(name) ||
        ['usda-06152','usda-11549','usda-43015'].includes(food.id)) return 'sauce';
    return '';
  }

  function rowKind(row, catalog) {
    const food = catalog.find(f => f.id === row.foodId);
    // A whole prepared dish may contain fat or dressing, but is never an editable oil/sauce row.
    return kindOf(food || {name:row.name});
  }

  function applyChange(items, catalog, change) {
    if (!Array.isArray(items) || !Array.isArray(catalog) || !change || !Object.hasOwn(GROUPS,change.kind)) return items;
    const {kind, target, foodId, grams, extra} = change;
    if (!Number.isFinite(grams) || grams < 0 || grams > 10000) return items;
    const adding = target === 'add';
    const row = Number.isInteger(target) && target >= 0 ? items[target] : null;
    if (adding ? (extra !== true || grams === 0 || items.length >= 24) : (!row || rowKind(row,catalog) !== kind)) return items;
    if (!adding && grams === 0) return items.filter((_,i) => i !== target);
    const same = row && row.foodId && (!foodId || row.foodId === foodId) && row.unit !== 'ml';
    const food = catalog.find(f => f.id === foodId);
    if (!same && (!food || kindOf(food) !== kind)) return items;
    const updated = same ? {...row, grams} : {...row, ...w.LycheeDietEstimateV7.entryItem(food,grams), unit:'g'};
    updated.portionFixed = true;
    if (adding) return [...items, {...updated, servedAsWeighed:true}];
    return items.map((item,i) => i === target ? updated : item);
  }

  function Condiment({React,items,catalog,onChange,disabled = false}) {
    const h = React.createElement, {useState} = React;
    const [open,setOpen] = useState(false), [kind,setKind] = useState('oil');
    const [target,setTarget] = useState(''), [foodId,setFood] = useState('');
    const [selectedRow,setSelectedRow] = useState(null);
    const [amount,setAmount] = useState(''), [query,setQuery] = useState(''), [extra,setExtra] = useState(false);
    const existing = items.map((row,i) => ({row,i})).filter(({row}) => rowKind(row,catalog) === kind);
    const index = target !== '' && target !== 'add' ? Number(target) : null;
    const row = existing.find(r => r.i === index)?.row;
    const changed = index !== null && row !== selectedRow;
    const adding = target === 'add';
    const canKeep = row && row.foodId && row.unit !== 'ml';
    const available = React.useMemo(() => catalog.filter(f => kindOf(f) === kind), [catalog,kind]);
    const hits = query.trim() ? w.LycheeDietMatchV7.search(query,available,30) : available;
    const food = available.find(f => f.id === foodId);
    const options = food && !hits.includes(food) ? [food,...hits] : hits;
    const grams = amount.trim() === '' ? NaN : Number(amount);
    const valid = !disabled && !changed && target !== '' && Number.isFinite(grams) && grams >= 0 && grams <= 10000 &&
      (adding ? extra && food && grams > 0 && items.length < 24 : row && (grams === 0 || food || canKeep));
    const btn = (title,fn,off = false) => h('button',{type:'button',className:'diet-v7-soft',disabled:disabled || off,onClick:fn},title);

    function selectTarget(value) {
      const item = value !== 'add' && value !== '' ? items[Number(value)] : null;
      setTarget(value);
      setSelectedRow(item);
      setFood(item && item.unit !== 'ml' && catalog.some(f => f.id === item.foodId) ? item.foodId : '');
      setAmount(item && item.unit !== 'ml' && Number(item.grams)>0 ? String(+Number(item.grams).toFixed(3)) : '');
      setQuery(''); setExtra(false);
    }

    function chooseKind(next) {
      setKind(next);
      const rows = items.map((r,i) => rowKind(r,catalog) === next ? i : -1).filter(i=>i>=0);
      selectTarget(rows.length === 1 ? String(rows[0]) : rows.length ? '' : 'add');
    }

    if (!open) return btn('补油 / 拌酱',() => {chooseKind('oil'); setOpen(true);});
    const opt = (value,label) => h('option',{value,key:value},label);
    return h('fieldset',{className:'diet-v7-split',disabled},
      h('legend',null,'补油 / 拌酱'),
      h('label',null,'类型',h('select',{value:kind,onChange:e=>chooseKind(e.target.value)},
        ...Object.entries(GROUPS).map(([value,label])=>opt(value,label)))),
      h('label',null,'记到哪一项',h('select',{value:target,onChange:e=>selectTarget(e.target.value)},
        !target && opt('','选择已有记录'),
        ...existing.map(({row:r,i})=>opt(String(i),'第 '+(i+1)+' 项 · '+r.name+' · '+r.grams+(r.unit==='ml'?' 毫升':' 克'))),
        opt('add','另外吃的一份'))),
      target !== '' && h(React.Fragment,null,
        changed && h('p',{role:'status'},'这项记录刚有改动，请重新选择。'),
        adding && h('label',null,h('input',{type:'checkbox',checked:extra,onChange:e=>setExtra(e.target.checked)}),
          '确认这份油或蘸酱还没算进原菜'),
        h('label',null,'查找'+GROUPS[kind],h('input',{value:query,onChange:e=>setQuery(e.target.value),
          placeholder:kind==='oil'?'例如橄榄油':'例如沙拉酱'})),
        h('label',null,'具体'+GROUPS[kind],h('select',{value:foodId,onChange:e=>setFood(e.target.value)},
          opt('',canKeep?'沿用原记录':'请选择'),...options.map(f=>opt(f.id,f.name)))),
        h('label',null,'实际吃了多少克',h('input',{type:'number',min:adding ? 0.01 : 0,max:10000,step:'any',inputMode:'decimal',
          value:amount,placeholder:'填实际克数',onChange:e=>setAmount(e.target.value)}))),
      btn(!adding && grams===0 ? '移除这项' : adding ? '添加这份' : '更新克数',()=>{
        const next = applyChange(items,catalog,{kind,target:adding?'add':index,foodId,grams,extra});
        if(next!==items){onChange(next);setOpen(false);}
      },!valid),btn('取消',()=>setOpen(false)));
  }
  Condiment.applyChange = applyChange;
  w.LycheeDietCondimentV7 = Condiment;
})(window);
