## Purpose

Decides whether a requested program may run with the requested arguments, by authorizing the program itself and then combining what it does to the filesystem with where its arguments actually resolve, so that authorization reflects blast radius rather than a command's name.

## ADDED Requirements

### Requirement: The executed program is authorized, not only its arguments

The system SHALL resolve the requested command to an absolute program path before authorizing it, and SHALL match it against policy by that **resolved path**, never by basename alone. The system SHALL resolve programs only from a configured set of program directories, and SHALL refuse to execute any program whose resolved path lies inside a configured root. A command carrying no declared effect SHALL be refused.

#### Scenario: A program written into a root cannot be executed

- **WHEN** a permitted in-root write creates a file named `ls` inside a configured root, it is made executable, and a request asks to execute it
- **THEN** the request is refused, because roots hold data rather than programs
- **AND** the refusal does not depend on the file's name

#### Scenario: Basename collision does not grant authority

- **WHEN** a request names a program whose basename matches a permitted command but whose resolved path is not the permitted program
- **THEN** the request is refused

#### Scenario: A command with no declared effect is refused

- **WHEN** a request names a command for which policy declares no effect
- **THEN** the request is refused rather than defaulting to any effect

### Requirement: Commands that can execute other programs are denied as a class

The system SHALL treat a command as **exec-capable** when it can spawn a process, evaluate code, or invoke a shell, and SHALL refuse every exec-capable command unless policy names it explicitly. This class SHALL include at minimum command interpreters, scripting languages, and text processors offering a system-execution facility.

The system SHALL state, in its published documentation, that per-command argument rules cover only the commands they name and are not a general defence.

#### Scenario: A text processor with a system facility is refused

- **WHEN** a request runs `awk` with a program text invoking its `system()` facility
- **THEN** the request is refused because `awk` is exec-capable, regardless of whether any argument is path-shaped

#### Scenario: An interpreter is refused by class, not by enumeration

- **WHEN** a request runs `perl`, `python`, `ruby`, `node`, `osascript`, `env`, `xargs`, or `sh` with any arguments
- **THEN** the request is refused because each is exec-capable

#### Scenario: Explicit policy can still enable one

- **WHEN** policy names an exec-capable command explicitly
- **THEN** it may run, subject to every other rule

### Requirement: Authorization is computed from effect and scope

The system SHALL classify every request by **effect** (`read`, `write`, or `delete`) crossed with **scope** (whether every path-shaped argument resolves inside a configured root), and SHALL then apply the command's configured permission of `allow`, `ask`, or `deny`. The system SHALL NOT authorize on the command name alone.

#### Scenario: Read inside a configured root is permitted

- **WHEN** `grep pattern ./src/index.ts` is requested, the path resolves inside a configured root, and `grep`'s permission is `allow`
- **THEN** the command executes without prompting

#### Scenario: The same read outside every root is refused

- **WHEN** `grep AKIA ~/.aws/credentials` is requested and no configured root contains that path
- **THEN** the request is refused, and the refusal states that the path lies outside the configured roots

#### Scenario: A command whose permission is `ask` is not executed silently

- **WHEN** a request names a command whose configured permission is `ask`, and every other rule permits it
- **THEN** the request is not executed on this call
- **AND** the outcome follows the interactive-client rule in the policy-configuration capability

#### Scenario: No configured roots refuses everything

- **WHEN** any command is requested and no roots are configured
- **THEN** the request is refused and the refusal names the allowed commands and states where roots are configured

### Requirement: Tools are split by confinement and carry truthful annotations

The system SHALL expose `execute_command` for confined, non-delete requests and `execute_external_command` for requests that reach outside configured roots or delete. Each tool SHALL declare MCP annotations that accurately describe it: `execute_command` with `openWorldHint: false` and `readOnlyHint: false`; `execute_external_command` with `openWorldHint: true` and `destructiveHint: true`; `execute_pipeline` with `openWorldHint: false` and `readOnlyHint: true`.

#### Scenario: An out-of-scope call to the confined tool is refused, not rerouted

- **WHEN** `execute_command` is called with an argument resolving outside every configured root
- **THEN** the call is refused and the refusal names `execute_external_command` as the correct tool
- **AND** the command does not execute

#### Scenario: A delete requested through the confined tool is refused

- **WHEN** `execute_command` is called with a command whose effect is `delete`
- **THEN** the call is refused and names `execute_external_command`

#### Scenario: The external tool executes when policy permits

- **WHEN** `execute_external_command` is called with a permitted command whose arguments resolve outside the configured roots, and that command's permission is `allow`
- **THEN** the command executes and its result is returned
- **AND** it is refused only where policy refuses it, never merely because it is out of scope

