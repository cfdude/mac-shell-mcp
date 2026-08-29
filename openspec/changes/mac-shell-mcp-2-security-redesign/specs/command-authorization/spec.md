## Purpose

Decides whether a requested program may run with the requested arguments, by admitting only programs and argument shapes whose behavior is bounded, so that authorization rests on what a command provably cannot do rather than on a list of the ways it is known to misbehave.

## ADDED Requirements

### Requirement: Only commands with a bounded argument grammar are admitted

The system SHALL admit a command only where policy declares an **allowlist** of the argument shapes it accepts, and SHALL refuse any argument not matching that allowlist. The system SHALL NOT rely on denylists of forbidden arguments.

A command qualifies for the shipped default set only where a bounded grammar can be stated under which it **cannot name another program or script for execution, cannot write to or create any path, and cannot reach a path the system did not scope-check**. Anything failing that test SHALL be absent from the default set and admitted only by explicit human configuration.

A command's declared effect is a **label, not a guarantee**. Where a command offers any facility that writes — regardless of the effect it is declared under — it fails this test. `find` fails it: `-fprintf` and `-fls` write attacker-chosen content to an attacker-chosen path while `find` is naturally declared `read`.

#### Scenario: An argument outside the allowlist is refused

- **WHEN** a request supplies an argument matching no permitted pattern for that command
- **THEN** the request is refused, and the refusal names the permitted argument shapes

#### Scenario: A flag absent from the allowlist is refused with no rule naming it

- **WHEN** a request supplies a flag that would let a command execute another program, and that flag appears in no allowlist for that command
- **THEN** the request is refused without any rule having to name that flag

#### Scenario: Position does not constrain matching

- **WHEN** a command permits patterns for `-l` and for a path, and the request is `ls -l somefile`
- **THEN** the request is permitted, rather than refused for exceeding a positional list

### Requirement: The executed program is authorized, not only its arguments

The system SHALL resolve the requested command to an absolute program path using a resolution that corrects case on case-insensitive filesystems and follows symbolic links, and SHALL perform that resolution **before** both the policy match and the in-root refusal below. It SHALL match policy by **resolved path**, never by basename. Programs SHALL be resolved only from configured program directories, and any program resolving inside a configured root SHALL be refused. A command carrying no declared effect SHALL be refused.

#### Scenario: A program written into a root cannot be executed

- **WHEN** a permitted in-root write creates an executable file named after a permitted command inside a configured root, and a request asks to execute it
- **THEN** the request is refused, because roots hold data rather than programs

#### Scenario: A symlink in a program directory cannot reach into a root

- **WHEN** a program directory contains a symbolic link resolving to a file inside a configured root
- **THEN** the request is refused, because resolution precedes the in-root test

#### Scenario: Basename collision does not grant authority

- **WHEN** a request names a program whose basename matches a permitted command but whose resolved path is not the permitted program
- **THEN** the request is refused

#### Scenario: A command with no declared effect is refused

- **WHEN** a request names a command for which policy declares no effect
- **THEN** the request is refused rather than defaulting to any effect

### Requirement: The shipped default command set is enumerated and bounded

The system SHALL ship a default set containing only commands satisfying the admission test above, and SHALL document, for each, the bounded grammar under which it holds. The default set SHALL be exactly: `ls`, `pwd`, `echo`, `cat`, `head`, `tail`, `wc`, `grep`, and `rg` — each restricted to an allowlist of flags that select or format output and never write, execute, or read configuration.

`find`, `git`, `rm`, and every command interpreter SHALL be absent from the default set. A human MAY add any of them by explicit configuration.

#### Scenario: A write-capable command is absent by default

- **WHEN** a fresh installation's effective policy is inspected
- **THEN** `find` is absent, because `-fprintf` writes attacker-chosen content to an attacker-chosen path while `find` is declared `read`
- **AND** `git` is absent, because local repository configuration executes commands and no environment setting disables it

#### Scenario: Every default command carries a stated grammar

- **WHEN** the default set is inspected
- **THEN** each command carries a flag allowlist under which it cannot execute another program, cannot write any path, and cannot read configuration from its environment

### Requirement: The child environment is constructed, never inherited

The system SHALL construct the environment of every executed command from an allowlist, and SHALL NOT pass the server's own environment through. Variables by which a command loads configuration, selects a helper program, or alters its search path SHALL be absent unless explicitly allowlisted.

#### Scenario: A configuration variable cannot smuggle in a helper program

- **WHEN** a request runs `rg` and the server's environment contains `RIPGREP_CONFIG_PATH` pointing at a file that specifies a pre-processor command
- **THEN** the command runs without that variable, because the child environment is built from an allowlist
- **AND** no argument allowlist could have caught this, since the variable never appears in the argument vector

#### Scenario: Search-path variables are not inherited

- **WHEN** any command is executed
- **THEN** the child receives no inherited `PATH`, and program resolution does not consult one

### Requirement: Confined authorization is computed from effect and scope

For `execute_command`, the system SHALL classify every request by **effect** (`read` or `write`) crossed with **scope** — whether every path-shaped argument resolves inside a configured root — and SHALL then apply the command's configured permission of `allow`, `ask`, or `deny`. A request reaching outside the configured roots SHALL be refused by this tool. `execute_pipeline` is confined identically but restricted further to read-effect stages, as specified in the command-execution capability.

#### Scenario: Read inside a configured root is permitted

- **WHEN** `grep pattern ./src/index.ts` is requested through `execute_command`, the path resolves inside a configured root, and `grep`'s permission is `allow`
- **THEN** the command executes without prompting

