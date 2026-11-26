import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const context = { window: {} };
for (const file of ['diet-foods-v7.js', 'diet-match-v7.js']) {
  runInNewContext(await readFile(new URL('../client/' + file, import.meta.url), 'utf8'), context);
}
const catalog = context.window.LycheeDietFoodsV7;
const { single, search } = context.window.LycheeDietMatchV7;
const id = (name, basis, foods = catalog, cooking) => single(name, basis, foods, cooking)?.id ?? null;
const item = (id, name, basis, aliases = []) => ({ id, name, basis, aliases });

test('真实食品条目：米饭、米粒、鲜干菌菇、湿干面按各自的重量口径核对', () => {
  assert.equal(id('白饭', 'cooked'), 'usda-20445');
  assert.equal(id('熟白米饭', 'cooked'), 'usda-20445');
  assert.equal(search('米饭',catalog,1)[0].id,'usda-20445');
  assert.equal(single('白米饭','cooked',catalog).kcal * 81 / 100,105.3);
  assert.equal(id('白米饭','cooked',catalog,'电锅少水煮'),'tfda-A0550601');
  assert.equal(id('电锅白饭（米加1.1倍水）','cooked'),'tfda-A0550601');
  assert.equal(id('少水牛肉炒米饭','cooked'),null);
  assert.equal(id('米饭', 'raw_edible'), null);
  assert.equal(id('白米饭', 'dry'), null);
  assert.equal(id('粳米', 'dry'), 'tfda-A05002');
  assert.equal(id('粳米', 'cooked'), null);
  assert.equal(id('干面条', 'dry'), 'tfda-R2000101');
  assert.equal(id('干面条', 'cooked'), null);
  assert.equal(id('荞麦面(湿)'), 'tfda-R2001502');
  assert.equal(id('干荞麦面', 'dry'), 'tfda-R2001501');
  assert.equal(id('荞麦面(湿)', 'dry'), null);
  assert.equal(id('鲜香菇', 'raw_edible'), 'tfda-G08001');
  assert.equal(id('干香菇', 'dry'), 'tfda-G0810101');
  assert.equal(id('泡发干香菇', 'cooked'), null);
  assert.equal(id('乾木耳平均值','dry'), 'tfda-G01101');
});

test('实库照片匹配保留做法、皮骨和油的身份', () => {
  assert.equal(id('去皮烤鸡胸肉', 'cooked'), 'usda-05064');
  assert.equal(id('带皮烤鸡胸肉', 'cooked'), 'usda-05060');
  assert.equal(id('带皮烤鸡', 'cooked'), 'usda-05009');
  assert.equal(id('去皮鸡肉', 'cooked',catalog,'烤'), 'usda-05013');
  assert.equal(id('鸡蛋','cooked',catalog,'炒'),'usda-01132');
  assert.equal(id('炒鸡蛋','oil_consumed'),null);
  assert.equal(id('无油炒鸡蛋','cooked'),null);
  assert.equal(id('炒鸡蛋','cooked',catalog,'不放油'),null);
  assert.equal(id('烤鸡胸肉（去皮）', 'raw_edible'), null);
  assert.equal(id('带骨牛小排','raw_edible'), 'tfda-I0100102');
  assert.equal(id('去骨牛小排','raw_edible'), 'tfda-I0100101');
  assert.equal(id('去骨牛小排','cooked'), null);
  assert.equal(id('生土豆','raw_edible'), 'tfda-B0700201');
  assert.equal(id('水煮马铃薯','cooked'), 'usda-11367');
  assert.equal(id('菜籽油','oil_consumed'), 'tfda-M1800101');
  assert.equal(id('橄榄油','oil_consumed'), 'tfda-M2700101');
  assert.equal(id('茄子','oil_consumed'), null);
  assert.equal(id('菜籽油','cooked'), null);
});

test('无标签品牌、整道菜和包含相同字的不同食物不自动套用某一基础食品', () => {
  for (const name of ['样例品牌草莓酸奶', '牛肉焖土豆', '不认识的果冻牌子', '橄榄油沙丁鱼拌饭']) {
    assert.equal(id(name), null, name);
  }
  assert.equal(id('香蕉片', 'raw_edible'), null);
  assert.equal(id('水煮土豆泥','cooked'), null);
  assert.equal(id('土豆','raw_edible'), 'tfda-B0700201');
  assert.equal(search('土豆',catalog,20).some(f=>f.name.includes('花生')),false);
});

