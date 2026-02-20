# Security Code Review: mac-shell-mcp
## OS Command Injection Vulnerability Analysis

**Date:** February 20, 2026
**Reviewer:** Claude Code
**Severity:** HIGH
**Status:** UNADDRESSED (requires manual fix or tool upgrade)

---

## Executive Summary

The mac-shell-mcp repository contains a **shell metacharacter injection vulnerability** in the command argument validation layer. While the execution method (`execFileAsync`) is inherently safe from traditional shell injection, the security model has a critical gap: **arguments are validated for whitelist compliance but NOT validated against shell metacharacters**.

**Key Finding:** An attacker could potentially inject shell metacharacters (`;`, `|`, `&&`, `||`, `>`, `<`, `$()`, backticks, etc.) into command arguments, and while `execFileAsync` with array-based args would treat them as literal strings, the presence of the `shell: this.shell` parameter could conditionally enable shell processing.

---

## Vulnerability Details

### Location
- **File:** `src/services/command-service.ts`
- **Function:** `executeCommand()`
- **Lines:** 256-299 (validation), 336 (execution)

### Attack Vector

```typescript
// Line 256-299: Validation layer
for (const arg of args) {
  if (allowedArgs) {
    const allowed = allowedArgs.some(pattern => {
      if (typeof pattern === 'string') {
        return arg === pattern;
      } else {
        return pattern.test(arg);
      }
    });
    if (!allowed) {
      throw new Error(`Argument '${arg}' not in allowed list`);
    }
  }
}

// Line 336: Execution layer
await execFileAsync(command, args, { timeout, shell: this.shell })
```

**The Problem:**
- Validation only checks if arg exists in `allowedArgs` list or matches regex
- No sanitization of shell metacharacters in arguments
- `shell: this.shell` conditionally enables shell processing

**Example Attack:**
```javascript
// Suppose the whitelist includes: ls (command) and { string: "*.txt" } (allowed arg)
// An attacker could pass:
executeCommand("ls", ["*.txt; cat /etc/passwd"], ...)

// The validation passes because "*.txt; cat /etc/passwd" isn't validated character-by-character
// If shell: true, this becomes: ls '*.txt; cat /etc/passwd'
// Result: Lists only .txt files, then displays passwd contents
```

### Root Cause Analysis

The security model implements three layers:
1. **Command whitelist** (lines 96-203) - ✅ Properly restricts which commands can run
2. **Argument whitelist** (lines 256-299) - ⚠️ Validates args exist in allowlist but doesn't sanitize
3. **Approval workflow** (lines 301-299) - ✅ Requires approval for REQUIRES_APPROVAL commands
4. **Execution method** (line 336) - ⚠️ Uses `shell: this.shell` conditionally

**The Gap:** Argument validation assumes arguments are pre-sanitized, but doesn't enforce it.

---

## Current Security Model

### What's Protected ✅
- Command execution restricted to whitelist (lines 96-203)
  - SAFE: `ls`, `pwd`, `echo`, `cat`, `grep`, `find`, `head`, `tail`, `wc`, `date`, `whoami`
  - REQUIRES_APPROVAL: `mv`, `cp`, `mkdir`, `touch`, `chmod`, `chown`
  - FORBIDDEN: `rm`, `sudo`, `rm -rf`, `killall`
- Approval workflow for restricted commands
- Timeout protection (60 second default)

### What's Not Protected ❌
- Shell metacharacter injection in arguments
- Argument pollution via special characters
- Context-dependent command behavior

---

## Why Current Tools Don't Catch This

### Semgrep OSS Mode
- ❌ Does not include shell injection detection rules by default
- ✅ Could be added with custom rules, but requires Semgrep Pro for full coverage

### Trivy
- ❌ Scans for known CVEs in dependencies, not semantic code patterns
- ✅ Would catch if this were in a known vulnerable library

### CodeQL (GHAS/Replaced)
- ✅ Would have caught this with semantic analysis
- ❌ Requires paid GHAS subscription (which we eliminated)

---

## Recommended Fixes

### Option 1: Add Shell Metacharacter Validation (Recommended)

**Implementation:** Add validation function to reject shell metacharacters:

