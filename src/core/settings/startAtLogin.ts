// T23 "Start Astera at login" (main/autostart.ts): on unless app-settings.json says `startAtLogin: false`.
/** Only an explicit false turns it off: the file is user-editable, and anything else reads as the default (on). */
export const startAtLoginOf = (value: unknown): boolean => value !== false
