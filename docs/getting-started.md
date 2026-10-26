# Getting started

From a fresh checkout to your first delivered plan. This page is the short path; the [user guide](guide.md) has the
depth, and [concepts](concepts.md) explains the words.

## Requirements

Linux is the platform Astera is built and tested on. You need:

- Node 22.13 or newer, `python3`, `make` and `g++` (`node-pty` is compiled on install);
- the `claude` CLI on your `PATH`, and `codex` if you use Codex;
- `gh`, signed in, if you want pull requests;
- a git repository to work on.

Linux details (display, packaged builds, closing the window) are in [dev/LINUX.md](dev/LINUX.md).

## 1. Install

Build the AppImage and run it:

```bash
git clone https://github.com/JanoTheDev/astera-orchestrator.git astera && cd astera
npm ci
npm run dist:linux                         # builds dist-installer/astera-*-x86_64.AppImage
./dist-installer/astera-*-x86_64.AppImage  # profile: ~/.config/astera
```

To try it without packaging, `npm run dev` runs the development app on its own profile (`~/.config/astera-dev`), so it
never touches your real one.

## 2. First run

Do these once. Nothing runs until at least one account is signed in.

1. **Sign in an account.** Open **Settings → Accounts & usage**, press **+**, pick Claude or Codex and a name, then
   **Add account**. Astera runs the CLI's own login and shows a link with **Open in browser** and **Copy**. Sign in
   there; the dialog closes by itself once the account reads as logged in.

   <img src="../assets/docs/accounts.png" width="760" alt="Accounts and usage with several accounts and their usage bars" />

2. **Check the models.** **Settings → Agents → Orchestration models** sets the model per role. Defaults: planner and
   reviewer `opus`, coordinator `haiku`, workers by Task difficulty (light `haiku`, standard `sonnet`, hard `opus`).

   <img src="../assets/docs/settings-agents.png" width="760" alt="Settings, Agents: the orchestration model for each role" />

3. **Install the `astera` command.** **Settings → Integrations → CLI → Install the astera command**. Optional; see
   [cli.md](cli.md).
4. **Set a git identity**, so the merges Astera makes are yours:

   ```bash
   git config --global user.name "Your Name"
   git config --global user.email "you@example.com"
   ```

5. **Know the permission prompts.** Agents stop at every permission prompt until you answer it. They land in the
   **Needs you** tab. Turn that off only for repositories you trust: **Settings → Agents → Run agents without
   permission checks**.

## 3. Add a project

A project is one git repository. Open the project switcher in the title bar and choose **Add project** for an
existing git folder, or **New project** to create one (name, parent folder, optional GitHub repository).

<img src="../assets/docs/project-switcher.png" width="760" alt="The title bar project switcher open, listing several projects" />

## 4. Make your first plan

Press `Ctrl+N` and choose **Plan it for me**, or open the Plans view and press **New plan**. Both open the **Start**
tab.

<img src="../assets/docs/start.png" width="760" alt="The Start tab: one composer with attached files and the Plan it for me and Run as written modes" />

Write a goal in the box, for example "Add a `--json` flag to the export command and test it". You can also attach
files or pick GitHub issues. Then press **Start planning**. A planner console opens in the Agents view, reads the code,
and writes the Tasks.

Already have the prompts written? Choose **Run as written**: each prompt file becomes one Task with its text unchanged.

## 5. Approve the plan

The finished plan shows up in the bottom panel's **Needs you** tab. Read the Tasks, then press **Approve & execute**.
Or tell the planner what to change and it replans. **Hands-off** (on Start) approves for you.

## 6. Watch it run

The plan has its own tab. A coordinator places workers as their dependencies finish; each Task shows its live line, model
and account. Tasks that touch the same files never run at the same time. A reviewer checks every Task, and a final check
compares the result with your goal.

<img src="../assets/docs/plan-board.png" width="760" alt="A running plan's tab: Steps with Tasks working, done and waiting" />

The Agents view lists every console, and each opens as a tab you can type into without stopping the rest. Closing the
window does not stop the plan: the background Host keeps running it.

## 7. Answer Needs you

Permission prompts, questions Astera cannot answer itself and failed reviews wait in the **Needs you** tab, with a sound
and a desktop notice. What Astera decided without you is listed in the bottom panel's **Activity** tab, under **Handled for you**.

<img src="../assets/docs/needs-you.png" width="760" alt="A plan with an open question and its answer buttons, and the bottom panel's Needs you tab listing four open items" />

## 8. Delivery

When the reviews, the final check and the tests pass, the plan is delivered the way the project is set up: **pr** opens
one pull request per plan and never merges it; **push** merges into the delivery branch and pushes it. Astera stops and
asks when anything is off, and never force-pushes. The plan tab says **Plan delivered** when it is done.

## Next

- [User guide](guide.md): every view and setting.
- [Concepts](concepts.md): projects, plans, Tasks, consoles and the Host.
- [Jobs](jobs.md): plans on a schedule and from a shell.
- [Troubleshooting](troubleshooting.md): when something does not start.
- Back to the [documentation hub](README.md).
