const levels=['easy','medium','hard'];
export const genres=['日常','悬疑','喜剧','推理','幻想'];
const related = [
  ['幻想',/科幻/], ['喜剧',/幽默/], ['悬疑',/悬疑|事故/],
  ['推理',/科学|策略|观察|空间|暗号|数字/], ['日常',/经典|温和|情感|视角/]
];

export function soupCategories(cards){
  const counts=Object.fromEntries(['全部',...genres].map(g=>[g,{all:0,easy:0,medium:0,hard:0}]));
  const byId=new Map();
  for(const card of cards){
    if(!levels.includes(card.difficulty))throw Error('Unknown soup difficulty: '+card.id);
    const labels=genres.filter(g=>card.tags.includes(g));
    if(!labels.length){
      const match=related.find(([,pattern])=>card.tags.some(tag=>pattern.test(tag)));
      if(!match)throw Error('Unclassified soup: '+card.id);
      labels.push(match[0]);
    }
    byId.set(card.id,labels);
    for(const genre of ['全部',...labels]){
      counts[genre].all++; counts[genre][card.difficulty]++;
    }
  }
  return {counts,byId,match(card,genre,level){
    return (genre==='全部'||byId.get(card.id).includes(genre)) && (level==='all'||card.difficulty===level);
  }};
}