#### Scenario: Annotations match actual behavior

- **WHEN** a client lists the available tools
- **THEN** `execute_command` reports `readOnlyHint: false`, because it can write inside roots
- **AND** `execute_pipeline` reports `readOnlyHint: true` and `openWorldHint: false`

### Requirement: Path-shaped arguments are resolved and confined

The system SHALL treat an argument as path-shaped when it is not a flag and either contains a path separator or `~`, or resolves to an existing filesystem entry, resolving relative paths against the request's working directory. Where an argument attaches a value to a flag — whether separated by `=` or joined to a short flag — the system SHALL scope-check the attached value as a candidate path. The system SHALL compare paths after resolving symbolic links and after case-correcting them on case-insensitive filesystems, and SHALL compare on whole path segments.

#### Scenario: An attached flag value is scope-checked

- **WHEN** a request passes `--output=/etc/passwd` or `-o/etc/passwd`
- **THEN** the attached value is treated as a candidate path and scope-checked
- **AND** the request is refused when it resolves outside every root

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

- **WHEN** an argument such as `@responsefile` or `-` cannot be confidently classified as a path or a non-path
- **THEN** it is treated as out-of-scope rather than assumed confined

### Requirement: Commands that can escape their effect class are constrained by argument

The system SHALL refuse arguments that let a permitted command execute other programs, alter its own configuration, or destroy recoverability. These argument rules SHALL be insensitive to flag order, spelling, and short-flag fusion.

#### Scenario: find cannot execute arbitrary programs

- **WHEN** a request passes `-exec`, `-execdir`, `-ok`, `-okdir`, `-delete`, or `-fprintf` to `find`
- **THEN** the request is refused and names the offending argument

#### Scenario: git cannot be turned into a shell

- **WHEN** a request passes `-c`, `--exec-path`, `-C`, or any configuration-writing subcommand to `git`
- **THEN** the request is refused, because `git -c alias.<name>='!<shell>'` executes arbitrary commands

#### Scenario: git destructive subcommands are refused in any spelling

- **WHEN** a request invokes `git clean` with the force and directory flags in any order or fusion, such as `-fdx`, `-xdf`, or `-x -d -f`
- **THEN** the request is refused
- **AND** the same holds for `git reset --hard`, `git push --force`, `git push --force-with-lease`, and `git checkout -- .`

#### Scenario: git cannot destroy the recoverability the delete rules depend on

- **WHEN** a request invokes `git gc --prune=now` or `git reflog expire --expire=now`
- **THEN** the request is refused, because the delete-safety recoverability report would otherwise report recoverable content that has been destroyed

### Requirement: Argument allowlists match as a set and reject on mismatch

Where a command declares permitted argument patterns, the system SHALL require every supplied argument to match at least one pattern, independent of position, and SHALL refuse the request when any argument matches none.

#### Scenario: Position does not constrain matching

- **WHEN** a command permits the pattern for `-l` and the request is `ls -l somefile`
- **AND** `somefile` also matches a permitted pattern
- **THEN** the request is permitted, rather than refused for exceeding a positional list

#### Scenario: An unmatched argument is refused outright

- **WHEN** a request supplies an argument matching no permitted pattern
- **THEN** the request is refused rather than downgraded to a lesser tier

### Requirement: No tool mutates policy

The system SHALL NOT expose any tool that adds, removes, or re-classifies a command, or that approves or denies a queued request. Policy SHALL be immutable for the lifetime of the process.

#### Scenario: Policy-mutating tools are absent from the tool list

- **WHEN** a client lists the available tools
- **THEN** `add_to_whitelist`, `update_security_level`, `remove_from_whitelist`, `approve_command`, `deny_command`, and `get_pending_commands` are all absent

#### Scenario: A denied command cannot be promoted

- **WHEN** a client attempts to reach any policy-mutating tool by name
- **THEN** the call fails as an unknown tool
- **AND** the set of permitted commands is unchanged

### Requirement: The agent can discover what is permitted

The system SHALL expose a read-only means of reporting the effective policy — the permitted commands, their effects and permissions, and the configured roots — so that a client can determine what is allowed without attempting refused calls.

#### Scenario: Policy is reported without being mutable

- **WHEN** a client requests the effective policy
- **THEN** the permitted commands, their effects and permissions, and the configured roots are returned
- **AND** no means of altering any of them is offered

#### Scenario: Reporting policy does not disclose beyond the policy

- **WHEN** the effective policy is reported
- **THEN** it contains only configured policy values, and no filesystem contents
