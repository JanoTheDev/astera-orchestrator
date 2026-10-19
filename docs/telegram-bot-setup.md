# Get session notifications in Telegram, and reply to keep the work going

This guide sets things up so that Telegram on your phone **receives your work progress** and lets you **reply to a session's message to send a prompt into that session**. It takes about 5 minutes.

## 1. Create the bot

1. In Telegram, open a chat with [@BotFather](https://t.me/BotFather) and send `/newbot`.
2. Pick a name and a username (it must end in `bot`).
3. BotFather answers with the **bot token**, like `123456:ABC-DEF…`. Treat it like a password.

## 2. Find your numeric ids

1. Open a chat with your new bot and send it any message (a bot cannot message you first).
2. Open `https://api.telegram.org/bot<token>/getUpdates` in a browser, with your token in place of `<token>`. In the JSON, `message.chat.id` is the **chat id** and `message.from.id` is your **user id**.
   Or message [@userinfobot](https://t.me/userinfobot), which replies with your id.

In a private chat with the bot, the chat id and your user id are the same number.

## 3. Enter them in Astera

Open **Settings › Integrations › Telegram** and fill in:

| Field | Value |
|---|---|
| Bot token | the token from BotFather |
| Chat id | where session messages are posted |
| Allowed user id | the one user whose replies can drive sessions |

Press **Save**. The card says "Ready" once the bot token and chat id are both set. The settings are stored in `telegram.json` in the Astera profile folder.

Then turn on **Chat app notifications (Slack, Telegram)** when you start a session.

## How replies work

Every session posts its own messages to the chat. **Reply to one of a session's messages** and your text is typed into that session. A plain message that is not a reply gets a hint: "Reply to one of a session's messages to send it input".

Only the **allowed user id** can drive sessions. Replies from any other user are ignored, and **an empty allowed user id blocks all replies** — sending notifications still works, but nothing you write reaches a session. Set it to your own id.