#### Scenario: The same read outside every root is refused by the confined tool

- **WHEN** `grep AKIA ~/.aws/credentials` is requested through `execute_command`
- **THEN** the request is refused, the refusal states that the path lies outside the configured roots, and it names `execute_external_command` as the tool for out-of-root work

#### Scenario: A command whose permission is `ask` is not executed silently

- **WHEN** a request names a command whose configured permission is `ask` and every other rule permits it
- **THEN** the request is not executed on this call, and the outcome follows the interactive-client rule in the policy-configuration capability

#### Scenario: No configured roots refuses everything confined

- **WHEN** any command is requested through `execute_command` and no roots are configured
- **THEN** the request is refused and the refusal names the allowed commands and states where roots are configured

### Requirement: Out-of-root work is reachable only through the external tool

The system SHALL expose `execute_external_command` as the sole means of operating outside the configured roots. Requests through it SHALL be subject to program authorization, the argument allowlist, the constructed environment, and the command's permission.

A command's permission SHALL be a function of **both the command and the scope**: reaching outside the configured roots SHALL default to `ask`, independently of that command's confined permission, so that the server retains a decision rather than delegating the whole boundary to the host's per-tool setting. Where the client is not interactive, `ask` denies.

#### Scenario: Out-of-root access is gated even for an otherwise-permitted command

- **WHEN** `execute_external_command` is called with `cat` against a path outside every configured root, and `cat`'s confined permission is `allow`
- **THEN** the out-of-root permission of `ask` applies rather than `allow`
- **AND** the request is refused where the client is not interactive

#### Scenario: The external tool executes when the out-of-root permission permits

- **WHEN** `execute_external_command` is called with a permitted command outside the roots and the out-of-root permission resolves to allow
- **THEN** the command executes and its result is returned

#### Scenario: The external tool still enforces every other rule

- **WHEN** `execute_external_command` is called with an argument matching no permitted pattern
- **THEN** the request is refused

### Requirement: Tools carry truthful annotations

The system SHALL declare MCP annotations that accurately describe each tool: `execute_command` with `openWorldHint: false` and `readOnlyHint: false`; `execute_external_command` with `openWorldHint: true`; `execute_pipeline` with `openWorldHint: false` and `readOnlyHint: true`; and the reporting tools with `readOnlyHint: true`.

#### Scenario: Annotations match actual behavior

- **WHEN** a client lists the available tools
- **THEN** `execute_command` reports `readOnlyHint: false`, because it can write inside roots
- **AND** `execute_pipeline` reports `readOnlyHint: true` and `openWorldHint: false`

### Requirement: Path-shaped arguments are resolved and confined

The system SHALL treat an argument as path-shaped when it is not a flag and either contains a path separator or `~`, or resolves to an existing filesystem entry, resolving relative paths against the request's working directory. Where an argument attaches a value to a flag — separated by `=` or joined to a short flag — the system SHALL scope-check the attached value as a candidate path. Paths SHALL be compared after resolving symbolic links, after case-correcting on case-insensitive filesystems, and on whole path segments.

#### Scenario: An attached flag value is scope-checked

- **WHEN** a request passes `--output=/etc/passwd` or `-o/etc/passwd`
- **THEN** the attached value is treated as a candidate path and scope-checked

#### Scenario: A symlink pointing outside a root does not escape

- **WHEN** a request names a path inside a configured root that is a symbolic link resolving outside every root
- **THEN** the request is treated as out-of-scope

#### Scenario: A sibling directory with a shared prefix is not treated as inside

- **WHEN** a root is `/tmp/foo` and the request names `/tmp/foobar/x`
- **THEN** the request is treated as out-of-scope

#### Scenario: A non-path argument is not mistaken for a path

- **WHEN** `grep -r pattern /dir` is requested
- **THEN** `/dir` is scope-checked and `pattern` is not

#### Scenario: An argument that cannot be classified fails closed

- **WHEN** an argument such as `@responsefile` or `-` cannot be confidently classified
- **THEN** it is treated as out-of-scope rather than assumed confined

### Requirement: No tool mutates policy

The system SHALL NOT expose any tool that adds, removes, or re-classifies a command, or that approves or denies a queued request. Policy SHALL be immutable for the lifetime of the process.

#### Scenario: Policy-mutating tools are absent from the tool list

- **WHEN** a client lists the available tools
- **THEN** `add_to_whitelist`, `update_security_level`, `remove_from_whitelist`, `approve_command`, `deny_command`, `get_pending_commands`, and `get_whitelist` are all absent

#### Scenario: A denied command cannot be promoted

- **WHEN** a client attempts to reach any policy-mutating tool by name
- **THEN** the call fails as an unknown tool, and the set of permitted commands is unchanged

### Requirement: The agent can always discover what is permitted

The system SHALL expose a read-only means of reporting the effective policy — permitted commands with their effects, permitted argument shapes and permissions, and the configured roots. This SHALL always be available and SHALL NOT be disableable, so that a client can never be left unable to determine what is allowed.

#### Scenario: Policy is reported without being mutable

- **WHEN** a client requests the effective policy
- **THEN** the permitted commands, their effects, argument shapes and permissions, and the configured roots are returned, and no means of altering any of them is offered

#### Scenario: Policy reporting cannot be switched off

- **WHEN** policy omits the reporting tool from its enabled tools
- **THEN** the reporting tool remains available, because a client unable to discover the policy cannot use the server correctly

#### Scenario: Reporting policy discloses nothing beyond policy

- **WHEN** the effective policy is reported
- **THEN** it contains only configured policy values, and no filesystem contents
