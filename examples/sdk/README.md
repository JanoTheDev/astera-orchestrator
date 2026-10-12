# Astera SDK examples

Scripts that drive the Astera Host with [`@astera-app/client`](../../packages/client). The guide that explains
them is [docs/sdk.md](../../docs/sdk.md).

| Script | What it does |
|---|---|
| [run-a-job.ts](run-a-job.ts) | Makes a Job in a folder, runs it and waits for it; exits the way `astera runs wait` does |
| [follow-a-run.ts](follow-a-run.ts) | Prints a Run's timeline as it happens |
| [answer-questions.ts](answer-questions.ts) | Answers the questions agents ask a person, from a terminal |
| [notify-webhook.ts](notify-webhook.ts) | Posts Run endings, exhausted repairs and new questions to a webhook, resuming where it stopped |

## Run them

The SDK is not on npm yet, so build it from this repository first:

    npm ci
    npm run build:packages
    cd examples/sdk
    npm install

Then run a script with Node. Node 22.18 or later runs TypeScript as it is:

    node follow-a-run.ts <runId>

On Node 22.6 to 22.17 add `--experimental-strip-types`; on anything else use `npx tsx follow-a-run.ts <runId>`.

Each script talks to the Host of the installed Astera app (`ASTERA_PROFILE=dev` for the development app). The app
must be running, or a Host started with `astera host start`.
