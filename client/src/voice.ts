type ListenHandlers = {
  onInterim: (text: string) => void
  onFinal: (text: string) => void
  onError: (message: string) => void
  onLevel?: (levels: number[]) => void
}

const BAR_COUNT = 18

let hold = false
let rec: SpeechRecognition | null = null
let stream: MediaStream | null = null
let audio: AudioContext | null = null
let frame = 0
let queue: string[] = []
let pumping = false

export const voice = {
  supported: typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
  speaking: false,
  listening: false,

  async listen(handlers: ListenHandlers): Promise<void> {
    this.stopListening()
    hold = true
    this.listening = true
    unlock()
    void waveform(handlers.onLevel)
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Ctor) {
      handlers.onError('Browser speech is unavailable. Type and press Enter.')
      return
    }
    const next = new Ctor()
    rec = next
    next.continuous = true
    next.interimResults = true
    next.lang = 'en-GB'
    let latest = ''
    next.onresult = (event) => {
      let interim = ''
      let finalText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (!result) continue
        const chunk = result[0]?.transcript ?? ''
        if (result.isFinal) finalText += chunk
        else interim += chunk
      }
      latest = `${finalText} ${interim}`.trim()
      handlers.onInterim(latest)
    }
    next.onerror = (event) => {
      if (event.error === 'aborted' || event.error === 'no-speech') return
      handlers.onError(event.error === 'not-allowed' ? 'Microphone blocked.' : `Speech error: ${event.error}`)
    }
    next.onend = () => {
      if (hold && rec === next) {
        try {
          next.start()
        } catch {
          /* already started */
        }
      }
    }
    try {
      next.start()
    } catch {
      handlers.onError('Could not open the microphone.')
    }
  },

  stopListening(commit?: (text: string) => void, pending = ''): void {
    hold = false
    this.listening = false
    rec?.stop()
    rec = null
    cancelAnimationFrame(frame)
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    void audio?.close()
    audio = null
    const text = pending.trim()
    if (text && commit) commit(text)
  },

  speak(text: string): void {
    if (!text.trim() || !('speechSynthesis' in window)) return
    queue.push(text)
    pump()
  },

  stopSpeaking(): void {
    queue = []
    pumping = false
    this.speaking = false
    window.speechSynthesis?.cancel()
  },
}

function unlock(): void {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.resume()
  if (!window.speechSynthesis.getVoices().length) {
    window.speechSynthesis.onvoiceschanged = () => undefined
  }
}

function pump(): void {
  if (pumping || !queue.length) return
  const text = queue.shift()
  if (!text) return
  pumping = true
  voice.speaking = true
  const utterance = new SpeechSynthesisUtterance(text)
  const chosen = pickVoice()
  if (chosen) utterance.voice = chosen
  utterance.rate = 0.96
  utterance.pitch = 0.92
  utterance.onend = () => {
    pumping = false
    voice.speaking = queue.length > 0
    pump()
  }
  utterance.onerror = () => {
    pumping = false
    voice.speaking = false
  }
  window.speechSynthesis.speak(utterance)
}

async function waveform(onLevel?: (levels: number[]) => void): Promise<void> {
  if (!onLevel || !navigator.mediaDevices?.getUserMedia) return
  try {
    const next = await navigator.mediaDevices.getUserMedia({ audio: true })
    if (!hold) {
      next.getTracks().forEach((track) => track.stop())
      return
    }
    stream = next
    audio = new AudioContext()
    const analyser = audio.createAnalyser()
    analyser.fftSize = 64
    audio.createMediaStreamSource(next).connect(analyser)
    const data = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      if (!hold) return
      analyser.getByteFrequencyData(data)
      onLevel(Array.from({ length: BAR_COUNT }, (_, i) => (data[i + 2] ?? 0) / 255))
      frame = requestAnimationFrame(tick)
    }
    tick()
  } catch {
    /* recognition can still work without a waveform stream */
  }
}

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis?.getVoices() ?? []
  return (
    voices.find((item) => /daniel|google uk english male|aaron|arthur/i.test(item.name)) ??
    voices.find((item) => item.lang.startsWith('en-GB')) ??
    voices.find((item) => item.lang.startsWith('en'))
  )
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