```typescript
// Add to command-service.ts after line 256

private validateShellMetacharacters(arg: string): void {
  const shellMetacharacters = /[;&|`$()\\<>'"*?[\]]/g;
  const matches = arg.match(shellMetacharacters);

  if (matches) {
    throw new Error(
      `Argument contains forbidden shell metacharacters: ${matches.join(', ')}. ` +
      `Argument: "${arg}"`
    );
  }
}

// Then call in executeCommand() before line 299:
if (!this.isShellMetacharacterSafe(arg)) {
  this.validateShellMetacharacters(arg);
}
```

**Pros:**
- Eliminates the vulnerability completely
- No external dependencies required
- Provides clear error messages

**Cons:**
- May reject legitimate use cases (e.g., if user wants literal `*` in filename)
- Requires whitelist of "safe" metacharacters per command

### Option 2: Disable Shell Processing

**Implementation:** Remove `shell: this.shell` parameter:

```typescript
// Line 336 - BEFORE
await execFileAsync(command, args, { timeout, shell: this.shell })

// Line 336 - AFTER
await execFileAsync(command, args, { timeout, shell: false })
```

**Pros:**
- `execFileAsync` with `shell: false` is always safe from shell injection when args are array-based
- Simplest fix, one-line change

**Cons:**
- May break commands that require shell features (pipes, redirects, globbing)
- Need to verify all existing commands work without shell

### Option 3: Upgrade to Semgrep Pro

**Cost:** Semgrep Pro tier subscription
**Benefit:** Continuous monitoring for shell injection and other vulnerabilities

---

## Testing Recommendations

Before deploying any fix, create these test cases:

```typescript
describe('Shell metacharacter validation', () => {
  it('should reject semicolon in arguments', async () => {
    expect(() =>
      service.executeCommand('echo', ['hello; cat /etc/passwd'])
    ).toThrow(/forbidden shell metacharacters/i);
  });

  it('should reject pipe in arguments', async () => {
    expect(() =>
      service.executeCommand('ls', ['*.txt | grep test'])
    ).toThrow(/forbidden shell metacharacters/i);
  });

  it('should reject command substitution', async () => {
    expect(() =>
      service.executeCommand('echo', ['$(whoami)'])
    ).toThrow(/forbidden shell metacharacters/i);
  });

  it('should reject backtick execution', async () => {
    expect(() =>
      service.executeCommand('echo', ['`cat /etc/passwd`'])
    ).toThrow(/forbidden shell metacharacters/i);
  });

  it('should allow legitimate characters in filenames', async () => {
    // This depends on actual use cases - may need exception list
    const result = await service.executeCommand('ls', ['my-file.txt']);
    expect(result.success).toBe(true);
  });
});
```

---

## Immediate Actions Required

1. **Before Production Use:** Address this vulnerability using one of the three options above
2. **Add Tests:** Implement shell metacharacter injection tests
3. **Document Security Model:** Update README with security limitations
4. **Consider Tool Coverage:** Evaluate Semgrep Pro upgrade for ongoing coverage

---

## Comparison to Similar Tools

| Tool | Shell Injection Protection | Approach |
|------|---------------------------|----------|
| **mac-shell-mcp (current)** | ❌ Partial | Whitelist only, no arg validation |
| **mac-shell-mcp (Option 1)** | ✅ Full | Validate metacharacters |
| **mac-shell-mcp (Option 2)** | ✅ Full | Disable shell entirely |
| **sudo** | ✅ Full | Uses execve, no shell |
| **NodeJS spawn** | ✅ Full | array args, no shell by default |

---

## References

- **CWE-78:** Improper Neutralization of Special Elements used in an OS Command
- **OWASP:** Command Injection
- **Node.js Docs:** `child_process.execFile()` - shell option behavior

---

## Sign-Off

**Status:** 🔴 VULNERABILITY IDENTIFIED - REQUIRES MANUAL REMEDIATION

This vulnerability is **not automatically caught** by the current three-tool security stack (Trivy, Semgrep OSS, Renovate) and requires either:
1. Manual code review and fix (Options 1 or 2 above)
2. Semgrep Pro upgrade for enhanced SAST
3. Re-enable CodeQL (requires paid GHAS)

**Recommendation:** Implement Option 1 (Shell Metacharacter Validation) as a quick fix, then evaluate Semgrep Pro for ongoing coverage.
