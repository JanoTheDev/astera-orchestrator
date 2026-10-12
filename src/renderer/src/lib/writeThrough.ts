/**
 * A state setter that moves its mirror ref first. App.tsx reads the tab tree and the active pane from refs to compute
 * the next ones (an updater can run twice under StrictMode), and those refs used to move only when the component
 * rendered. Two writes before a render then both started from the same old value and the second overwrote the first:
 * after the 1.4.11 update the window was up before the Host's sessions were taken back, the four arrived as a burst of
 * session:created, and two claude tabs were lost while their processes kept running. Through here the ref is the value
 * of the last write, always, and React gets that same value. An updater runs once, here, on the ref, never inside React.
 */
export function writeThrough<T>(ref: { current: T }, commit: (value: T) => void): (next: T | ((cur: T) => T)) => void {
  return (next) => {
    const value = typeof next === 'function' ? (next as (cur: T) => T)(ref.current) : next
    ref.current = value
    commit(value)
  }
}
