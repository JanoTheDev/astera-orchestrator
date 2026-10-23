# w15-devices: the Devices view, a device tab and each Add device step, Night and Day

Shot from the real app on a seeded dev profile, driven over CDP by `shoot-devices.mjs <port> <outdir>`.

## Setup

1. `node scripts/shots-seed.mjs --profile "$P-dev"` (SEED.md), then start the app on it with a debugging port.
2. Two more profiles act as Runtimes on 127.0.0.1: each runs `host start`, `runtime start --listen 127.0.0.1
   [--port …]` and `runtime pair`, and the shot profile runs `runtimes add --pair <string>` for each (names
   `build-box`, full control, and `old-laptop`, read only). `old-laptop`'s Runtime is then stopped, so it shows
   offline and the Devices badge counts it.
3. A small script sends a Runtime beacon (core/remote/discovery.ts shape, name `studio-pc`) to the LAN group every
   2 s, so Found on your network has a row.

## What is real and what is set

- Real: the view and its three panes, both device tabs, the Choose step (opened from studio-pc's inline Add, so
  `user@host` is prefilled), and Settings › Remote Runtimes opened from This computer.
- Set on the modal's own state (its `useState` hooks, see the script), because no SSH machine was at hand: the
  Connect & set up step running, failed for a missing SSH key (Run in a terminal), and done; Bring my setup with a
  sample plan (the stand-in device was paired without SSH, so its own plan is empty and its error toast is
  cleared); Done. Run in a terminal itself was checked by hand in the same app: it opened a panel terminal that
  ran `ssh-copy-id -p 9 shots@127.0.0.1`.
