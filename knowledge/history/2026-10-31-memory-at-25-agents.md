# Where the 31 GB goes when many agents run (2026-10-31)

Why: the load monitor saw "memory 0% free while 10 agents ran" (`load monitor: lowered agents 25 -> 9`)
and `git merge` failed with "fatal: Out of memory, malloc failed". Before limits are re-sized, this
records what the memory is spent on. Measured with `scripts/perf-memory.mjs` (5 s samples, 30 min,
351 samples, 15:42-16:12 local) on the 24-core / 31.4 GB Windows laptop while this plan's other
workers ran: 4 to 23 Claude sessions alive (median 16, 18 and more for about 118 samples).

## What the machine spent, observed and extrapolated to 25 agents

Private bytes. "Observed" is the median over the run at about 16 agents. 25-agent column = observed
per-agent cost times 25; fixed rows stay.

| Group | Observed (median) | At 25 agents |
|---|---|---|
| Claude sessions (`claude.exe`, 0.66 GB each, range 0.54-0.70) | 10.4 GB | 16.5 GB |
| MCP children (1.5 processes per agent, ~0.10 GB per agent) | 1.5 GB | 2.5 GB |
| Astera app (4 Electron processes) | 1.0 GB | 1.0 GB |
| astera-host (also one short-lived `astera-host.exe` per Claude hook/statusline call) | 0.54 GB | 0.6 GB |
| esbuild, git, tests, install (quiet moments) | 0.7 GB | 0.7 GB |
| OS, WSL (`vmmemWSL` 2.5-2.9), Defender 1.2, Discord 0.9, Docker 0.7, svchost, dwm... (estimated from the top images) | ~9 GB | ~9 GB |
| What agents leave running: node dev servers (storybook 2.7 GB), Firefox 3 GB, headless Chrome 0.7 GB, bun (rest of "other", 18.0 GB median minus the 9 above) | ~9 GB | ~14 GB |
| **Sustained total** | ~32 GB | **~44 GB** |

Physical RAM is 31.4 GB, so 25 agents at this behaviour do not fit; the 16 that ran already sat at
a median of 7.9 GB "available", of which 4.1 GB was standby cache (reclaimable) and 3.0 GB truly free.

Per agent: a Claude session is 0.66 GB private (0.29 GB working set; the rest is paged out or
committed but untouched) plus ~0.10 GB for its MCP children. I could not separate thinking from idle:
the per-process figure stays in 0.63-0.68 GB (p10-p90) across the run, so the gap is small next to the
spread between sessions. Each session runs as `claude.exe` under a `cmd.exe /c call claude.cmd` shim,
and its MCP server as `cmd.exe /c npx -y @upstash/context7-mcp@3.2.5` -> `node npx-cli.js` ->
`node context7-mcp/dist/index.js`: three processes, 1.5 per agent after the shim is counted.

The MCP server is `@upstash/context7-mcp@3.2.5`, started per session with `npx -y`. I could not find
where it is configured: not in `~/.claude.json` (`mcpServers` is empty), not in any `settings.json` or
`.claude.json` under `~/.claude-accounts/*`, not in the installed plugins (the context7 plugin is an
http URL, not npx), not under `%ProgramData%\ClaudeCode`. Whoever owns the Claude setup should look at
`claude mcp list` from inside a session. Whether workers need it was not decided here; dropping it saves
about 0.1 GB per agent (2.5 GB at 25).

## Heavy commands (through `astera heavy`)

Peak of the whole process tree, polled about every 1.5 s, so short spikes can be missed.

| Command | Peak private | Duration |
|---|---|---|
| `npm ci` (fresh clone; it exited 1 part-way, so the peak is a lower bound) | 0.71 GB (9 processes) | 193 s |
| `bun install --frozen-lockfile` | not measurable: the repo has no `bun.lock`, bun exits at once | 2 s |
| `tsc --noEmit -p tsconfig.node.json`, cold (own `--tsBuildInfoFile`) | 1.47 GB | 12 s |
| `tsc --noEmit -p tsconfig.web.json`, cold | 1.23 GB | 14 s |
| `npm run typecheck`, warm (the `.tsbuildinfo` cache is hit) | 0.15 GB | 4 s |
| `npx vitest run --maxWorkers=2 src/core/orchestration/blocked.test.ts` | 0.5-0.6 GB (6 processes) | 6-10 s |
| `git merge` of two branches 4265 commits and 3943 files apart | 0.07 GB | 10 s |

Still, the sampler saw far larger heavy work from other repositories on the same machine:
a `turbo` typecheck group peaking at 7.9 GB (17 processes), `bun install` groups at 1.7 GB, test
groups at 1.2 GB (24 processes), and **`biome.exe` at 18.6 GB (7 processes of about 2.7 GB each)**,
which is not a group the task listed and is the largest single load of the run. Every low-memory stretch
(under 1 GB available, all between 13:52 and 14:00 UTC) coincided with biome or a 7.7 GB typecheck group running.
The git merge here used 70 MB, so the malloc failure was the machine out of commit, not git.

## Commit charge versus physical memory

Commit limit = RAM + pagefile. `C:\pagefile.sys` is system-managed: 5 GB allocated at the start
(limit 36.4 GB), grown to 18.9 GB (limit 64 GB) by the end of the run. Commit charge median 40.3 GB,
p90 45.4, peak 62.5 GB. Windows ran out of commit and physical memory together: all 10 samples with
under 1 GB available had under 6.5 % commit headroom (eight under 2.5 %), because the pagefile grows
only after commit is exhausted, so allocations stall or fail in between. Headroom was under 10 % in
82 of 351 samples and under 15 % in 171, so 15 % is simply what normal operation looks like.

`os.freemem()` (libuv `ullAvailPhys`) matches Windows "Available MBytes": median difference 17 MB,
p10-p90 -313 to +311 MB (that is the 1-2 s between the two reads, not a difference in definition).
It includes standby cache: at the same time standby was 4.1 GB of the 7.9 GB, so "% free" computed from
`os.freemem()` overstates how much can be allocated without paging; commit headroom is the better
alarm.

## Numbers to use

Copied into code by the sizing Task.

- `MEMORY_PER_AGENT_GB = 0.8` (Claude session 0.66 + MCP children 0.10 + shims; idle and thinking are not distinguishable)
- `MEMORY_PER_HEAVY_JOB_GB = 8` (largest observed install/typecheck/test peak: the turbo typecheck at 7.9 GB; this repository's own are 0.7-1.5 GB. `biome` at 18.6 GB was a separate lint job)
- `RESERVED_MEMORY_GB = 9` (OS, WSL, Defender, Docker, Discord, Astera app and Host; browsers and dev servers that agents leave behind, about 0.5 GB per agent, are not in it)
- `COMMIT_HEADROOM_PCT = 10` (every sample with under 1 GB available had under 6.5 % headroom; below 10 % the machine is within seconds of stalling)

With these, 31.4 GB gives (31.4 - 9 - 8) / 0.8 = 18 agents before the 0.5 GB per agent that they leave
running; subtracting that too gives about 14. 25 agents need either fewer leftovers (browsers and dev
servers) or a larger pagefile and heavy slots kept to one.
