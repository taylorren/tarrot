import { cardTitle } from './cards'
import type { Card } from './types'

const guidance: Record<string, string> = {
  'The Fool': '不必等到拿到完整地图才开始。好奇心已经足够带你迈出第一小步。',
  'The Hermit': '把外界的音量调低一点，好听见自己的答案。独处也可以是一种前进。',
  'The Star': '让希望变得具体：找出一件仍在好好运转的事，然后照料它。',
  'The Moon': '不是每种感受都需要立刻变成结论。让不明朗之处保持柔软、尚未完成。',
  'The Tower': '一个真相或许正在清空房间。当你不再勉强支撑时，留意哪些可能性出现了。',
  'Death': '放下是一种行动，并不是失败。为正试图到来的新版本腾出空间。',
  'Strength': '对那股强烈的力量用更柔软的手。稳定往往比施压走得更远。',
  'Temperance': '寻找能让这件事继续生活下去的比例。微小的调整也能改变整个配方。',
  'The Sun': '允许自己以一种小小而温暖的方式被看见。被分享的喜悦会更清晰。',
  'The World': '有件事已准备好被承认为完成。在开启下一段之前，先致意这个完整的圆。',
  'The Lovers': '选择那个让你更像自己的选项。契合感是一种很有用的指南针。',
  'The Magician': '你拥有的工具比自己以为的更多。今天就拿起其中一件来用。',
}

const reversalBySuit: Record<string, string> = {
  Wands: '这股冲劲也许分散了，或被压住了。别强推节奏，把它收拢成一个有意识的小行动。',
  Cups: '一种感受也许想先在私密处被好好接住。先让它真实存在，再要求它变得清晰。',
  Swords: '思绪可能正在这里打转。暂停内心的辩论，回到一个你能够相信的事实。',
  Pentacles: '某件现实之事可能需要重新平衡。看看什么被过度消耗、被忽略，或被抓得太紧。',
}

const tonesBySuit: Record<string, string> = {
  Wands: '让能量变成一个看得见的行动，哪怕它很小。',
  Cups: '说出故事底下的感受，不必立刻解决它。',
  Swords: '清楚分开你知道的事，与那些你害怕的事。',
  Pentacles: '回到可触及的现实：时间、资源、休息，以及下一个可行的步骤。',
}

const fallback: string[] = [
  '留意那件不断回到你心里的事。它也许正等着被说出名字。',
  '把注意力给那部分你通常会匆匆略过的东西。',
  '选一个小到能在今天结束前完成的下一步。',
]

/** A short, hand-written note for a drawn card. */
export function noteFor(card: Card, pos: number): string {
  if (card.reversed) {
    const suit = card.name.split(' of ')[1]
    return reversalBySuit[suit] || `${cardTitle(card)}熟悉的能量也许正在内收、延迟，或失去比例。与其推着它往前，先问问什么值得重新思量。`
  }
  if (guidance[card.name]) return guidance[card.name]
  const suit = card.name.split(' of ')[1]
  return tonesBySuit[suit] || fallback[pos] || ''
}