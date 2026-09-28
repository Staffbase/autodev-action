# ADR0001 - Use Mergiraf for AutoDev merges

- Status: approved
- Date: 2026-09-26
- Deciders: AutoDev action maintainers
- Informed: AutoDev action users

## Decision Outcome

Use Mergiraf as the default Git merge driver in AutoDev, since it is able to resolve structural conflicts that the default `ort` strategy cannot resolve.

## Context and Problem Statement

AutoDev rebuilds a dev branch by merging labeled pull requests in sequence. Git can by default only handle conflicts on line-level. When syntactic knowledge can be leveraged, more conflicts could be solved.

## Decision Drivers

- Reduce avoidable conflicts in supported structured files.
- Keep installation and Git configuration inside the action that performs the merges.
- Keep normal Git behavior as an opt-out and for files not covered by Mergiraf attributes; unresolved Mergiraf conflicts remain failures, with no retry using `ort`.
- Verify the downloaded executable and avoid repeated external downloads.

## Considered Options

- **Mergiraf by default (chosen):** syntax-aware Git merge driver, disabled with `mergiraf: false`.
- **Git `ort` only:** no extra dependency, but merges stay relatively simplistic.
- **Let the caller set up Mergiraf:** keeps this action simpler, but puts a lot of burden on the users and likely causes a lot of duplication of setup logic that a shared action is supposed to avoid.

## Decision Details

The action installs a pinned Mergiraf release, verifies its SHA-256, and configures a repository-local merge driver and supported-file attributes. It caches the verified archive in the caller repository's GitHub Actions cache; a base-branch run primes the cache for other branches. If a Mergiraf-enabled merge command fails, AutoDev restores the pre-merge state and retries that PR once with Git's built-in merge driver. Callers can set `mergiraf: false` to skip Mergiraf and use Git directly.

## Consequences

### Positive Consequences

- Some structural conflicts merge automatically without changing AutoDev's merge loop.
- Direct action callers and reusable-workflow callers use one implementation.
- Cached, checksum-verified archives reduce repeat downloads.

### Negative Consequences

- A cache miss depends on downloading a release from Codeberg; release updates require matching checksum updates.
- Mergiraf uses heuristics and does not resolve every conflict; the single Git retry can also fail, in which case only that PR is excluded from the dev rebuild.
