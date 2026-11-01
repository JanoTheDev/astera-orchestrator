/**
 * The in-app update's last step. electron-updater's `quitAndInstall(isSilent = false, isForceRunAfter = false)`
 * with no arguments runs the NSIS installer with its wizard (`oneClick: false`) and never starts the app again.
 * Silent plus run-after is the only install path the app uses: `/S --force-run`, which build/installer.nsh turns
 * into an unelevated relaunch. The other platforms ignore both flags.
 */
export function installUpdate(updater: { quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void }): void {
  updater.quitAndInstall(true, true)
}
