// What this app tells the Host of its sessions so the Host can record their session events (plugin Phase 3, events
// and notifications design N3): the status and open request of the chats whose adapter is this app's, and the roll
// states of the chains this app holds. Sent whoever owns Slack (slack-event is Slack's, and only while the Host owns
// it), and only to a connected Host that announced HOST_FEATURE_SESSION_SIGNALS: an older Host would log each as an
// unknown message. A signal made while no such Host is connected is not kept: the Host that is not there records
// nothing, and its plugins, which run in it, are not running either. Never throws.
import { HOST_FEATURE_SESSION_SIGNALS, type ClientMessage } from '../core/host/protocol'
import type { SessionSignal, SignalSession } from '../core/sessions/sessionSignal'
import type { ChatEvent } from '../core/chat/types'
import type { RollStateEvent } from '../core/types'

export interface SessionSignalForwarder {
  /** The Host client, once there is one. Its status says, at each send, whether a Host that takes these is there. */
  setHost(h: { status(): { connected: boolean; features: readonly string[] }; send(m: ClientMessage): boolean } | null): void
  /** One event of a chat whose adapter is this app's: its status and its open request are sent, nothing else. */
  chat(session: SignalSession, event: ChatEvent): void
  /** A roll state of a chain this app holds. */
  rollState(session: SignalSession, event: RollStateEvent): void
}

export function createSessionSignalForwarder(d: { log(message: string): void }): SessionSignalForwarder {
  let host: Parameters<SessionSignalForwarder['setHost']>[0] = null
  const send = (signal: SessionSignal): void => {
    try {
      const s = host?.status()
      if (!host || !s?.connected || !s.features.includes(HOST_FEATURE_SESSION_SIGNALS)) return
      host.send({ t: 'session-signal', signal })
    } catch (err) {
      try {
        d.log(`a session signal could not be sent: ${String(err)}`)
      } catch {
        /* nowhere to say it */
      }
    }
  }
  return {
    setHost: (h) => {
      host = h
    },
    chat(session, event) {
      if (event.type === 'status') send({ kind: 'chat', session, event: { type: 'status', status: event.status } })
      else if (event.type === 'request') send({ kind: 'chat', session, event: { type: 'request', request: event.request === null ? null : event.request.kind } })
    },
    rollState(session, event) {
      send({ kind: 'roll-state', session, event })
    }
  }
}
