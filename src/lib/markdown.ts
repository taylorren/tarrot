import { cardTitle } from './cards'
import { noteFor } from './guidance'
import { positions } from './spread'
import type { Card } from './types'

function stamp(): string {
  const n = new Date()
  const p = (v: number) => String(v).padStart(2, '0')
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())} ${p(n.getHours())}:${p(n.getMinutes())}`
}

/**
 * Build a Markdown snapshot of the whole reading for the copy button.
 * The AI block is included only when it has actually been produced (aiReady).
 */
export function buildMarkdown(
  question: string,
  chosen: Card[],
  aiReading: string,
  aiThread: string,
  aiReady: boolean,
): string {
  const lines = chosen
    .map((c, i) => `- **${cardTitle(c)} · ${c.reversed ? '逆位' : '正位'}** — ${positions[i].title}：${noteFor(c, i)}`)
    .join('\n')
  const aiFile = aiReady
    ? `\n\n## 关于问题的一点解读\n\n${aiReading}${aiThread ? `\n\n**今天就做的一小步：** ${aiThread}` : ''}`
    : ''
  const focus = chosen[2]
  return [
    `# 小小问题\n`,
    `**关于：「${question}」**\n`,
    `## 牌面\n`,
    `${lines}\n`,
    `## 一句提醒\n`,
    `${focus ? noteFor(focus, 2) : ''}\n${aiFile}\n`,
    `---\n*抽牌于 ${stamp()}*`,
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}