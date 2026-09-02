import type { Card } from './types'

// [displayName, fileStem]. fileStem is used to build the asset URL.
const DECK: [string, string][] = [
  ['The Fool', 'The_Fool'], ['The Magician', 'The_Magician'], ['The High Priestess', 'The_High_Priestess'],
  ['The Empress', 'The_Empress'], ['The Emperor', 'The_Emperor'], ['The Hierophant', 'The_Hierophant'],
  ['The Lovers', 'The_Lovers'], ['The Chariot', 'The_Chariot'], ['Strength', 'Strength'],
  ['The Hermit', 'The_Hermit'], ['Wheel of Fortune', 'Wheel_of_Fortune'], ['Justice', 'Justice'],
  ['The Hanged Man', 'The_Hanged_Man'], ['Death', 'Death'], ['Temperance', 'Temperance'],
  ['The Devil', 'The_Devil'], ['The Tower', 'The_Tower'], ['The Star', 'The_Star'],
  ['The Moon', 'The_Moon'], ['The Sun', 'The_Sun'], ['Judgement', 'Judgement'], ['The World', 'The_World'],
  ...(['Wands', 'Cups', 'Swords', 'Pentacles'] as const).flatMap((suit) =>
    (['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Page', 'Knight', 'Queen', 'King'] as const).map((rank): [string, string] => [
      `${rank} of ${suit}`,
      rank === 'Ace' ? 'Ace' : `${rank}_of_${suit}`,
    ]),
  ),
]

export const cards: Card[] = DECK.map(([name, file]) => ({
  name,
  file,
  src: `cards/${file}_(Rider-Waite_Smith_tarot_deck).png`,
}))

const majorTitles: Record<string, string> = {
  'The Fool': '愚人', 'The Magician': '魔术师', 'The High Priestess': '女祭司', 'The Empress': '皇后',
  'The Emperor': '皇帝', 'The Hierophant': '教皇', 'The Lovers': '恋人', 'The Chariot': '战车',
  'Strength': '力量', 'The Hermit': '隐者', 'Wheel of Fortune': '命运之轮', 'Justice': '正义',
  'The Hanged Man': '倒吊人', 'Death': '死神', 'Temperance': '节制', 'The Devil': '恶魔',
  'The Tower': '高塔', 'The Star': '星星', 'The Moon': '月亮', 'The Sun': '太阳',
  'Judgement': '审判', 'The World': '世界',
}
const rankTitles: Record<string, string> = { Ace: '王牌', Two: '二', Three: '三', Four: '四', Five: '五', Six: '六', Seven: '七', Eight: '八', Nine: '九', Ten: '十', Page: '侍者', Knight: '骑士', Queen: '王后', King: '国王' }
const suitTitles: Record<string, string> = { Wands: '权杖', Cups: '圣杯', Swords: '宝剑', Pentacles: '星币' }

export function cardTitle(card: Pick<Card, 'name'>): string {
  if (majorTitles[card.name]) return majorTitles[card.name]
  const [rank, , suit] = card.name.split(' ')
  return `${suitTitles[suit]}${rankTitles[rank]}`
}

/**
 * Draw one random card (with a random reversal) that isn't already on the
 * table. Called at the moment the user flips a card — nothing about the
 * reading exists before the user acts.
 */
export function drawOne(exclude: string[]): Card {
  const pool = cards.filter((c) => !exclude.includes(c.name))
  const card = pool[Math.floor(Math.random() * pool.length)]
  return { ...card, reversed: Math.random() < 0.5 }
}