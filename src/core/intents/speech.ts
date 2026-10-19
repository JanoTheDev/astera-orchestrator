// W3-B voice: the pure half of the local whisper.cpp provider. The renderer records (MediaRecorder) and encodes the
// clip as 16 kHz mono WAV here; main writes it to a private temp file and runs the owner's whisper.cpp binary on it
// (transcribe.ts). Audio never leaves the machine, and nothing is downloaded: the binary and model are paths the
// owner set (docs/guide.md).

/** A clip's text, or why there is none (`not-configured`: no binary or model set). */
export type Transcript = { ok: true; text: string } | { ok: false; reason: string }

/** `app-settings.json`'s `voice`. Both paths absolute; anything else reads as not set. */
export interface VoiceSettings {
  whisperBinary?: string
  whisperModel?: string
}

/** whisper.cpp reads 16 kHz mono PCM WAV (its `examples/cli` README). */
export const WHISPER_RATE = 16_000
/** Longest clip accepted: two minutes. A held button left down is not a dictation. */
export const MAX_CLIP_SECONDS = 120
export const MAX_WAV_BYTES = 44 + MAX_CLIP_SECONDS * WHISPER_RATE * 2

/** Absolute on Linux/macOS, or a Windows drive path. Relative paths would resolve against main's cwd. */
const isAbsolutePath = (p: string): boolean => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)

export function readVoiceSettings(v: unknown): VoiceSettings {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {}
  const o = v as Record<string, unknown>
  const out: VoiceSettings = {}
  for (const k of ['whisperBinary', 'whisperModel'] as const) {
    const s = typeof o[k] === 'string' ? (o[k] as string).trim() : ''
    if (s !== '' && isAbsolutePath(s)) out[k] = s
  }
  return out
}

/** whisper.cpp's CLI (`whisper-cli`, `main` in older builds): no timestamps, no progress prints, so stdout is the
 *  text. `-l auto` detects the language; an English-only model ignores it. */
export function whisperArgs(model: string, wavPath: string): string[] {
  return ['-m', model, '-f', wavPath, '-l', 'auto', '-nt', '-np']
}

/** The transcript from stdout: lines joined, whisper's `[BLANK_AUDIO]`-style markers dropped. */
export function readWhisperOutput(stdout: string): string {
  return stdout
    .replace(/\[[A-Z_ ]+\]/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Mono float samples (-1..1) as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2)
  const v = new DataView(out.buffer)
  const ascii = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i)
  }
  ascii(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  v.setUint32(16, 16, true) // PCM chunk size
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true) // bytes per second
  v.setUint16(32, 2, true) // block align
  v.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return out
}

/** A WAV this module made: the RIFF/WAVE header and a size within the cap. Main checks it before writing it out. */
export function isOurWav(b: Uint8Array): boolean {
  if (b.length < 44 || b.length > MAX_WAV_BYTES) return false
  const tag = (at: number): string => String.fromCharCode(...b.subarray(at, at + 4))
  return tag(0) === 'RIFF' && tag(8) === 'WAVE' && tag(12) === 'fmt '
}
