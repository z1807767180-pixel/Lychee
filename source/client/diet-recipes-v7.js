/* One editable portion per recipe. Ingredient grams use the state of the
 * referenced food row; their sum is not a measured cooked serving weight. */
(() => {
  'use strict';

  const vegetableSource = 'https://cookidoo.com.cn/recipes/recipe/zh-hans-cn/r98267';
  const tomatoEggSource = 'https://28147635.s21i.faiusr.com/61/ABUIABA9GAAgxorqpAYogKzO6wc.pdf';
  const chickenSource = 'https://www.cqcdc.org/uploads/ueditor/file/20250908/1757303566432039.pdf';
  const noodleSource = 'https://www.nhc.gov.cn/sps/c100087/202604/a69d2fce21e040dc96cbc40b923a06d3/files/附件5.成人肌少症食养指南（2026年版）.pdf';

  const yieldSource = 'https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html';
  // Japanese Standard Tables supplement: prepared grams per 100 g edible raw
  // ingredient. For stir-fries, subtract the reported lipid increase because
  // our recipe already has an editable consumed-oil row.
  const cookedWeightFactors = {
    B0700201: 0.97,   // 02019: peeled, boiled and drained potato
    E7300101: 0.717,  // 06342: stir-fried eggplant, (76 - 4.3) / 100
    E75001: 0.921,    // 06246: stir-fried sweet pepper, (96 - 3.9) / 100
    I0404501: 0.70,   // 11226: boiled, skinless chicken thigh
    E02001: 0.87,     // 06215: peeled, boiled carrot
    R2000101: 2.50    // 01051: dry Chinese-style noodles, boiled and drained
  };
  function item(code, grams, role, name, basis = '克入菜', cookedWeightFactor = cookedWeightFactors[code] ?? 1) {
    const foodId = code.includes('-') ? code : 'tfda-' + code;
    return {foodId, grams, role, name, basis, cookedWeightFactor};
  }

  // One quarter of the measured four-serving vegetable recipe. Cooking water
  // contributes no energy or macros and no final yield was reported.
  function disanxian() {
    return [
      item('B0700201', 50, 'vegetable', '土豆'),
      item('E7300101', 50, 'vegetable', '茄子'),
      item('E75001', 50, 'vegetable', '青椒'),
      item('M1100101', 5, 'oil', '食用油', '克吃下的油'),
      item('P1004101', 2.5, 'sauce', '豆瓣酱'),
      item('P0700401', 5, 'sauce', '生抽')
    ];
  }
  const vegetableNotes = '原方为少油做法，锅内总用油20克，按四份分摊，以大豆油匹配。改用油炸做法时，把该项改为这份菜实际吃下的油量；锅中剩油不计入。';

  const drainedVegetables = '按沥去多余汤汁后的食材估算。土豆参考去皮煮熟；茄子和青椒参考油炒并扣除表中新增脂肪，吃下的油另计。原方四份加水100克，未称出锅余汁。';
  // Only the complete tomato-and-egg batch was weighed. Allocate its net cooking
  // loss proportionally between the two fresh ingredients for individual edits.
  const tomatoEggFactor = (505 - 22 - 4.5 - 3) / (417 + 152);
  window.LycheeDietRecipesV7 = [
    {
      id: 'recipe-disanxian',
      name: '地三鲜', aliases: ['地三鮮', '东北地三鲜', '少油地三鲜'],
      source: vegetableSource, portionBasis: 'Cookidoo 地三鲜配方的四分之一',
      notes: vegetableNotes, yieldBasis: drainedVegetables, items: disanxian()
    },
    {
      id: 'recipe-disanxian-rice',
      name: '地三鲜盖饭', aliases: ['地三鲜盖浇饭', '地三鮮蓋飯', '地三鲜饭'],
      source: vegetableSource, portionBasis: '一份地三鲜，另配熟白饭',
      notes: vegetableNotes + '熟米饭150克为荔枝的可调起始量，原菜谱未包含米饭。',
      yieldBasis: drainedVegetables + '米饭按称得的熟重直接相加。',
      includes: ['recipe-disanxian'],
      items: [...disanxian(), item('usda-20445', 150, 'rice', '白米饭', '克熟饭')]
    },
    {
      id: 'recipe-braised-chicken',
      name: '红烧鸡块', aliases: ['紅燒雞塊', '土豆红烧鸡块'],
      source: chickenSource, portionBasis: '卫健委 2023 年食养指南夏秋季食谱 3 的一小份配菜',
      notes: '指南给出鸡腿肉、胡萝卜和土豆的生料克数。荔枝按去皮去骨腿肉匹配，另设可改的大豆油3克、生抽3克和红砂糖2克；指南未指定本菜油糖酱用量。带骨外卖应按吃下的可食肉折算。',
      yieldBasis: '以湿热烹调的去皮鸡腿肉、去皮煮土豆和胡萝卜的重量变化估算；按吃下的油和调料计重，未另计盘底汤汁。',
      items: [
        item('I0404501', 50, 'meat', '鸡腿肉', '克去骨净肉'), item('E02001', 20, 'vegetable', '胡萝卜'),
        item('B0700201', 20, 'vegetable', '土豆'), item('M1100101', 3, 'oil', '食用油', '克吃下的油'),
        item('P0700401', 3, 'sauce', '生抽'), item('N0100301', 2, 'sauce', '红砂糖')
      ]
    },
    {
      id: 'recipe-tomato-egg',
      name: '番茄炒蛋', aliases: ['番茄炒鸡蛋', '西红柿炒鸡蛋', '西红柿炒蛋', '蕃茄炒蛋', '番茄炒雞蛋', '西紅柿炒蛋', '西紅柿炒雞蛋'],
      source: tomatoEggSource, yieldSource: tomatoEggSource,
      portionBasis: '武汉满堂红菜品试验公开范本，杨巍于2020年10月15日称量。默认取整锅的一半。',
      notes: '原方净番茄417克、去壳蛋液152克、姜葱花生油22克、盐4.5克、味精3克。按花生油和单一成分味精标签计算，可改吃下的油。',
      yieldBasis: '实测整锅熟菜505克。仅单独修改配料时，按两种鲜食材的净投料比例分摊出锅失重。',
      cookedYieldGrams: 252.5,
      items: [
        item('E7400101', 208.5, 'vegetable', '番茄', '克净番茄', tomatoEggFactor),
        item('K01001', 76, 'egg', '鸡蛋', '克去壳蛋液', tomatoEggFactor),
        item('M1600101', 11, 'oil', '花生油', '克吃下的油'),
        item('usda-02047', 2.25, 'sauce', '食盐'),
        item('label-4711173780014', 1.5, 'sauce', '味精')
      ]
    },
    {
      id: 'recipe-hot-dry-noodles',
      name: '武汉热干面', aliases: ['热干面', '武漢熱乾麵', '熱乾麵'],
      yieldBasis: '以干中式碱面煮熟沥干的2.50倍得率估算，已含面条吸收的水；芝麻酱、葱花和生抽按拌入食用的克数相加。',
      source: noodleSource, portionBasis: '卫健委 2026 年食养指南夏季早餐示例的一小份面',
      notes: '以干面条匹配原方干面重量，芝麻酱以麻酱匹配。35克指煮前干面重量。示例同时搭配茶叶蛋和牛奶，单独吃一碗时可改面量和麻酱量。此处只计面食，额外拌油可单独添加。',
      items: [
        item('R2000101', 35, 'noodle', '面条', '克干面'), item('P1000901', 5, 'sauce', '芝麻酱'),
        item('E23001', 2, 'vegetable', '葱花'), item('P0700401', 5, 'sauce', '生抽')
      ]
    }
  ].map(recipe => {
    if (recipe.cookedYieldGrams) return recipe;
    const cookedGrams = recipe.items.reduce((sum, part) => sum + part.grams * part.cookedWeightFactor, 0);
    return {...recipe, yieldSource, estimatedYieldGrams: Math.round(cookedGrams * 1000) / 1000};
  });
})();
