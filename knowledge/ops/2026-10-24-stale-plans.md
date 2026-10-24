# Stale plans: archive report (2026-10-24)

Task tsk_47a6d0b8398f4893 (dispatch dsp_ef017537260c060e).

## Result

**Nothing archived.** Every `astera jobs archive` call was refused with
`PERMISSION_DENIED: worker sessions cannot call jobs-archive`. The
orchestrator had no coordinator reading its inbox, so no approval came back.
No Job, worktree, branch, session or file was changed or deleted.

Re-check on 2026-10-24 (before the refused archive calls):

- All 16 listed Jobs still show `progress` 0/0 Tasks.
- Outcomes: 14 `running`, 2 `pending` (waiting for approval).
- No live session (`astera sessions list --json`) has a cwd matching any listed
  Job's worktree.
- Jobs `job_80750839c050f0de` and `job_2855f8a41a9d0034` were not touched.

## Table

| Job id | Title / objective (first words) | Outcome | Action | Worktree left with work |
|---|---|---|---|---|
| job_315708343a01d3a3 | W8 + W9 + W10 (as written) | running, 0/0 | NOT archived: permission denied | path missing on disk |
| job_fcb828931cb32d1d | Resolve GitHub issue #113 (Start-page plan title) | running, 0/0 | NOT archived: permission denied | path missing on disk |
| job_de513e6ada104987 | Resolve GitHub issues #112, #113, #111, #106, … | running, 0/0 | NOT archived: permission denied | path missing on disk |
| job_e50932958a135974 | Resolve GitHub issues #116, #117, #119 | running, 0/0 | NOT archived: permission denied | path missing on disk |
| job_52e32916f81f6562 | I want to add telegram connection with the slack connection | running, 0/0 | NOT archived: permission denied | path missing on disk |
| job_6710c0d8f8adf34e | tasks progress in the agents page is always 0/0 | running, 0/0 | NOT archived: permission denied | path missing on disk |
| job_ce6cc7e66316ff85 | i want the usage to be more frictionless | running, 0/0 | NOT archived: permission denied | path missing on disk |
| job_862bbe41bfb22c25 | Please I want this as autoamted as possible | running, 0/0 | NOT archived: permission denied | path missing on disk |
| job_84a0320b42ea6773 | Okay so the first goal is to get rid of the way we create a job | running, 0/0 | NOT archived: permission denied | path missing on disk |
| job_3cbbd9b700d05e95 | okay so there is a bunch of bugs for astera | running, 0/0 | NOT archived: permission denied | path missing on disk |
| job_10cd81997c7b0877 | Fix: plans filed under a sub-project are invisible | running, 0/0 | NOT archived: permission denied | **yes**: `/home/jonx/astera-worktrees/Astera/Fix-plans-filed-under-a-sub-project-are`, branch `JanoTheDev/Fix-plans-filed-under-a-sub-project-are`, 11 commits not in base, clean |
| job_0f0a4ec69bb307d7 | Also: every finished worker, reviewer and coordinator tab shows "Exited" | running, 0/0 | NOT archived: permission denied | **yes**: `/home/jonx/astera-worktrees/Astera/Also-every-finished-worker-reviewer-and`, branch `JanoTheDev/Also-every-finished-worker-reviewer-and`, 3 commits not in base, clean |
| job_d181eb1769b5d6e5 | Fix Astera's delivery bugs: a Task can be marked completed | running, 0/0 | NOT archived: permission denied | path missing on disk |
| job_bcc8ab3f67120715 | Fix what the 2026-10-20 Gameful run showed is still broken | running, 0/0 | NOT archived: permission denied | path missing on disk |
| job_772d51343499f246 | So one issue i have is there is alot of friction while using the app | pending, 0/0 | NOT archived: permission denied | no worktree |
| job_15ccffa0add7ed88 | A coordinator's decision for the owner always reaches the owner as an… | pending, 0/0 | NOT archived: permission denied | no worktree |

"path missing on disk" means the run's `worktree` path does not exist and
`git worktree list` does not show it.

## Unarchive commands

Run these after the archive (none are needed until something is archived):

```
astera jobs unarchive --id job_315708343a01d3a3
astera jobs unarchive --id job_fcb828931cb32d1d
astera jobs unarchive --id job_de513e6ada104987
astera jobs unarchive --id job_e50932958a135974
astera jobs unarchive --id job_52e32916f81f6562
astera jobs unarchive --id job_6710c0d8f8adf34e
astera jobs unarchive --id job_ce6cc7e66316ff85
astera jobs unarchive --id job_862bbe41bfb22c25
astera jobs unarchive --id job_84a0320b42ea6773
astera jobs unarchive --id job_3cbbd9b700d05e95
astera jobs unarchive --id job_10cd81997c7b0877
astera jobs unarchive --id job_0f0a4ec69bb307d7
astera jobs unarchive --id job_d181eb1769b5d6e5
astera jobs unarchive --id job_bcc8ab3f67120715
astera jobs unarchive --id job_772d51343499f246
astera jobs unarchive --id job_15ccffa0add7ed88
```

## To finish

A caller with coordinator permission runs, for each id in the table:

```
astera jobs archive --id <id> --json
```

Then `astera jobs list --json` should show none of them as running or pending.
The two worktrees with unmerged commits must stay on disk.
