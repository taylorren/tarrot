// The three positions in the spread, in draw order.
export const positions = [
  { num: '01', title: '此刻的真实', sub: '你脚下的土地' },
  { num: '02', title: '需要照看的事', sub: '轻轻跟随的线索' },
  { num: '03', title: '向前的一种方式', sub: '一个小小的尝试' },
] as const

// Reading-heading copy shown after each draw (index = position just revealed).
export const instructionCopy = [
  '和这幅图像安静相处片刻。',
  '现在，跟随那条更安静的线索。',
  '把它带进今天余下的时光。',
] as const

export const DEFAULT_QUESTION = '此刻有什么正停留在我心里'