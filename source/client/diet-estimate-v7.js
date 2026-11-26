/* The same mass and nutrient calculation is used by the journal and the offline evaluator. */
(function(w){
  'use strict';
  const keys=['kcal','protein','carbs','fat'];
  const normalize=name=>String(name??'').normalize('NFKC').trim().replace(/\s/g,'').toLowerCase();
  function sums(items){
    return Object.fromEntries(keys.map(key=>[key,items.reduce((sum,row)=>sum+row.grams*row.per100[key]/100,0)]));
  }
  function entryItem(food,grams){
    return {name:food.name,foodId:food.id,source:food.source,grams:grams??food.grams,
      per100:Object.fromEntries(keys.map(k=>[k,food[k]]))};
  }
  function unresolved(s){
    return {name:displayName(s),grams:s.grams??s.amount,unit:s.unit||'g',foodId:'',source:'',
      per100:{kcal:0,protein:0,carbs:0,fat:0}};
  }
  function displayName(s){
    const name=s.productName||s.name;
    return (s.brand&&!name.includes(s.brand)?s.brand+' '+name:name).slice(0,100);
  }
  function roleOf(name){
    const n=normalize(name);
    if(['米饭','白饭','白米饭','熟米饭','熟白米饭','蒸米饭'].includes(n))return 'rice';
    if(['烹调油','烹饪油','食用油','植物油','油','大豆油','花生油','菜籽油'].includes(n))return 'oil';
    return '';
  }
  function matchRecipe(name,recipes){
    const n=normalize(name);
    return recipes.find(r=>[r.name,...r.aliases].some(s=>normalize(s)===n));
  }
  function one(s,catalog,standalone=false){
    if(s.label)return {name:displayName(s),foodId:'label',source:'本品包装标签',unit:s.label.unit,
      grams:s.amount??s.grams,per100:s.label.per100};
    if(s.kind==='packaged'||s.brand||s.productName||s.unit==='ml')return unresolved(s);
    const food=w.LycheeDietMatchV7.single(s.name,s.basis,catalog,s.cooking);
    if(!food)return unresolved(s);
    const row=entryItem(food,s.grams);
    const produce=/^(tfda-[DE]|usda-(09|11))/.test(food.id);
    if(['cooked','as_eaten','oil_consumed'].includes(s.basis)||
      (standalone&&s.basis==='raw_edible'&&produce))row.servedAsWeighed=true;
    return row;
  }
  function itemBasis(part){
    if(part.nutrientBasis)return part.nutrientBasis;
    return ({rice:'cooked',oil:'oil_consumed',noodle:'dry',sauce:'as_eaten'})[part.role]||'raw_edible';
  }
  function recipeRows(recipe,catalog,{observations=[],grams,groupId=recipe.id}={}){
    const expected=recipe.cookedYieldGrams||recipe.estimatedYieldGrams;
    const measured=Number.isFinite(grams)&&grams>0;
    if(measured&&!expected){
      return observations.length?observations.map(i=>one(i,catalog)):[unresolved({name:recipe.name,grams})];
    }
    const remaining=[...observations];
    const parts=recipe.items.map(part=>{
      const food=catalog.find(f=>f.id===part.foodId);
      if(!food)throw Error('这份食谱的营养条目暂缺，请单独添加食物。');
      const aliases=[part.name,food.name,...(food.aliases||[])].map(normalize);
      const i=remaining.findIndex(a=>aliases.includes(normalize(a.name))||
        ['rice','oil'].includes(part.role)&&roleOf(a.name)===part.role);
      const seen=i<0?null:remaining.splice(i,1)[0];
      const basis=itemBasis(part);
      const factor=part.cookedWeightFactor??(['cooked','as_eaten','oil_consumed'].includes(basis)?1:undefined);
      let observed=null;
      if(seen){
        const implicit=!seen.basis||seen.basis==='unknown';
        if(seen.basis===basis||(implicit&&['rice','oil','sauce'].includes(part.role)))observed=seen.grams;
        else if(seen.basis==='cooked'&&factor>0)observed=seen.grams/factor;
      }
      return {part,food,base:part.grams,observed,factor};
    });
    const known=parts.filter(p=>p.observed!==null);
    const free=parts.filter(p=>p.observed===null);
    const extras=remaining.map(i=>{
      const row=one(i,catalog);
      if(!expected)return row;
      return {...row,recipeId:recipe.id,recipeSource:recipe.source,quantityNote:'',
        portionGroup:groupId,cookedFactor:['cooked','as_eaten','oil_consumed'].includes(i.basis)?1:0};
    });
    // Use the reference finish weight only for the fraction left after separately
    // observed edible components. Plain rice and consumed oil each contribute once.
    const contribution=p=>p.base*(p.factor??0);
    const freeWeight=expected-known.reduce((n,p)=>n+contribution(p),0);
    const accounted=known.reduce((n,p)=>n+p.observed*(p.factor??0),0);
    const extraGrams=remaining.reduce((n,i)=>n+(['cooked','as_eaten','oil_consumed'].includes(i.basis)?i.grams:0),0);
    const target=measured?grams:expected;
    const scale=measured&&freeWeight>0?Math.max(0,(target-accounted-extraGrams)/freeWeight):1;
    const measuredWeight=target-extraGrams;
    const reconcile=measured&&accounted>0&&measuredWeight>0&&(!free.length||accounted>=measuredWeight)?measuredWeight/accounted:1;
    const rows=parts.map(({part,food,base,observed,factor})=>{
      const amount=observed!==null?observed*reconcile:base*scale;
      return {...entryItem(food,amount),name:part.name||food.name,recipeId:recipe.id,recipeSource:recipe.source,
        quantityNote:part.basis||'',...(expected?{portionGroup:groupId,cookedFactor:factor??0}: {})};
    }).filter(row=>row.grams>0);
    // Rounding ingredient grams only for display keeps small seasonings intact under rescaling.
    // Assign the recipe's documented water or yield remainder across the unspecified weight.
    const cooked=rows.reduce((n,r)=>n+r.grams*(r.cookedFactor??0),0);
    if(expected&&cooked>0&&target>accounted+extraGrams&&free.length){
      const freeRows=rows.filter(r=>free.some(p=>p.part.foodId===r.foodId));
      const denominator=freeRows.reduce((n,r)=>n+r.grams*r.cookedFactor,0);
      if(denominator>0){
        const adjust=(target-accounted-extraGrams)/denominator;
        for(const row of freeRows)row.cookedFactor*=adjust;
      }
    }
    return [...rows,...extras];
  }
  function resolveItems(input,catalog,recipes){
    const matched=input.map(s=>s.label||s.brand||s.productName||s.kind==='packaged'?null:matchRecipe(s.name,recipes));
    const components=new Set(),prepared=new Map();
    const order=matched.map((recipe,i)=>({recipe,i})).filter(v=>v.recipe)
      .sort((a,b)=>(b.recipe.includes?.length||0)-(a.recipe.includes?.length||0));
    const independent=order.filter(a=>!order.some(b=>b.recipe.includes?.includes(a.recipe.id)));
    for(const {recipe,i} of order){
      if(components.has(i)||input[i].partOf)continue;
      const dish=input[i],observations=[...(dish.ingredients||[])];
      if(['dry','raw_edible'].includes(dish.basis)){
        prepared.set(i,observations.length?observations.map(v=>one(v,catalog)):[unresolved(dish)]);
        continue;
      }
      const roles=new Set(recipe.items.map(p=>p.role));
      input.forEach((s,n)=>{
        if(n===i||components.has(n)||s.label)return;
        const explicit=dish.ref&&s.partOf===dish.ref;
        if(!explicit&&(s.kind||s.ref||s.partOf||dish.kind||dish.ref))return;
        if(!explicit&&independent.length!==1)return;
        if(recipe.includes?.includes(matched[n]?.id)){
          components.add(n);
          for(const ingredient of s.ingredients||[])if(!observations.some(o=>normalize(o.name)===normalize(ingredient.name)))observations.push(ingredient);
          return;
        }
        const role=roleOf(s.name);
        if(!explicit&&(!role||!roles.has(role)))return;
        if(!explicit&&input.filter(p=>roleOf(p.name)===role).length!==1)return;
        components.add(n);
        if(!observations.some(o=>normalize(o.name)===normalize(s.name)||(role&&roleOf(o.name)===role)))observations.push(s);
      });
      const rows=recipeRows(recipe,catalog,{grams:dish.grams,observations,groupId:'dish-'+i});
      prepared.set(i,rows);
    }
    return input.flatMap((s,i)=>{
      if(components.has(i))return [];
      if(prepared.has(i))return prepared.get(i);
      if(s.label||s.brand||s.kind==='packaged')return [one(s,catalog)];
      const direct=one(s,catalog,true);
      const children=input.filter(c=>s.ref&&c.partOf===s.ref);
      if(s.partOf&&input.some(p=>p.ref===s.partOf))return [];
      const ingredients=[...(s.ingredients||[])];
      for(const child of children)if(!ingredients.some(o=>normalize(o.name)===normalize(child.name)))ingredients.push(child);
      // A dressing or the frying oil by itself does not describe an entire dish.
      // Keep the main food open for confirmation instead of counting only its condiments.
      if(ingredients.length&&ingredients.every(i=>i.basis==='oil_consumed'||/^(盐|食盐|糖|生抽|老抽|酱油|胡椒粉|沙拉酱)$/.test(i.name))){
        return [unresolved(s),...ingredients.map(p=>one(p,catalog))];
      }
      if(!ingredients.length)return [direct];
      const rawPlate=/沙拉|沙律|水果拼盘|水果碗|果盘/.test(s.name);
      const rows=ingredients.map(p=>one(p,catalog,rawPlate));
      if(rows.every(r=>r.foodId)&&ingredients.every(p=>['cooked','as_eaten','oil_consumed'].includes(p.basis))){
        return rows.map(r=>({...r,portionGroup:'dish-'+i,portionName:s.name,cookedFactor:1}));
      }
      return rows;
    });
  }
  function groupWeight(rows){return rows.reduce((total,r)=>total+Number(r.grams)*(r.cookedFactor||0),0);}
  function resizeGroup(rows,id,target){
    const weight=groupWeight(rows.filter(r=>r.portionGroup===id));
    if(!(target>0&&target<=10000&&weight>0))return rows;
    return rows.map(r=>r.portionGroup===id?{...r,grams:r.grams*target/weight}:r);
  }
  function plateWeight(rows,catalog){
    if(!rows.length)return null;
    let total=0;
    for(const r of rows){
      if(!r.foodId||r.unit==='ml'||!(Number(r.grams)>0))return null;
      if(r.portionGroup){
        if(!(r.cookedFactor>0))return null;
        total+=Number(r.grams)*r.cookedFactor;
      }else{
        const food=catalog.find(f=>f.id===r.foodId);
        if(r.recipeId||!(r.servedAsWeighed||r.foodId==='label'||['cooked','as_eaten','oil_consumed'].includes(food?.basis)||
          (food?.basis==='raw_edible'&&/^(tfda-D|usda-09)/.test(r.foodId))))return null;
        total+=Number(r.grams);
      }
    }
    return total;
  }
  function resizePlate(rows,target,catalog){
    const current=plateWeight(rows,catalog);
    if(current===null||!(target>0&&target<=10000))return rows;
    const locked=rows.filter(r=>r.portionFixed),fixed=locked.length?plateWeight(locked,catalog):0;
    if(!(target>fixed&&current>fixed))return rows;
    const ratio=(target-fixed)/(current-fixed);
    return rows.map(r=>r.portionFixed?r:{...r,grams:r.grams*ratio});
  }
  w.LycheeDietEstimateV7={sums,entryItem,recipeRows,resolveItems,groupWeight,resizeGroup,plateWeight,resizePlate};
})(window);
