## Purpose

Decides whether a requested command may run, by combining what the command does to the filesystem with where its arguments actually resolve, so that authorization reflects blast radius rather than a command's name.

## ADDED Requirements

### Requirement: Authorization is computed from effect and scope

The system SHALL classify every request by **effect** (`read`, `write`, or `delete`, a static property of the command) crossed with **scope** (whether every path-shaped argument resolves inside a configured root). The system SHALL NOT authorize on the command name alone.

#### Scenario: Read inside a configured root is permitted

- **WHEN** `grep pattern ./src/index.ts` is requested and `./src/index.ts` resolves inside a configured root
- **THEN** the command executes without prompting

#### Scenario: The same read outside every root is refused

- **WHEN** `grep AKIA ~/.aws/credentials` is requested and no configured root contains that path
- **THEN** the request is refused, and the refusal states that the path lies outside the configured roots

#### Scenario: Write inside a root is permitted

- **WHEN** `mkdir ./build` is requested and `./build` resolves inside a configured root
- **THEN** the command executes, even though its effect is `write`

#### Scenario: No configured roots refuses everything

- **WHEN** any command is requested and no roots are configured
- **THEN** the request is refused and the refusal names the allowed commands and states where roots are configured

### Requirement: Tools are split by confinement and carry truthful annotations

The system SHALL expose `execute_command` for confined, non-delete requests and `execute_external_command` for requests that reach outside configured roots or delete. Each tool SHALL declare MCP annotations that accurately describe it: `execute_command` with `openWorldHint: false` and `readOnlyHint: false`, and `execute_external_command` with `openWorldHint: true` and `destructiveHint: true`.

#### Scenario: An out-of-scope call to the confined tool is refused, not rerouted

- **WHEN** `execute_command` is called with an argument resolving outside every configured root
- **THEN** the call is refused and the refusal names `execute_external_command` as the correct tool
- **AND** the command does not execute

#### Scenario: A delete requested through the confined tool is refused

- **WHEN** `execute_command` is called with a command whose effect is `delete`
- **THEN** the call is refused and names `execute_external_command`

#### Scenario: Annotations match actual behavior

- **WHEN** a client lists the available tools
- **THEN** `execute_command` reports `readOnlyHint: false`, because it can write inside roots
- **AND** `execute_pipeline` reports `readOnlyHint: true`, because its stages are restricted to read-effect commands

### Requirement: No tool mutates policy

The system SHALL NOT expose any tool that adds, removes, or re-classifies a command, or that approves or denies a queued request. Policy SHALL be immutable for the lifetime of the process.

#### Scenario: Policy-mutating tools are absent from the tool list

- **WHEN** a client lists the available tools
- **THEN** `add_to_whitelist`, `update_security_level`, `remove_from_whitelist`, `approve_command`, `deny_command`, and `get_pending_commands` are all absent

#### Scenario: A denied command cannot be promoted

- **WHEN** a client attempts to reach any policy-mutating tool by name
- **THEN** the call fails as an unknown tool
- **AND** the set of permitted commands is unchanged

### Requirement: Path-shaped arguments are resolved and confined

The system SHALL treat an argument as path-shaped when it is not a flag and either contains a path separator or `~`, or resolves to an existing filesystem entry, resolving relative paths against the request's working directory. The system SHALL compare paths after resolving symbolic links, and SHALL compare on whole path segments.

#### Scenario: A symlink pointing outside a root does not escape

- **WHEN** a request names a path inside a configured root that is a symbolic link resolving outside every root
- **THEN** the request is treated as out-of-scope

#### Scenario: A sibling directory with a shared prefix is not treated as inside

- **WHEN** a root is `/tmp/foo` and the request names `/tmp/foobar/x`
- **THEN** the request is treated as out-of-scope

#### Scenario: A non-path argument is not mistaken for a path

- **WHEN** `grep -r pattern /dir` is requested
- **THEN** `/dir` is scope-checked and `pattern` is not

#### Scenario: An ambiguous argument fails closed

- **WHEN** an argument cannot be confidently classified as a path or a non-path
- **THEN** it is treated as out-of-scope rather than assumed confined

### Requirement: Commands that can escape their effect class are constrained by argument

The system SHALL refuse arguments that let a command execute other programs or delete despite its declared effect.

#### Scenario: find cannot execute arbitrary programs

- **WHEN** a request passes `-exec`, `-execdir`, `-ok`, `-okdir`, `-delete`, or `-fprintf` to `find`
- **THEN** the request is refused and names the offending argument

#### Scenario: git cannot be used to destroy work

- **WHEN** a request invokes `git clean` with `-fdx`, `git reset --hard`, `git push --force`, `git push --force-with-lease`, or `git checkout -- .`
- **THEN** the request is refused
- **AND** other `git` subcommands remain available, because `git` is the recovery mechanism relied on elsewhere

### Requirement: Argument allowlists match as a set and reject on mismatch

Where a command declares permitted argument patterns, the system SHALL require every supplied argument to match at least one pattern, independent of position, and SHALL refuse the request when any argument matches none.

#### Scenario: Position does not constrain matching

- **WHEN** a command permits the pattern for `-l` and the request is `ls -l somefile`
- **AND** `somefile` also matches a permitted pattern
- **THEN** the request is permitted, rather than refused for exceeding a positional list

#### Scenario: An unmatched argument is refused outright

- **WHEN** a request supplies an argument matching no permitted pattern
- **THEN** the request is refused rather than downgraded to a lesser tier
