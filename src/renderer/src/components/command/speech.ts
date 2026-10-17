// W3-B voice: push-to-talk. A SpeechProvider records while the button (or the voice shortcut) is held and answers the
// transcript, which the command bar parses like typed text. The one provider is local whisper.cpp (owner decision):
// MediaRecorder records, the clip is decoded and resampled to 16 kHz mono WAV here, and main runs whisper.cpp on it.
import { encodeWav, MAX_CLIP_SECONDS, WHISPER_RATE, type Transcript } from '../../../../core/intents/speech'

export interface SpeechProvider {
  /** Opens the microphone and records. Rejects when it cannot be opened. */
  start(): Promise<void>
  /** Stops and answers what was said. */
  stop(): Promise<Transcript>
  /** Stops and throws the clip away. */
  cancel(): void
}

/** Mono 16 kHz samples of a recorded clip, cut at MAX_CLIP_SECONDS. */
async function toSamples(blob: Blob): Promise<Float32Array> {
  const ctx = new AudioContext()
  let audio: AudioBuffer
  try {
    audio = await ctx.decodeAudioData(await blob.arrayBuffer())
  } finally {
    void ctx.close()
  }
  const seconds = Math.min(audio.duration, MAX_CLIP_SECONDS)
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(seconds * WHISPER_RATE)), WHISPER_RATE)
  const src = off.createBufferSource()
  src.buffer = audio
  src.connect(off.destination) // a stereo source is mixed down to the one channel
  src.start()
  return (await off.startRendering()).getChannelData(0)
}

export function whisperSpeech(transcribe: (wav: Uint8Array) => Promise<Transcript>): SpeechProvider {
  let rec: MediaRecorder | null = null
  let chunks: Blob[] = []
  const release = (): void => {
    rec?.stream.getTracks().forEach((tr) => tr.stop())
    rec = null
  }
  return {
    async start() {
      if (rec) return
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunks = []
      rec = new MediaRecorder(stream)
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      rec.start()
    },
    async stop() {
      const r = rec
      if (!r) return { ok: false, reason: 'not recording' }
      await new Promise<void>((resolve) => {
        r.onstop = () => resolve()
        r.stop()
      })
      release()
      const blob = new Blob(chunks, { type: r.mimeType })
      chunks = []
      if (blob.size === 0) return { ok: true, text: '' }
      return transcribe(encodeWav(await toSamples(blob), WHISPER_RATE))
    },
    cancel() {
      if (rec && rec.state !== 'inactive') rec.stop()
      release()
      chunks = []
    }
  }
}
