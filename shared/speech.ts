/** Split streamed text into speakable sentences without cutting decimals or abbreviations. */

const ABBREV = /\b(?:e\.g|i\.e|mr|ms|dr|vs|v)\.$/i

export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function takeSentences(buffer: string, flush = false): { sentences: string[]; rest: string } {
  const sentences: string[] = []
  let start = 0
  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i]
    if (ch !== '.' && ch !== '!' && ch !== '?') continue
    const next = buffer[i + 1]
    const atEnd = i === buffer.length - 1
    if (!flush && !atEnd && next !== ' ' && next !== '\n') continue
    if (!flush && atEnd) continue
    const slice = buffer.slice(start, i + 1).trim()
    if (!slice || ABBREV.test(slice)) continue
    if (/^\d+\.$/.test(slice)) continue
    const spoken = speakable(slice)
    if (spoken.length > 1) sentences.push(spoken)
    start = i + 1
  }
  const rest = buffer.slice(start)
  if (flush) {
    const tail = speakable(rest)
    if (tail.length > 1) sentences.push(tail)
    return { sentences, rest: '' }
  }
  return { sentences, rest }
}

export function limitSentences(sentences: string[], max = 4): string[] {
  return sentences.map((s) => s.trim()).filter(Boolean).slice(0, max)
}