test('同名冲突需要补充口径，不受资料排列顺序影响', () => {
  const rows = [
    item('dry', '甲面条', 'dry', ['甲面']),
    item('cooked', '甲面条', 'cooked', ['甲面']),
    item('oat1', '纯燕麦', 'dry'), item('oat2', '纯燕麦', 'dry')
  ];
  for (const foods of [rows, [...rows].reverse()]) {
    assert.equal(id('甲面条',undefined,foods),null);
    assert.equal(id('甲面','cooked',foods),'cooked');
    assert.equal(id('甲面','dry',foods),'dry');
    assert.equal(id('纯燕麦','dry',foods),null);
    assert.equal(id('甲面','unknown-new-basis',foods),null);
  }
});

test('独立做法字段核对样品制法，同一道食材按正确口径选择', () => {
  assert.equal(id('鸡胸肉','cooked',catalog,'去皮后用烤箱烤熟'),'usda-05064');
  assert.equal(id('鸡胸肉','raw_edible',catalog,'去皮后用烤箱烤熟'),null);
  assert.equal(id('去皮烤鸡胸肉','cooked',catalog,'油炸'),null);
  assert.equal(id('鸡胸肉','cooked',catalog,'先油炸后烘烤'),null);
  assert.equal(id('西兰花','cooked',catalog,'煮'),'usda-11091');
  assert.equal(id('米饭','cooked',catalog,'水煮'),'usda-20445');
  const foods = [
    { ...item('poached','鸡块','cooked'), cookingNote:'样品状态:熟,水煮; 前处理描述:去皮打碎' },
    { ...item('braised','红烧鸡块','cooked'), cookingNote:'前处理描述:水煮后打碎' },
    item('panfried','香煎鸡块','cooked'),
    item('frozen','带皮香蕉','frozen_packaged'),
    item('raw','鸡块','raw_edible')
  ];
  assert.equal(id('鸡块','cooked',foods,'白煮'),'poached');
  assert.equal(id('鸡块','cooked',foods,'焖煮'),'braised');
  assert.equal(id('鸡块','cooked',foods,'煎制'),'panfried');
  assert.equal(id('鸡块','cooked',foods,'去皮水煮'),null);
  assert.equal(id('带皮香蕉','as_eaten',foods),null);
});

test('搜索按简体名、部位、加工方法排序，并保留原条目与来源', () => {
  assert.equal(search('西兰花',catalog,1)[0]?.id,'tfda-E5800402');
  assert.equal(search('水煮 西兰花',catalog,1)[0]?.id,'usda-11091');
  assert.equal(search('小黄瓜',catalog,1)[0]?.id,'tfda-E6400201');
  assert.equal(search('小黄瓜',catalog,20).some(f=>f.name.includes('小黄鱼')),false);
  assert.equal(search('去皮 烤鸡胸肉',catalog,1)[0]?.id,'usda-05064');
  assert.equal(search('白馒头',catalog,1)[0],catalog.find(f=>f.id==='tfda-R2400201'));
  assert.equal(search('',catalog,3).length,3);
  assert.equal(search('米饭',catalog,0).length,0);
  assert.equal(search('完全未知的食品名称',catalog,9).length,0);
});

test('普通液态奶的检索区分脂肪档位、调味和奶粉；未说明脂肪只给候选', () => {
  for (const word of ['牛奶','鲜奶','鲜牛奶','纯牛奶']) {
    const names = Array.from(search(word,catalog,15), f => f.name);
    assert.equal(names[0], '全脂鲜乳平均值');
    assert.ok(names.includes('低脂鲜乳'));
    assert.ok(names.every(name => !/奶粉|调味|发酵|巧克力|凤梨/.test(name)));
    assert.equal(id(word,'as_eaten'),null);
  }
  assert.equal(id('全脂牛奶','as_eaten'),'tfda-L01021');
  assert.equal(search('全脂鲜牛奶',catalog,1)[0]?.id,'tfda-L01021');
  assert.equal(id('低脂牛奶','as_eaten'),'tfda-L0106101');
  assert.equal(id('中脂奶','as_eaten'),'tfda-L0104101');
  assert.equal(search('脱脂牛奶',catalog,1)[0]?.name.startsWith('脱脂'),true);
  assert.equal(id('脱脂牛奶','as_eaten'),null); // Only fortified samples for this category.
  assert.equal(id('某牌全脂牛奶','as_eaten'),null);
});

