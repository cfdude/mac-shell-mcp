## Purpose

Loads the server's authorization policy from a file that the server itself can never modify, so that the same policy model works across every host and cannot be widened by the agent it governs.

## ADDED Requirements

### Requirement: Policy is discovered in a fixed order and never merged

The system SHALL locate its policy by checking, in order: an explicitly configured path, a file in the user's home configuration directory, host-supplied environment configuration, and finally built-in defaults. The first source found SHALL be used in full. Sources SHALL NOT be merged.

**Policy is never read from the working directory.** A working-directory source would let a cloned repository supply the policy governing the agent that opens it, and defending that with a change-detection gate proved to generate more defects than it closed. Per-project configuration is served by the explicit path, which a container image or host configuration sets deliberately.

#### Scenario: A config file supersedes host environment configuration

- **WHEN** both a config file and host-supplied environment configuration are present
- **THEN** the config file is used in full
- **AND** startup output names the file that won and reports that the environment configuration was ignored

#### Scenario: Environment configuration is used when no file exists

- **WHEN** no config file is found at any searched location and host-supplied environment configuration is present
- **THEN** the environment configuration is used

#### Scenario: The active source is discoverable

- **WHEN** the server starts
- **THEN** it reports which policy source was used

### Requirement: Policy is immutable for the lifetime of the process

The system SHALL read policy once at startup and SHALL NOT re-read or modify it while running.

#### Scenario: Editing the file mid-run has no effect

- **WHEN** the policy file is changed while the server is running
- **THEN** the running server's decisions are unchanged until it is restarted

### Requirement: The server cannot modify its own policy, program directories, or audit trail

The system SHALL refuse every request that **would write to, create, replace, or remove** any protected location — judged by the operation the request performs, **not by the command's declared effect**, since a command declared `read` may still offer a facility that writes. Protected locations are, or lie within:

- any path in the policy discovery order — not only the active one — or **any ancestor directory** of such a path;
- any configured **program directory**, or any entry within it;
- the **audit log directory** and every file in it, not only the currently active log file.

Each of these SHALL have a documented default location, since a path the system cannot name is a path it cannot protect. By default the audit log directory and the home configuration file both reside under a single `mac-shell-mcp` directory in the user's home configuration area.

This SHALL hold regardless of configured roots, regardless of the command's permissions, and regardless of any exemption expressed in policy itself.

Protected locations SHALL be identified by **filesystem identity — device and inode — captured at startup**, and additionally by path, so that a location holding no file at startup is still protected from having one created. The system SHALL refuse any request creating a hard or symbolic link where either operand resolves to a protected location, and SHALL refuse renaming or removing any protected ancestor directory. Reading a policy file SHALL remain permitted.

#### Scenario: A read-declared command with a write facility is still refused

- **WHEN** a command whose declared effect is `read` is asked to write to a protected location through a facility such as an output-file flag
- **THEN** the request is refused, because protection keys on the operation rather than the declared effect

#### Scenario: Program directories cannot be written

- **WHEN** a request writes or replaces a file inside a configured program directory
- **THEN** the request is refused, because a program directory that the agent can write is a program the agent can author

#### Scenario: An ancestor directory cannot be renamed out of the way

- **WHEN** a request renames or removes a directory that contains a policy discovery location
- **THEN** the request is refused, because recreating the path afterwards would yield a fresh, unprotected file

#### Scenario: The server cannot unlock its own policy

- **WHEN** a request runs `chmod` against the active policy file
- **THEN** the request is refused, even if `chmod` is otherwise permitted and the file lies inside a configured root

#### Scenario: Removing the policy file is refused

- **WHEN** a request would remove or replace the active policy file by any means
- **THEN** the request is refused, because protection covers the operation rather than the command's label

#### Scenario: The policy file cannot be replaced

- **WHEN** a request runs `mv` or `cp` with the active policy file as its destination
- **THEN** the request is refused, because replacing a file requires no write permission on the file itself

#### Scenario: A path differing only by case is still protected

- **WHEN** a request targets the policy file using different letter case on a case-insensitive filesystem
- **THEN** the request is refused, because protection compares filesystem identity rather than the path string

#### Scenario: A hard link cannot launder access to the policy file

- **WHEN** a request creates a hard link to the policy file inside a configured root, or writes through such a link
- **THEN** the request is refused

#### Scenario: An inactive discovery location is protected too

- **WHEN** a request writes a policy file into a configured working directory while policy is currently supplied by the home configuration file
- **THEN** the request is refused, because every location in the discovery order is protected

#### Scenario: The audit trail cannot be rewritten or removed

- **WHEN** a request runs any write-effect command against the audit log directory, the active log, or any rotated log file
- **THEN** the request is refused, so that rotation cannot be used to age records out of protection

#### Scenario: Policy cannot exempt itself

- **WHEN** the policy file declares its own path as permitted or excluded from protection
- **THEN** the declaration has no effect and the protection still applies

#### Scenario: Reading policy is allowed

