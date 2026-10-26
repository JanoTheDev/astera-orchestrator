# Astera SDK examples

Scripts that drive the Astera Host with [`@astera-app/client`](../../packages/client). The guide that explains
them is [docs/sdk.md](../../docs/sdk.md).

| Script | What it does |
|---|---|
| [run-a-job.ts](run-a-job.ts) | Makes a Job in a folder, runs it and waits for it; exits the way `astera runs wait` does |
| [follow-a-run.ts](follow-a-run.ts) | Prints a Run's timeline as it happens |
| [answer-questions.ts](answer-questions.ts) | Answers the questions agents ask a person, from a terminal |
| [notify-webhook.ts](notify-webhook.ts) | Posts Run endings, exhausted repairs and new questions to a webhook (Slack's as it is, Discord's with `/slack` added), resuming where it stopped |

## Run them

These scripts use the client in this repository, which may differ from the one on npm; build it from `packages/client` to get the newest:

    npm ci --ignore-scripts
    npm run build:packages
    cd examples/sdk
    npm install

Then run a script with Node, which runs TypeScript as it is from 22.18 on the 22 line and from 23.6:

    node follow-a-run.ts <runId>

On Node 22.6 to 22.17 add `--experimental-strip-types`; on anything else use `npx tsx follow-a-run.ts <runId>`.

Each script talks to the Host of the installed Astera app (`ASTERA_PROFILE=dev` for the development app). The app
must be running, or a Host started with `astera host start`.
