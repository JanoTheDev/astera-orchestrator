# Drive Astera from Discord: session threads, plan channels, and buttons

This guide sets things up so that a Discord server of your own **shows each session as a thread**, builds **a channel per plan**, and lets you **answer questions and approve plans from your phone**. It takes about 10 minutes.

## 1. Create the bot

1. Open the [Discord developer portal](https://discord.com/developers/applications) and press **New Application**.
2. Open **Bot**, then **Reset Token** and copy the **bot token**. Treat it like a password.
3. On the same page, under **Privileged Gateway Intents**, turn on **Message Content**. Without it the bot cannot read your replies, and the Astera card says so.

## 2. Invite it to your server

Open this address in a browser, with your application's id (**General Information › Application ID**) in place of `<client_id>`:

```
https://discord.com/oauth2/authorize?client_id=<client_id>&scope=bot%20applications.commands&permissions=309237738512
```

The scopes are `bot` and `applications.commands`. The permissions are:

- Manage Channels
- View Channels
- Send Messages
- Create Public Threads
- Send Messages in Threads
- Manage Messages (to pin the plan card)
- Read Message History
- Embed Links

The permission integer for exactly these is `309237738512`.

## 3. Find your ids

1. In Discord, open **User Settings › Advanced** and turn on **Developer Mode**.
2. Right-click your server's icon and choose **Copy Server ID**: this is the **server (guild) id**.
3. Right-click your own name and choose **Copy User ID**: this is your **user id**.

## 4. Enter them in Astera

Open **Settings › Integrations › Discord** and fill in:

| Field | Value |
|---|---|
| Bot token | the token from step 1 (stored, never shown again) |
| Server (guild) id | the server the bot works in |
| Your Discord user id | the one user who can drive Astera |
| Plan workspace | on by default: a category per project, a channel per plan |

Press **Save**. The card says "Ready" once the bot token and server id are both set. The settings are stored in `discord.json` in the Astera profile folder. Then turn on **Chat app notifications** when you start a session.

## What the bot builds

- An **Astera** category with two channels:
  - `#astera`: the slash commands `/plan new`, `/plan status` and `/plan approve`, and notices.
  - `#sessions`: one thread per session.
- A category per project, with a **channel per plan**. Each plan channel has a pinned card with **Approve & execute** and **Talk to the planner**.
- **Gate questions** arrive as buttons.
- Your messages in a plan channel go to that plan's planner.
- Worker threads open inside the plan channel.
- A finished plan's channel moves, read-only, to the **Astera archive** category.

Turn **Plan workspace** off if you only want session threads.

## Security

Only the **user id** you entered can drive Astera. Messages, slash commands and buttons from anyone else are ignored, and **an empty user id blocks everyone**, you included: posting still works, but nothing you do in Discord reaches Astera. Use a server of your own, and keep the bot token private.

## Troubleshooting

Read `discord.log` in the Astera profile folder. The bot token is never written there.

- The bot posts but ignores your replies: **Message Content** is off, or the user id is empty or wrong.
- No categories or channels appear: the invite lacks **Manage Channels**, or the server id is wrong.
- Slash commands are missing: the invite lacks the `applications.commands` scope. Invite the bot again with the address above.
