// W3-B voice: runs the owner's whisper.cpp on one clip (main process). The clip goes to a private temp folder and is
// removed after; the binary runs without a shell and gets only paths. Nothing here reaches the network.
import { execFile } from 'node:child_process'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { isOurWav, readWhisperOutput, whisperArgs, type Transcript, type VoiceSettings } from './speech'

/** A two-minute clip on a small model takes seconds; past this the binary is stuck or the model is far too big. */
const TIMEOUT_MS = 120_000

async function isFile(p: string): Promise<boolean> {
  return stat(p).then((s) => s.isFile(), () => false)
}

export async function transcribe(settings: VoiceSettings, wav: Uint8Array): Promise<Transcript> {
  const { whisperBinary: bin, whisperModel: model } = settings
  if (!bin || !model) return { ok: false, reason: 'not-configured' }
  if (!(await isFile(bin))) return { ok: false, reason: `whisper.cpp binary not found: ${bin}` }
  if (!(await isFile(model))) return { ok: false, reason: `whisper model not found: ${model}` }
  if (!isOurWav(wav)) return { ok: false, reason: 'the recording is not a WAV clip this app made, or it is too long' }
  // Owner-only folder: umask 002 would leave it group-writable (LINUX.md)
  const dir = await mkdtemp(path.join(os.tmpdir(), 'astera-voice-'))
  try {
    const file = path.join(dir, 'clip.wav')
    await writeFile(file, wav, { mode: 0o600 })
    const stdout = await new Promise<string>((resolve, reject) =>
      execFile(bin, whisperArgs(model, file), { timeout: TIMEOUT_MS, maxBuffer: 1 << 20, windowsHide: true }, (err, out, errOut) =>
        err ? reject(new Error(`${err.message}${errOut ? `: ${String(errOut).trim().slice(-300)}` : ''}`)) : resolve(String(out))
      )
    )
    return { ok: true, text: readWhisperOutput(stdout) }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
