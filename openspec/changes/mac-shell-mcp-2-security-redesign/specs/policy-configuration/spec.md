## Purpose

Loads the server's authorization policy from a file that the server itself can never modify, so that the same policy model works across every host and cannot be widened by the agent it governs.

## ADDED Requirements

### Requirement: Policy is discovered in a fixed order and never merged

The system SHALL locate its policy by checking, in order: an explicitly configured path, a file in the working directory, a file in the user's home configuration directory, host-supplied environment configuration, and finally built-in defaults. The first source found SHALL be used in full. Sources SHALL NOT be merged.

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

### Requirement: A policy appearing at a new location is reported before it takes effect

Because the discovery order prefers the working directory over the home directory, a file created inside a working directory would silently take precedence on the next start. The system SHALL record, on each run, both which source supplied policy **and that source's filesystem identity**. Where either the winning source or its identity differs from the previously recorded run, the system SHALL report the change at startup and SHALL NOT adopt the new source until a human acknowledges it out of band. The record of the previous run SHALL itself be a protected location.

#### Scenario: A newly appeared higher-precedence config does not silently win

- **WHEN** policy was previously supplied by the home configuration file, and a config file now exists in the working directory
- **THEN** startup reports that the winning source changed and does not adopt the new file unattended

#### Scenario: Replacing the file at the same path is still detected

- **WHEN** the winning source is at the same path as the previous run but its filesystem identity has changed
- **THEN** the change is reported, because keying on the discovery slot alone would miss a replaced file

#### Scenario: An unchanged source starts normally

- **WHEN** the winning source is the same as the previous run's
- **THEN** startup proceeds without prompting

### Requirement: Policy is immutable for the lifetime of the process

The system SHALL read policy once at startup and SHALL NOT re-read or modify it while running.

#### Scenario: Editing the file mid-run has no effect

- **WHEN** the policy file is changed while the server is running
- **THEN** the running server's decisions are unchanged until it is restarted

### Requirement: The server cannot modify its own policy, program directories, or audit trail

The system SHALL refuse every write-effect command whose resolved target is, or lies within:

- any path in the policy discovery order — not only the active one — or **any ancestor directory** of such a path;
- any configured **program directory**, or any entry within it;
- the **audit log directory** and every file in it, not only the currently active log file.

This SHALL hold regardless of configured roots, regardless of the command's permissions, and regardless of any exemption expressed in policy itself.

Protected locations SHALL be identified by **filesystem identity — device and inode — captured at startup**, and additionally by path, so that a location holding no file at startup is still protected from having one created. The system SHALL refuse any request creating a hard or symbolic link where either operand resolves to a protected location, and SHALL refuse renaming or removing any protected ancestor directory. Reading a policy file SHALL remain permitted.

#### Scenario: Program directories cannot be written

- **WHEN** a request writes or replaces a file inside a configured program directory
- **THEN** the request is refused, because a program directory that the agent can write is a program the agent can author

#### Scenario: An ancestor directory cannot be renamed out of the way

- **WHEN** a request renames or removes a directory that contains a policy discovery location
- **THEN** the request is refused, because recreating the path afterwards would yield a fresh, unprotected file

#### Scenario: The server cannot unlock its own policy

- **WHEN** a request runs `chmod` against the active policy file
- **THEN** the request is refused, even if `chmod` is otherwise permitted and the file lies inside a configured root

#### Scenario: Deleting the policy file is refused

- **WHEN** a request runs a delete-effect command against the active policy file
- **THEN** the request is refused, because protection covers delete as well as write

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

The system SHALL accept: configured roots; the program directories from which commands may be resolved; permitted commands, each carrying its **effect** and its **allowlist of permitted argument shapes**; denied commands; enabled tools; and a per-command permission of `allow`, `ask`, or `deny`.

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

### Requirement: A fresh installation is safe and self-explanatory

The system SHALL default to a read-only command set and no configured roots, so that every request is refused until a human configures roots. Each refusal SHALL name the permitted commands and state where configuration is supplied.

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
