// W6-B: the chime the app plays with a notice that needs the owner (an escalation, a session waiting at a prompt or a
// question, a Gate). Main decides when (desktopNotifier.ts, `chime`) and sends `notify:chime`; this plays it. Two short
// notes from WebAudio: no audio file to ship, no dependency.

/** At most one chime this often, however many notices arrive together. */
export const CHIME_GAP_MS = 5000

/** The two notes, Hz: a rising fifth, A5 then E6. */
const NOTES = [880, 1318.5]
const NOTE_S = 0.14

/** A chimer with its own clock: `play()` sounds unless one sounded within CHIME_GAP_MS, and says whether it did. */
export function createChime(deps: { now(): number; sound(): void }): { play(): boolean } {
  let last = -Infinity
  return {
    play() {
      const now = deps.now()
      if (now - last < CHIME_GAP_MS) return false
      last = now
      deps.sound()
      return true
    }
  }
}

let ctx: AudioContext | null = null

function sound(): void {
  try {
    ctx ??= new AudioContext()
    void ctx.resume()
    const t0 = ctx.currentTime
    NOTES.forEach((hz, i) => {
      const start = t0 + i * NOTE_S
      const osc = ctx!.createOscillator()
      const gain = ctx!.createGain()
      osc.type = 'sine'
      osc.frequency.value = hz
      // A soft attack and decay, so the note does not click
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.2, start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, start + NOTE_S * 1.8)
      osc.connect(gain).connect(ctx!.destination)
      osc.start(start)
      osc.stop(start + NOTE_S * 2)
    })
  } catch {
    /* no audio device: the notice itself still shows */
  }
}

const chime = createChime({ now: () => Date.now(), sound })

/** Plays the chime, at most one per CHIME_GAP_MS. */
export const playAlertChime = (): boolean => chime.play()
