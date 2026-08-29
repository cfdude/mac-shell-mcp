## Purpose

Runs authorized commands without a shell and returns results an agent can act on, so that argument content is never interpreted as code and a non-zero exit is distinguishable from a failure to run.

## ADDED Requirements

### Requirement: Commands never run through a shell

The system SHALL execute commands by passing the program and its argument vector directly to the operating system, and SHALL NOT enable shell interpretation. Argument content SHALL be passed through uninterpreted.

#### Scenario: Shell metacharacters are inert

- **WHEN** `echo` is executed with the single argument `hello; id > /tmp/PWNED.txt`
- **THEN** the output is the literal text `hello; id > /tmp/PWNED.txt`
- **AND** no file `/tmp/PWNED.txt` is created
- **AND** no second command runs

#### Scenario: Command substitution is inert

- **WHEN** `echo` is executed with the single argument `$(whoami)`
- **THEN** the output is the literal text `$(whoami)`

#### Scenario: Ordinary filenames are not rejected

- **WHEN** a request names a file whose name contains spaces, parentheses, or square brackets, such as `My File (2).txt`
- **THEN** the request is not refused for containing those characters, because no sanitizing layer exists

### Requirement: Results carry the exit code and distinguish failure to run

The system SHALL return the standard output, standard error, and exit code of every command that runs. A non-zero exit SHALL be reported as a normal result. Only a failure to start the command SHALL be reported as an error.

#### Scenario: A no-match search is a normal result

- **WHEN** `grep` runs and matches nothing, exiting with code 1
- **THEN** the result reports `exitCode: 1` and is not flagged as an error
- **AND** any standard output produced is preserved

#### Scenario: An unrunnable command is an error

- **WHEN** a command cannot be started at all
- **THEN** the result is flagged as an error

#### Scenario: Results are machine-readable

- **WHEN** any command completes
- **THEN** the result is returned as structured content carrying standard output, standard error, exit code, and whether output was truncated

### Requirement: Output is capped and truncated rather than discarded

The system SHALL apply a configurable maximum output size, and where a command exceeds it SHALL return the output collected up to that point, marked as truncated, rather than failing.

#### Scenario: Oversized output truncates

- **WHEN** a command produces more output than the configured maximum
- **THEN** the result contains output up to the cap, reports that it was truncated, and reports how much was omitted
- **AND** the call does not fail

### Requirement: Requests may specify working directory, standard input, and glob expansion

The system SHALL accept a working directory, a text value supplied to the command's standard input, and an explicit request for glob expansion. The working directory SHALL be confined to the configured roots for the confined and pipeline tools, and MAY lie outside them for the external tool, which exists to reach outside. Glob expansion SHALL be confined for the confined and pipeline tools, and SHALL follow the request's scope for the external tool.

#### Scenario: The confined tool refuses an outside working directory

- **WHEN** `execute_command` supplies a working directory outside every configured root
- **THEN** the request is refused

#### Scenario: The external tool may work outside the roots

- **WHEN** `execute_external_command` supplies a working directory outside the configured roots and policy permits the command
- **THEN** the working directory is accepted, because confining it would make the tool unusable for its stated purpose

#### Scenario: Globs are not expanded by default

- **WHEN** `find . -name "*.ts"` is requested without asking for glob expansion
- **THEN** `*.ts` reaches the command literally, so the command performs its own matching

#### Scenario: Requested glob expansion respects the tool's scope

- **WHEN** `execute_command` asks for glob expansion and the pattern would match paths outside every configured root
- **THEN** those matches are excluded

### Requirement: Pipelines run in process and authorize every stage

The system SHALL support composing commands by connecting each stage's standard output to the next stage's standard input, without a shell. Every stage SHALL be authorized independently and completely — program authorization, effect, scope confinement, per-command argument rules, and permission — exactly as the confined tool authorizes a single call. The pipeline SHALL be restricted to read-effect commands **and** to arguments resolving inside the configured roots.

#### Scenario: A later stage cannot inherit an earlier stage's acceptability

- **WHEN** a pipeline requests a permitted read command followed by a delete command
- **THEN** the pipeline is refused
- **AND** no stage executes

#### Scenario: A read-only pipeline cannot reach outside the roots

- **WHEN** a pipeline requests `cat ~/.aws/credentials` followed by `grep AKIA`, where both stages are read-effect
- **THEN** the pipeline is refused, because read effect does not imply confinement
- **AND** no stage executes

#### Scenario: A read-only pipeline succeeds

- **WHEN** a pipeline requests two permitted read-effect commands operating inside configured roots
- **THEN** the first stage's output is supplied to the second, and the final stage's result is returned

### Requirement: Execution is bounded by a timeout

The system SHALL apply a configurable execution timeout to every command and pipeline, and SHALL terminate a command exceeding it, reporting the timeout distinctly from a non-zero exit.

#### Scenario: A long-running command is terminated

- **WHEN** a command runs longer than the configured timeout
- **THEN** it is terminated and the result reports that it timed out, distinguishably from a command that exited non-zero
