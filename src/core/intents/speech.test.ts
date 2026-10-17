import { afterEach, describe, expect, it } from 'vitest'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { encodeWav, isOurWav, MAX_WAV_BYTES, readVoiceSettings, readWhisperOutput, whisperArgs } from './speech'
import { transcribe } from './transcribe'

describe('voice settings', () => {
  it('keeps absolute paths only', () => {
    expect(readVoiceSettings({ whisperBinary: '/opt/w/whisper-cli', whisperModel: 'models/base.bin' })).toEqual({
      whisperBinary: '/opt/w/whisper-cli'
    })
    expect(readVoiceSettings('x')).toEqual({})
  })
})

describe('wav', () => {
  it('writes a 16-bit mono PCM header and clamps samples', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 16000)
    const v = new DataView(wav.buffer)
    expect(wav.length).toBe(44 + 8)
    expect(isOurWav(wav)).toBe(true)
    expect(v.getUint16(22, true)).toBe(1)
    expect(v.getUint32(24, true)).toBe(16000)
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true)]).toEqual([0, 32767, -32768, 32767])
  })

  it('refuses something that is not our clip or is too long', () => {
    expect(isOurWav(new Uint8Array(100))).toBe(false)
    const big = encodeWav(new Float32Array((MAX_WAV_BYTES - 44) / 2 + 1), 16000)
    expect(isOurWav(big)).toBe(false)
  })
})

describe('whisper.cpp', () => {
  it('runs with no timestamps or progress so stdout is the text', () => {
    expect(whisperArgs('/m.bin', '/c.wav')).toEqual(['-m', '/m.bin', '-f', '/c.wav', '-l', 'auto', '-nt', '-np'])
    expect(readWhisperOutput('\n Pause the Console plan.\n[BLANK_AUDIO]\n')).toBe('Pause the Console plan.')
  })

  let dir = ''
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('runs the configured binary on a temp clip, removes the clip, and answers the text', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'astera-voice-test-'))
    const bin = path.join(dir, 'whisper-cli')
    const model = path.join(dir, 'model.bin')
    const seen = path.join(dir, 'args.txt')
    // A stand-in binary: records its argv and whether the clip exists, then prints a transcript
    await writeFile(bin, `#!/bin/sh\necho "$@" > ${JSON.stringify(seen)}\n[ -f "$4" ] && echo " Show every session needing my input"\n`)
    await chmod(bin, 0o755)
    await writeFile(model, 'm')
    const r = await transcribe({ whisperBinary: bin, whisperModel: model }, encodeWav(new Float32Array(160), 16000))
    expect(r).toEqual({ ok: true, text: 'Show every session needing my input' })
    const args = (await readFile(seen, 'utf8')).trim().split(' ')
    expect(args.slice(0, 2)).toEqual(['-m', model])
    await expect(readFile(args[3])).rejects.toThrow() // the clip is gone
  })

  it('says it is not set up rather than running anything', async () => {
    expect(await transcribe({}, encodeWav(new Float32Array(1), 16000))).toEqual({ ok: false, reason: 'not-configured' })
  })
})
