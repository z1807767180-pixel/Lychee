/* Match the food identity independently of portion size. No nutritional value is inferred here. */
(() => {
  'use strict';
  const indices = new WeakMap();
  // Everyday names for primary reference samples. Keep the displayed official name and ID.
  const sampleAliases = {
    'tfda-D36001': ['橙子', '鲜橙'],
    'tfda-D11002': ['菠萝', '凤梨'],
    'tfda-D5000101': ['蓝莓'],
    'tfda-D2000302': ['哈密瓜'],
    'tfda-D20001': ['蜜瓜'],
    'tfda-E53001': ['生菜'],
    'tfda-E75001': ['青椒'],
    'tfda-E74004': ['小番茄', '圣女果', '樱桃番茄'],
    'tfda-E74001': ['番茄'],
    'usda-20445': ['米饭', '白饭', '白米饭', '熟米饭', '熟白米饭']
  };
  const lowWater = /少水|1[.]1倍/;
  const noOil = /(?:不|未)(?:另)?(?:加|放|用)油|无油|零油/;
  const plainRiceName = /^(?:电锅|少水|白米饭|白饭|米饭|熟|加|水|米|倍|1[.]1|[(),])+$/;
  const bases = new Set(['raw_edible', 'dry', 'cooked', 'as_eaten', 'oil_consumed']);
  const spellings = [
    [/乾/g, '干'], [/麵/g, '面'], [/飯/g, '饭'], [/雞/g, '鸡'], [/鮮/g, '鲜'],
    [/濕/g, '湿'], [/馬鈴薯|马铃薯/g, '土豆'], [/西紅柿|西红柿|蕃茄/g, '番茄'],
    [/青花菜|西蘭花/g, '西兰花'], [/高麗菜|高丽菜|卷心菜/g, '甘蓝'],
    [/義大利麵|义大利面/g, '意大利面'], [/優格|优格/g, '酸奶'],
    [/鳳梨|凤梨/g, '菠萝'], [/奇異果|奇异果/g, '猕猴桃'], [/酪梨/g, '牛油果'],
    [/不含皮|不带皮|不帶皮|去掉皮/g, '去皮'], [/不含骨|不带骨|不帶骨/g, '去骨'],
    [/带皮|帶皮|含皮/g, '带皮'], [/帶骨|含骨/g, '带骨'],
    [/無骨|无骨|剔骨/g, '去骨'], [/无皮|無皮|削皮/g, '去皮'],
    [/不加盐|無鹽/g, '无盐'], [/稉米/g, '粳米'], [/脫脂/g, '脱脂'],
    [/^(熟|生|水煮|清蒸)?(?:白菜花|菜花)$/, '$1花椰菜'],
    [/可樂/g, '可乐'], [/宮保|宮爆|宫爆/g, '宫保'],
    [/^美式(?:中(?:式|餐(?:馆|厅)?))?宫保鸡(?:丁)?$/, '美式中餐馆宫保鸡丁']
  ];

  function form(value) {
    let name = String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
    for (const [pattern, replacement] of spellings) name = name.replace(pattern, replacement);
    return name;
  }

  function describe(value) {
    const key = form(value);
    const milk = key.match(/^(全脂|中脂|低脂|高脂|脱脂)?(?:纯牛奶|鲜牛奶|鲜乳|鲜奶|牛奶|牛乳|奶)$/);
    let base = key.replace(/平均值|\((?:\d{4}年取样|有机)\)/g, '');
    // A knife cut changes the shape of these ingredients, while dried fruit chips,
    // crisps, croquettes and meat products keep their own identities.
    const bareSlice = /(?:苹果|梨|番茄|黄瓜|土豆|胡萝卜|菠萝|西瓜|牛肉|鸡胸肉)片$/.test(base) && !base.includes('切片');
    base = base.replace(/^切(?:成)?(?:薄片|片|块|丁|丝)(?:的)?(?=熟?牛肉|熟?土豆|苹果|梨|番茄|黄瓜|胡萝卜|菠萝|哈密瓜)/, '')
      .replace(/(土豆|苹果|梨|黄瓜|胡萝卜|番茄|鲜橙|哈密瓜|蜜瓜|菠萝|西瓜|芒果|牛肉|鸡胸肉|鱼肉)(?:小块|块|丁|粒|细丝|丝|切片|薄片|片)$/, '$1')
      .replace(/^嫩菠菜(?:叶)?$|^菠菜叶$/, '菠菜');
    const tags = {};
    const strip = (field, pattern, tag) => {
      if (pattern.test(base)) {
        tags[field] = tag;
        base = base.replace(pattern, '');
      }
    };
    strip('skin', /去皮/, 'peeled');
    strip('skin', /带皮/, 'unpeeled');
    strip('bone', /去骨/, 'boneless');
    strip('bone', /带骨/, 'bone-in');
    strip('water', /干燥|脱水|冻干|\(干\)|^干(?=面条|意大利面|荞麦面|米粉|香菇|银耳|木耳|紫菜|海带|黄花菜)/, 'dry');
    strip('water', /泡发|复水|水发|鲜湿|\(湿\)|^湿(?=面条|荞麦面|米粉)/, 'wet');
    strip('water', /新鲜|鲜(?=香菇|木耳|银耳)/, 'fresh');
    strip('method', /油炸|^炸(?=鸡|鱼|猪|豆腐|土豆)/, 'fried');
    strip('method', /水煮|白煮|^煮(?=鸡蛋|蛋|土豆|面条|西兰花)/, 'boiled');
    strip('method', /烘烤|烧烤|^烤/, 'baked');
    strip('method', /清蒸|^蒸(?=米饭|白饭|土豆|鸡胸肉)/, 'steamed');
    strip('method', /清炒|爆炒|^炒(?=鸡蛋|蛋|土豆|面条|西兰花)/, 'stir-fried');
    strip('method', /香煎|煎制|^煎(?=鸡|牛|猪|蛋|鱼|豆腐|培根)/, 'pan-fried');
    strip('method', /红烧|焖煮|炖煮/, 'braised');
    strip('thermal', /生食|生重|\(生\)|^生(?=大米|白米|粳米|面条|鸡蛋|鸡胸|牛肉|土豆|黄瓜)/, 'raw');
    strip('thermal', /熟重|煮熟|蒸熟|\(熟\)|^熟(?=的|米|白饭|白米|长粒|面条|意大利面|荞麦面|西兰花|花椰菜|鸡|土豆|菠菜|胡萝卜|牛肉|鱼肉|青椒)/, 'cooked');
    if (tags.method) tags.thermal = 'cooked';
    base = base.replace(/[()]/g, '').replace(/^的/, '');
    if (base === '白饭' || base === '白米饭') base = '米饭';
    if (base === '大米') base = '白米';
    if (base === '鸡胸') base = '鸡胸肉';
    if (['全鸡','整鸡','鸡肉'].includes(base) && tags.method === 'baked') base = '鸡';
    if (base === '蛋' && tags.method) base = '鸡蛋';
    return { key, base, tags, bareSlice, noOil:noOil.test(key), milkFat: milk ? milk[1] || '' : undefined };
  }

  function facts(food, title) {
    const name = title.key, tags = { ...title.tags };
    let basis = food.basis || undefined;
    if (!basis) {
      if (tags.thermal === 'cooked' || /米饭|白饭|馒头/.test(name)) basis = 'cooked';
      else if (tags.water === 'dry' || /^(?:白米|粳米|大米)$/.test(title.base)) basis = 'dry';
      else if ((/^tfda-M/.test(food.id) && /油/.test(name)) || /^(?:橄榄|花生|大豆|玉米|芝麻|芥花|菜籽|食用|植物)油$/.test(name)) basis = 'oil_consumed';
      else if (tags.thermal === 'raw' || /^tfda-[BDEGIJK]\d/.test(food.id) &&
        !/冷冻|腌|罐头|烟熏|肉松|脆片|果汁|果酱|果干|酱|煎|干|调味/.test(name)) basis = 'raw_edible';
    }
    if (basis === 'dry' || basis === 'raw_edible' && /^(?:粳米|白米)$/.test(title.base)) tags.water = 'dry';
    if (basis === 'wet_noodles') tags.water = 'wet';
    if (basis === 'cooked') tags.thermal = 'cooked';
    if (food.id === 'usda-20445') tags.method = 'boiled';
    if (basis === 'cooked' && typeof food.cookingNote === 'string') {
      const sample = food.cookingNote.match(/^样品状态[:：]([^;；]*)/);
      if (sample) {
        const verified = withCooking({ tags: {} }, sample[1])?.tags || {};
        for (const field of ['skin', 'bone', 'method']) {
          if (!tags[field] && verified[field]) tags[field] = verified[field];
        }
      }
    }
    if (basis === 'raw_edible') tags.thermal = 'raw';
    if (basis === 'raw_edible' && !tags.water &&
        (/菇|木耳|银耳/.test(name) || /^(?:tfda-[DE]|usda-(?:09|11))/.test(food.id))) tags.water = 'fresh';
    return { basis, tags };
  }

  function index(catalog) {
    if (indices.has(catalog)) return indices.get(catalog);
    const rows = catalog.map(food => {
      const title = describe(food.name);
      const preferred = (sampleAliases[food.id] || []).map(name => describe(name).base);
      const aliases = [...new Set([...(food.aliases || []), ...(sampleAliases[food.id] || [])])].map(describe);
      const milk = title.key.match(/^(全脂|中脂|低脂|高脂|脱脂)?(强化)?(鲜乳|保久乳|鲜奶|鲜牛奶|纯牛奶|牛奶)(平均值|\(.*\))?$/);
      return { food, title, aliases, milk, preferred, ...facts(food, title) };
    });
    indices.set(catalog, rows);
    return rows;
  }

  function permits(q, requested, row, term) {
    // A regional alias may omit a property; it must never override the sample's known state.
    const tags = { ...term.tags, ...row.tags };
    if (q.allowedMethods && !q.allowedMethods.includes(tags.method)) return false;
    for (const [field, value] of Object.entries(q.tags)) if (tags[field] !== value) return false;
    if (!requested) return true;
    if (!bases.has(requested)) return false;
    if (requested === 'dry') return tags.water === 'dry' && ['dry', 'raw_edible'].includes(row.basis);
    // A named ready-to-eat cheese or prepared tomato sauce remains that product when warmed on a dish.
    if (requested === 'cooked' && row.basis === 'as_eaten' && /奶酪|干酪|芝士|番茄酱|披萨酱|烤面包丁/.test(row.title.key)) {
      return !/粉|沙司|番茄膏|浓缩|脱水/.test(row.title.key);
    }
    if (requested === 'as_eaten') {
      if (['cooked', 'as_eaten'].includes(row.basis)) return true;
      if (row.basis && row.basis !== 'raw_edible') return false;
      // Only produce commonly weighed raw as served may use a raw vegetable record.
      if (row.basis === 'raw_edible' && /番茄|胡瓜|黄瓜|生菜|莴苣|甜椒|彩椒|胡萝卜|樱桃萝卜|西芹/.test(row.title.key)) {
        return /^tfda-E|^usda-/.test(row.food.id);
      }
      return /^tfda-[DLP]/.test(row.food.id) || row.basis === 'raw_edible' && /^usda-09/.test(row.food.id) ||
        /^(?:水果|苹果|香蕉|豆浆|牛奶|酸奶|酱油|生抽)$/.test(row.title.base);
    }
    return row.basis === requested;
  }

  function rank(q, requested, row, browse) {
    // Mainland common names that TFDA also lists as aliases of unrelated ingredients.
    if (q.base === '土豆' && /花生/.test(row.title.key) ||
        /^(?:小?黄瓜|胡瓜)$/.test(q.base) && /黄鱼/.test(row.title.key) ||
        q.key.includes('可乐') && !q.key.includes('可乐饼') && row.title.key.includes('可乐饼')) return 0;
    if (row.food.id === 'tfda-A0550601') {
      if (!q.lowWater && !lowWater.test(q.key)) return 0;
      if ((q.base === '米饭' || plainRiceName.test(q.key) && /米饭|白饭/.test(q.key)) &&
          permits(q, requested, row, row.title)) return 105;
      return 0;
    }
    if (row.food.id === 'usda-20445' && (q.lowWater || lowWater.test(q.key))) return 0;
    if (row.food.id === 'usda-11549' && q.key === '番茄酱' && (browse || requested === 'cooked') &&
        permits(q, requested, row, row.title)) return 90;
    // Imported restaurant averages are browsable by dish, but a generic photo gives no country of preparation.
    if (!browse && row.title.key.startsWith('美式中餐馆') && !q.key.startsWith('美式')) return 0;
    if (!browse && row.food.id === 'usda-14073' && !q.key.includes('zevia')) return 0;
    if (row.food.id === 'usda-01132' && q.noOil) return 0;
    if (q.milkFat !== undefined) {
      if (!row.milk || !permits(q, requested, row, row.title)) return 0;
      const [, fat = '', fortified, type, variant = ''] = row.milk;
      if (q.milkFat && q.milkFat !== fat || q.key.includes('鲜') && type === '保久乳') return 0;
      if (q.key === row.title.key) return 100;
      const standard = !fortified && type !== '保久乳' && (!variant || variant === '平均值');
      if (!browse) return standard && q.milkFat === fat ? 88 : 0;
      // Suggest the aggregate sample before monthly or fortified versions while retaining their full names.
      return 85 + (standard ? 8 : 0) + (fat === '全脂' ? 3 : 0) - (variant.startsWith('(') ? 2 : 0);
    }
    let best = 0;
    if (!browse && q.bareSlice && !['raw_edible','cooked'].includes(requested) && !q.tags.water && !q.tags.thermal &&
        q.key !== row.title.key && !row.aliases.some(term => term.key === q.key)) return 0;
    if (row.preferred.includes(q.base) && permits(q, requested, row, row.title)) best = 95;
    for (const [i, term] of [row.title, ...row.aliases].entries()) {
      if (!permits(q, requested, row, term)) continue;
      const primary = i === 0;
      if (term.key === q.key) best = Math.max(best, primary ? 100 : 80);
      else if (term.base === q.base && q.base) {
        // Removing a sample's skin, cooking or preservation qualifier is only safe if the
        // query gave a state or if this is a search suggestion the user can actively choose.
        const specified = requested || Object.keys(q.tags).length > 0;
        if (browse || specified || !Object.keys(term.tags).length) {
          const plain = !Object.keys(term.tags).length && !Object.keys(q.tags).length;
          best = Math.max(best, primary ? (plain ? 88 : term.key === q.base ? 79 : 76) : 70);
        }
      } else if (browse && q.base && (term.key.includes(q.key) || term.base.includes(q.base))) {
        best = Math.max(best, primary ? 45 : 30);
      }
    }
    return best;
  }

  function sampleYear(row) {
    return Number(row.title.key.match(/\((\d{4})年取样\)/)?.[1] || 0);
  }

  function withCooking(q, note) {
    if (typeof note !== 'string' || !note.trim()) return q;
    const text = form(note).replace(/(?:不是|没有|并非|非|未)(?:油炸|清蒸|水煮|煎制|烤制|烘烤)/g, '');
    if (/(?:或|\/)/.test(text)) {
      const choices = text.split(/(?:或者|或|\/)/).map(method => withCooking(q, method)?.tags.method);
      if (choices.length !== 2 || choices.some(m => !['boiled','steamed','baked'].includes(m))) return null;
      return { ...q, tags: { ...q.tags, thermal:'cooked' }, allowedMethods:choices };
    }
    const methods = [
      ['fried',/油炸|酥炸|炸制|^炸$/], ['boiled',/水煮|白煮|白灼|煮蛋|烹煮|^煮(?:熟)?$/],
      ['steamed',/清蒸|蒸制|蒸熟|^蒸$/], ['baked',/烧烤|烤箱|烘烤|烤制|烤熟|^烤$/],
      ['stir-fried',/清炒|爆炒|炒制|^炒$/], ['pan-fried',/香煎|煎制|煎熟|^煎$/],
      ['braised',/红烧|焖烧|焖煮|炖煮/]
    ].filter(([,pattern])=>pattern.test(text));
    if (methods.length > 1) return null;
    const tags = { ...q.tags };
    if (methods.length) {
      const method = methods[0][0];
      if (tags.method && tags.method !== method || tags.thermal === 'raw') return null;
      tags.method = method;
      tags.thermal = 'cooked';
    }
    const detail = describe(text);
    for (const field of ['skin','bone','water','thermal']) {
      const value = detail.tags[field] || (field === 'thermal' && /^生(?:食|鲜)?$/.test(text) ? 'raw' : undefined);
      if (!value) continue;
      if (tags[field] && tags[field] !== value) return null;
      tags[field] = value;
    }
    const base = tags.method === 'baked' && ['全鸡','整鸡','鸡肉'].includes(q.base) ? '鸡' : q.base;
    return { ...q, base, tags, lowWater: lowWater.test(text), noOil:q.noOil || noOil.test(text) };
  }

  function single(name, basis, catalog, cooking) {
    const q = withCooking(describe(name), cooking);
    if (!q?.base || !Array.isArray(catalog)) return null;
    let best = 0, candidates = [];
    for (const row of index(catalog)) {
      const score = rank(q, basis, row, false);
      if (score > best) { best = score; candidates = [row]; }
      else if (score && score === best) candidates.push(row);
    }
    if (candidates.length === 1) return candidates[0].food;
    if (candidates.length && candidates.every(row => sampleYear(row) &&
      row.title.key.replace(/\(\d{4}年取样\)/, '') === candidates[0].title.key.replace(/\(\d{4}年取样\)/, '') &&
      row.food.id.startsWith('tfda-') && row.basis === candidates[0].basis)) {
      const byYear = candidates.slice().sort((a,b) => sampleYear(b) - sampleYear(a));
      if (sampleYear(byYear[0]) !== sampleYear(byYear[1])) return byYear[0].food;
    }
    // Two independent databases can describe the same named food. For equivalent
    // records prefer the Chinese primary catalogue; an unresolved collision stays open.
    if (candidates.length && candidates.every(r => r.title.key === candidates[0].title.key &&
      r.basis === candidates[0].basis && JSON.stringify(r.tags) === JSON.stringify(candidates[0].tags))) {
      const primary = candidates.filter(r => r.food.id.startsWith('tfda-'));
      if (primary.length === 1) return primary[0].food;
    }
    return null;
  }

  function search(query, catalog, limit = 30) {
    if (!Array.isArray(catalog) || !(limit > 0)) return [];
    const q = describe(query);
    if (!q.key) return catalog.slice(0, limit);
    return index(catalog).map(row => ({ row, score:rank(q, null, row, true) }))
      .filter(hit => hit.score > 0)
      .sort((a, b) => b.score - a.score || Number(/腌渍|加工|罐头/.test(a.row.title.key))-Number(/腌渍|加工|罐头/.test(b.row.title.key)) ||
        sampleYear(b.row) - sampleYear(a.row) || a.row.title.key.length - b.row.title.key.length ||
        a.row.food.id.localeCompare(b.row.food.id))
      .slice(0, limit).map(hit => hit.row.food);
  }

  window.LycheeDietMatchV7 = { single, search };
})();