- **WHEN** a request reads the active policy file with a permitted read command
- **THEN** the request succeeds

### Requirement: Policy declares roots, programs, commands, effects, argument allowlists, tools, and permissions

The system SHALL accept: configured roots; the program directories from which commands may be resolved; permitted commands, each carrying its **effect** (`read` or `write` — there is no delete effect in this release) and its **allowlist of permitted argument shapes**; denied commands; enabled tools; and a per-command permission of `allow`, `ask`, or `deny`.

A command declaring no argument allowlist SHALL accept no arguments. A denied command SHALL remain denied even if also listed as permitted. A tool that is not enabled SHALL NOT be offered, except the policy-reporting tool, which is always available.

#### Scenario: A command with no argument allowlist accepts no arguments

- **WHEN** policy permits a command but declares no argument shapes for it
- **THEN** requests supplying any argument are refused, because absent an allowlist there is nothing an argument can match

#### Scenario: A command's effect comes from policy

- **WHEN** the effective policy is inspected
- **THEN** every permitted command carries an effect, which is what the authorization decision consumes

#### Scenario: Denial beats permission

- **WHEN** a command appears in both the permitted and denied lists
- **THEN** requests for it are refused

#### Scenario: A disabled tool is not exposed

- **WHEN** the policy omits a tool from the enabled tools
- **THEN** that tool is absent when a client lists available tools

### Requirement: `ask` requires an interactive client and otherwise denies

The system SHALL treat a client as interactive **only** where it declares the MCP `elicitation` capability at session initialisation — the sole capability meaning a human can be asked a question. The system SHALL NOT infer interactivity from `sampling`, which asserts that a model will answer, nor from `roots`. Where a command's permission is `ask` and the client is not interactive by that test, the system SHALL refuse the request. It SHALL NOT treat `ask` as `allow`.

#### Scenario: A client offering only model-answered prompts is not interactive

- **WHEN** a client declares `sampling` but not `elicitation`, and a command whose permission is `ask` is requested
- **THEN** the request is refused, because `sampling` routes the question to a model rather than a human

#### Scenario: Headless operation refuses rather than permits

- **WHEN** a command whose permission is `ask` is requested and the client declared no `elicitation` capability
- **THEN** the request is refused, and startup output records that `ask` was downgraded to `deny`

#### Scenario: An elicitation-capable client is asked

- **WHEN** a command whose permission is `ask` is requested and the client declared `elicitation`
- **THEN** the human is asked before the command runs

### Requirement: The constructed environment is a closed set

The environment allowlist SHALL be a **closed set of server-supplied constants**, with no value passed through from the server's own environment. Where a variable is required for correct behavior it SHALL be set by the server to a known value rather than inherited.

#### Scenario: Nothing is inherited, including variables that look harmless

- **WHEN** any command executes
- **THEN** its environment contains only server-supplied constants, and no variable's value originates from the server's own environment

#### Scenario: An empty base environment is workable

- **WHEN** each command in the default set runs with no inherited environment
- **THEN** it functions correctly, character-counting behavior aside, so no inherited variable is required

### Requirement: A root must be a bounded working location

The system SHALL refuse to accept the user's home directory or the filesystem root as a configured root, and SHALL report at startup any configured root containing well-known credential locations. A root is intended to be a project or working directory.

#### Scenario: An over-broad root is refused

- **WHEN** policy configures the user's home directory or `/` as a root
- **THEN** the server refuses to start with that policy and names the offending root

#### Scenario: A root containing credentials is reported

- **WHEN** a configured root contains a well-known credential location — an `.ssh` or `.aws` directory, an `.env` file, a `.git/config` (whose remotes may embed tokens), an `.npmrc`, or a private-key file
- **THEN** the server reports each at startup, because confinement makes everything inside a root freely readable by a single recursive search

### Requirement: A fresh installation is safe and self-explanatory

The system SHALL default to the enumerated read-only command set, to program directories of `/usr/bin`, `/bin`, `/usr/sbin` and `/sbin`, and to **no configured roots**, so that every request is refused until a human configures roots. Program directories SHALL have a working default, since a command set that resolves no programs cannot run at all. Each refusal SHALL name the permitted commands and state where configuration is supplied.

#### Scenario: An unconfigured install refuses but teaches

- **WHEN** any command is requested on a fresh installation
- **THEN** the request is refused
- **AND** the refusal names the permitted commands and points to the configuration location

### Requirement: Host-supplied configuration fields carry defaults without blocking installation

Where the system is distributed as a host extension, every configuration field that carries a default value SHALL be declared optional, so that installation completes and the connector enables without human interaction. A genuinely missing required value SHALL still produce a clear startup error.

#### Scenario: An extension install needs no manual form entry

- **WHEN** the extension is installed and every configuration field carrying a default is declared optional
- **THEN** the connector enables without the human editing the configuration form

#### Scenario: A missing required value still fails loudly

- **WHEN** a value with no default is absent at startup
- **THEN** the server reports a clear error naming the missing value
