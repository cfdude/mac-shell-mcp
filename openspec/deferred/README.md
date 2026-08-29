# Deferred specs

Specs written, reviewed, and deliberately **not** shipped in the release they were drafted for.
Kept because the design work is sound and the reason for deferral is mechanical, not a change of mind.

## `delete-safety-2.1.md` — deferred from 2.0 on 2026-08-28

The git-aware recoverability ladder (tracked/clean/pushed vs untracked vs **ignored-inside-a-repo**,
which looks protected and is not) is good design and should ship eventually.

It was cut from 2.0 because **the confirmation step has no trustworthy carrier in MCP today.** A
delete needs a human to see what will be destroyed before agreeing. Two adversarial review rounds
established that:

- an approval queue in this server is the CWE-862 defect being fixed, under a new name;
- a `confirm: true` parameter is one the agent sets itself;
- and the host's approval prompt renders the tool name and **the arguments the model chose** — so a
  report returned to the model never reaches the human at all.

Deleting nothing is not a regression: `rm` is `FORBIDDEN` in 1.x, so 2.0 ships the same capability
1.x had.

**Revisit when** the target host supports MCP `elicitation` — a server-initiated prompt the human
answers and the agent cannot. That is the missing channel. At that point this spec needs one
addition before it is safe: the first call must issue a server-side token binding
`(st_dev, st_ino)` plus a content digest with a short expiry, and the deleting call must present it,
so the target cannot be swapped between the report and the deletion.