test('可乐饮料和可乐饼分开，普通宫保鸡丁可以搜索，美式餐馆样品仅按明确限定直配', () => {
  assert.ok(search('可乐',catalog,15).every(food => !food.name.includes('可乐饼')));
  assert.equal(search('可乐',catalog,1)[0].id,'usda-14148');
  assert.equal(id('含糖可乐','as_eaten'),'usda-14148');
  assert.equal(search('零糖可乐',catalog,1)[0].id,'usda-14073');
  assert.equal(id('Zevia可乐','as_eaten'),'usda-14073');
  assert.equal(id('某牌无糖可乐','as_eaten'),null);
  assert.ok(search('可乐饼',catalog,5).some(food => food.name.includes('可乐饼')));
  const american = catalog.find(food => food.id === 'usda-36619');
  for (const name of ['宫保鸡丁', '宫爆鸡丁']) {
    assert.equal(search(name,catalog,5)[0],american);
    assert.equal(id(name,'cooked',[{...american, aliases:[name]}]),null);
    assert.equal(id(name,'cooked'),null);
  }
  assert.equal(id('美式中餐馆宫保鸡丁','cooked'),american.id);
  assert.equal(id('美式宫爆鸡丁','cooked'),american.id);
});

test('普通切形不改用油或熟重，能生吃的食材按可食部分匹配', () => {
  assert.equal(id('橙子','as_eaten'),'usda-09200');
  assert.equal(id('黄瓜','as_eaten'),'tfda-E6400101');
  assert.equal(id('小番茄','as_eaten'),'tfda-E74004');
  assert.ok(search('黄瓜',catalog,15).every(f=>!f.name.includes('黄鱼')));
  assert.equal(id('熟马铃薯块','cooked'),'usda-11367');
  assert.equal(id('熟土豆块','cooked',catalog,'煮或烤'),'usda-11367');
  assert.equal(id('熟土豆块','cooked',catalog,'水煮或油炸'),null);
  assert.equal(id('牛小排','as_eaten'),null);
  assert.equal(id('菠萝块','raw_edible'),id('菠萝','raw_edible'));
  assert.ok(id('哈密瓜块','raw_edible'));
  assert.ok(id('蓝莓','raw_edible'));
  assert.ok(id('生菜','raw_edible'));
  assert.equal(id('嫩菠菜叶','raw_edible'),'tfda-E5000101');
  for (const name of ['苹果片','切片苹果','新鲜苹果薄片']) {
    assert.equal(id(name,'raw_edible'),'usda-09003');
  }
  assert.equal(id('苹果片',undefined),null);
  for (const name of ['烘干苹果片','冻干苹果片','苹果脆片','苹果蜜饯','薯片','烤熟苹果片']) {
    assert.equal(id(name,'raw_edible'),null);
  }
  for (const word of ['深色食物小块','熟鱼肉块','混合莓果（树莓和黑莓）','脆炸马铃薯片']) {
    assert.equal(id(word,'cooked'),null);
  }
});

test('已熟配菜、酱和奶酪按餐盘所报状态；分不清的食材留给人工', () => {
  const samples = [
    ['熟菜花','usda-11136'], ['嫩菠菜','usda-11458'], ['胡萝卜丝','usda-11125'],
    ['青椒','usda-11334'], ['煎培根','usda-10862'], ['面包丁','usda-18242'],
    ['马苏里拉奶酪','usda-01026'], ['番茄酱','usda-11549'], ['披萨饼底','no-05.062']
  ];
  for (const [name,expected] of samples) assert.equal(id(name,'cooked'),expected,name);
  assert.equal(id('帕玛森奶酪','as_eaten'),'usda-01033');
  assert.notEqual(id('番茄酱','as_eaten'),'usda-11549');
  assert.equal(id('牛肉粒','cooked'),null);
  assert.equal(id('切片熟牛肉','cooked'),null);
  assert.equal(id('混合莓果（树莓和黑莓）','as_eaten'),null);
  assert.notEqual(id('披萨','cooked'),'no-05.062');
});
