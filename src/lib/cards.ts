import type { Card } from './types'
import { cardImages } from './cardImages'

// The deck is ordered by its flat index (0..77), which matches the
// auto-generated cardImages mapping and the server knowledge base.
export const cards: Card[] = cardImages.map((ci) => ({
  name: ci.name,
  index: ci.index,
  src: ci.src,
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
export function drawOne(excludeIndexes: number[]): Card {
  const pool = cards.filter((c) => !excludeIndexes.includes(c.index))
  const card = pool[Math.floor(Math.random() * pool.length)]
  return { ...card, reversed: Math.random() < 0.5 }
}