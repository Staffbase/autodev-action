import {execFileSync} from 'node:child_process'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {MockInstance} from 'vitest'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import type {FailedPull} from './utils'
import {commentFail, updateLabels} from './utils'

// ---------------------------------------------------------------------------
// commentFail rendering
// ---------------------------------------------------------------------------

describe('commentFail', () => {
  it('only lists the PR that touched each specific conflicting file, not all PRs that touched any file', () => {
    // PR #10 touched file-a.yaml only.
    // PR #20 touched file-b.yaml only.
    // PR #30 failed, conflicting on both files.
    // Expected: file-a.yaml suffix mentions only #10; file-b.yaml suffix mentions only #20.
    const pr10 = {sha: 'aaa', number: 10, branch: 'pr-a', labels: []}
    const pr20 = {sha: 'bbb', number: 20, branch: 'pr-b', labels: []}

    const failedPull: FailedPull = {
      sha: 'ccc',
      number: 30,
      branch: 'pr-c',
      labels: [],
      conflictingFileToPulls: new Map([
        ['file-a.yaml', [pr10]],
        ['file-b.yaml', [pr20]]
      ])
    }

    const result = commentFail('owner', 'repo', 'main', failedPull)

    // file-a.yaml should mention pr-a but NOT pr-b
    expect(result).toMatch(/`file-a\.yaml`[\s\S]*pr-a/)
    expect(result).not.toMatch(
      /`file-a\.yaml`[\s\S]*?pr-b[\s\S]*?`file-b\.yaml`/
    )

    // file-b.yaml should mention pr-b but NOT pr-a
    expect(result).toMatch(/`file-b\.yaml`[\s\S]*pr-b/)
    expect(result).not.toMatch(/`file-b\.yaml`[\s\S]*?pr-a/)
  })

  it('shows rebase instruction for files that conflict with base (no culprit PR)', () => {
    const failedPull: FailedPull = {
      sha: 'ccc',
      number: 30,
      branch: 'pr-c',
      labels: [],
      conflictingFileToPulls: new Map([['stale-file.yaml', []]])
    }

    const result = commentFail('owner', 'repo', 'main', failedPull)

    expect(result).toMatch(/`stale-file\.yaml`[\s\S]*rebase/)
    expect(result).toMatch(/`main`/)
    // should NOT claim another PR caused it
    expect(result).not.toMatch(/also modified/)
  })

  it('handles mixed case: one file blamed on a PR, one on base', () => {
    const pr10 = {sha: 'aaa', number: 10, branch: 'pr-a', labels: []}

    const failedPull: FailedPull = {
      sha: 'ccc',
      number: 30,
      branch: 'pr-c',
      labels: [],
      conflictingFileToPulls: new Map([
        ['pr-owned.yaml', [pr10]],
        ['base-owned.yaml', []]
      ])
    }

    const result = commentFail('owner', 'repo', 'main', failedPull)

    expect(result).toMatch(/`pr-owned\.yaml`[\s\S]*pr-a/)
    expect(result).toMatch(/`base-owned\.yaml`[\s\S]*rebase/)
  })
})

// ---------------------------------------------------------------------------
// updateLabels — skipped PR (neither successful nor failed)
// ---------------------------------------------------------------------------
describe('updateLabels', () => {
  it('does not add or remove any label for a PR that is in pulls but neither successful nor failed', async () => {
    const addLabels = vi.fn()
    const removeLabel = vi.fn()
    const octokit = {
      rest: {issues: {addLabels, removeLabel}}
    } as unknown as Parameters<typeof updateLabels>[0]

    const pr = {sha: 'aaa', number: 1, branch: 'feature-1', labels: []}

    await updateLabels(
      octokit,
      'owner',
      'repo',
      [pr],
      [],
      [],
      'successful',
      'failed'
    )

    expect(addLabels).not.toHaveBeenCalled()
    expect(removeLabel).not.toHaveBeenCalled()
  })

  it('removes a stale failure label when success already exists with different casing', async () => {
    const addLabels = vi.fn()
    const removeLabel = vi.fn()
    const octokit = {
      rest: {issues: {addLabels, removeLabel}}
    } as unknown as Parameters<typeof updateLabels>[0]
    const pull = {
      sha: 'aaa',
      number: 63,
      branch: 'add-mcp-create-page-tool',
      labels: ['dev', 'dev successful', 'dev failed']
    }

    await updateLabels(
      octokit,
      'owner',
      'repo',
      [pull],
      [pull],
      [],
      'dev Successful',
      'dev Failed'
    )

    expect(removeLabel).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      issue_number: 63,
      name: 'dev failed'
    })
    expect(addLabels).not.toHaveBeenCalled()
  })
})

vi.mock('@actions/core', () => ({
  debug: vi.fn(),
  getInput: vi.fn(),
  info: vi.fn(),
  setFailed: vi.fn(),
  warning: vi.fn()
}))

vi.mock('@actions/exec', () => ({
  exec: vi.fn()
}))

vi.mock('./mergiraf', () => ({
  configureMergiraf: vi.fn().mockResolvedValue(undefined),
  primeMergirafCache: vi.fn().mockResolvedValue(undefined)
}))

import {getInput, info, setFailed, warning} from '@actions/core'
import {exec} from '@actions/exec'

import autoDev from './autodev'
import {configureMergiraf, primeMergirafCache} from './mergiraf'
import type {PullsListResponseData} from './utils'
import * as utils from './utils'

const REMOTE_DEV_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const REMOTE_HEAD_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

const stubRefSpecificExec = (extra?: Record<string, string>): void => {
  const refMap: Record<string, string | undefined> = {
    'git ls-remote --heads origin dev': `${REMOTE_DEV_SHA}\trefs/heads/dev`,
    'git rev-parse origin/dev': REMOTE_DEV_SHA,
    'git rev-parse HEAD': REMOTE_HEAD_SHA,
    ...extra
  }
  vi.mocked(exec).mockImplementation((cmd, _args, opts) => {
    const out = refMap[cmd]
    if (out) {
      opts?.listeners?.stdout?.(Buffer.from(`${out}\n`))
    }
    return Promise.resolve(0)
  })
}

describe('autodev', () => {
  let labelsSpy: MockInstance<typeof utils.updateLabels>
  let commentsSpy: MockInstance<typeof utils.createComments>

  beforeEach(() => {
    labelsSpy = vi.spyOn(utils, 'updateLabels').mockResolvedValue()
    commentsSpy = vi.spyOn(utils, 'createComments').mockResolvedValue()
    vi.spyOn(utils, 'getRepoString').mockReturnValue(
      '@staffbase/auto-dev-action'
    )
    vi.spyOn(utils, 'fetchPulls').mockResolvedValue([
      {
        number: 1,
        labels: [{name: 'dev'}],
        head: {
          ref: 'feature-1',
          sha: '38767ad258cbc536826996ef881eaa797851fc0e'
        }
      },
      {
        number: 2,
        labels: [{name: 'not-dev'}],
        head: {
          ref: 'feature-2',
          sha: '48767ad258cbc536826996ef881eaa797851fc0f'
        }
      },
      {
        number: 3,
        labels: [{name: 'dev'}],
        head: {
          ref: 'feature-3',
          sha: '58767ad258cbc536826996ef881eaa797851fc10'
        }
      }
    ] as PullsListResponseData)

    stubRefSpecificExec()
  })

  afterEach(() => vi.clearAllMocks())

  it('should merge two pull requests', async () => {
    vi.mocked(getInput).mockImplementation(
      input => ({token: 'token', base: 'main'})[input] || ''
    )

    await autoDev()

    expect(commentsSpy).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith(`AutoDev Merge

The following branches have been merged:
- PR 1 feature-1 (38767ad)
- PR 3 feature-3 (58767ad)

The following branches failed to merge:
`)
  })

  it('uses Git normal merges when Mergiraf is disabled', async () => {
    vi.mocked(getInput).mockImplementation(
      input => ({token: 'token', base: 'main', mergiraf: 'false'})[input] || ''
    )

    await autoDev()

    expect(configureMergiraf).not.toHaveBeenCalled()
    expect(
      vi
        .mocked(exec)
        .mock.calls.some(
          ([command]) => command === 'git merge origin/feature-1'
        )
    ).toBe(true)
  })

  it('retries a fatal Mergiraf merge with Git and resets when abort is unavailable', async () => {
    vi.mocked(getInput).mockImplementation(
      input => ({token: 'token', base: 'main'})[input] || ''
    )
    vi.spyOn(utils, 'fetchPulls').mockResolvedValue([
      {
        number: 4,
        labels: [{name: 'dev'}],
        head: {
          ref: 'fallback-feature',
          sha: '68767ad258cbc536826996ef881eaa797851fc11'
        }
      }
    ] as PullsListResponseData)

    let mergeAttempts = 0
    let retryEnvironment: Record<string, string> | undefined
    const commands: string[] = []
    vi.mocked(exec).mockImplementation((command, args, options) => {
      commands.push(command)
      if (command === 'git rev-parse HEAD') {
        options?.listeners?.stdout?.(Buffer.from(`${REMOTE_HEAD_SHA}\n`))
      } else if (command === 'git merge origin/fallback-feature') {
        mergeAttempts += 1
        if (mergeAttempts === 1) {
          options?.listeners?.stderr?.(
            Buffer.from('fatal: could not fetch promised object\n')
          )
          return Promise.reject(new Error('promisor fetch failed'))
        }
        retryEnvironment = options?.env
      } else if (command === 'git merge --abort') {
        return Promise.reject(new Error('There is no merge to abort'))
      } else if (command === 'git reset --hard') {
        expect(args).toEqual([REMOTE_HEAD_SHA])
      }
      return Promise.resolve(0)
    })

    await autoDev()

    expect(mergeAttempts).toBe(2)
    expect(retryEnvironment?.mergiraf).toBe('0')
    expect(retryEnvironment?.PATH).toBe(process.env.PATH)
    expect(commands).toContain('git reset --hard')
    expect(setFailed).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('- PR 4 fallback-feature (68767ad)')
    )
  })

  it('records a PR failure when the ORT retry also fails and merge abort is unavailable', async () => {
    vi.mocked(getInput).mockImplementation(
      input => ({token: 'token', base: 'main'})[input] || ''
    )
    vi.spyOn(utils, 'fetchPulls').mockResolvedValue([
      {
        number: 5,
        labels: [{name: 'dev'}],
        head: {
          ref: 'ort-conflict',
          sha: '78767ad258cbc536826996ef881eaa797851fc12'
        }
      }
    ] as PullsListResponseData)

    let mergeAttempts = 0
    let resets = 0
    vi.mocked(exec).mockImplementation((command, args, options) => {
      if (command === 'git rev-parse HEAD') {
        options?.listeners?.stdout?.(Buffer.from(`${REMOTE_HEAD_SHA}\n`))
      } else if (command === 'git merge origin/ort-conflict') {
        mergeAttempts += 1
        options?.listeners?.stderr?.(
          Buffer.from(
            mergeAttempts === 1
              ? 'fatal: Mergiraf merge failed\n'
              : 'CONFLICT (content): Merge conflict in conflict.go\n'
          )
        )
        return Promise.reject(new Error('merge failed'))
      } else if (command === 'git merge --abort') {
        return Promise.reject(new Error('There is no merge to abort'))
      } else if (command === 'git reset --hard') {
        resets += 1
        expect(args).toEqual([REMOTE_HEAD_SHA])
      }
      return Promise.resolve(0)
    })

    await autoDev()

    expect(mergeAttempts).toBe(2)
    expect(resets).toBe(2)
    expect(setFailed).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('- PR 5 ort-conflict (78767ad)')
    )
  })

  it('primes the shared Mergiraf cache on the base branch when there are no labeled PRs', async () => {
    vi.mocked(getInput).mockImplementation(
      input => ({token: 'token', base: 'main'})[input] || ''
    )
    vi.spyOn(utils, 'fetchPulls').mockResolvedValue([])
    const originalRef = process.env.GITHUB_REF
    process.env.GITHUB_REF = 'refs/heads/main'

    try {
      await autoDev()
    } finally {
      if (originalRef === undefined) delete process.env.GITHUB_REF
      else process.env.GITHUB_REF = originalRef
    }

    expect(primeMergirafCache).toHaveBeenCalledOnce()
    expect(configureMergiraf).not.toHaveBeenCalled()
  })

  it('should add successful comments', async () => {
    vi.mocked(getInput).mockImplementation(
      input => ({token: 'token', base: 'main', comments: 'true'})[input] || ''
    )

    await autoDev()

    expect(commentsSpy).toHaveBeenCalled()
  })

  it('should add successful labels', async () => {
    vi.mocked(getInput).mockImplementation(
      input => ({token: 'token', base: 'main', labels: 'true'})[input] || ''
    )

    await autoDev()

    expect(labelsSpy).toHaveBeenCalled()
  })

  it('builds from the fetched remote base, not a stale local base checkout', async () => {
    vi.mocked(getInput).mockImplementation(
      input => ({token: 'token', base: 'main'})[input] || ''
    )
    vi.spyOn(utils, 'fetchPulls').mockResolvedValue([])

    await autoDev()

    const commands = vi.mocked(exec).mock.calls.map(([command]) => command)
    expect(commands).toContain('git checkout -B main origin/main')
    expect(commands).not.toContain('git checkout main')
    expect(commands.indexOf('git checkout -B main origin/main')).toBeLessThan(
      commands.indexOf('git checkout -B dev')
    )
  })

  it('still pushes dev when the merged PRs leave the base tree unchanged', async () => {
    vi.mocked(getInput).mockImplementation(
      input => ({token: 'token', base: 'main'})[input] || ''
    )
    // Behave like git with an unchanged tree: a plain commit has nothing to
    // commit, only an --allow-empty commit succeeds.
    const refSpecificExec = vi.mocked(exec).getMockImplementation()
    vi.mocked(exec).mockImplementation((command, args, options) => {
      if (
        command.startsWith('git commit') &&
        !command.includes('--allow-empty')
      ) {
        return Promise.reject(
          new Error('nothing to commit, working tree clean')
        )
      }
      return refSpecificExec?.(command, args, options) ?? Promise.resolve(0)
    })

    await autoDev()

    expect(exec).toHaveBeenCalledWith(
      `git push --force-with-lease=refs/heads/dev:${REMOTE_DEV_SHA} -u origin refs/heads/dev`,
      undefined,
      expect.objectContaining({ignoreReturnCode: true})
    )
    expect(setFailed).not.toHaveBeenCalled()
  })

  it('takes the lease snapshot before listing PRs and fetching the base', async () => {
    // If the snapshot came after the fetch, a run with an older base could
    // adopt a newer run's push as its lease and overwrite it.
    vi.mocked(getInput).mockImplementation(
      input => ({token: 'token', base: 'main'})[input] || ''
    )

    await autoDev()

    const execMock = vi.mocked(exec).mock
    const callOrder = (command: string): number =>
      execMock.invocationCallOrder[
        execMock.calls.findIndex(([called]) => called === command)
      ]
    const snapshot = callOrder('git ls-remote --heads origin dev')
    expect(snapshot).toBeLessThan(
      vi.mocked(utils.fetchPulls).mock.invocationCallOrder[0]
    )
    expect(snapshot).toBeLessThan(callOrder('git fetch'))
  })

  it('creates a missing dev branch from the merge result, not from the base', async () => {
    vi.mocked(getInput).mockImplementation(
      input => ({token: 'token', base: 'main'})[input] || ''
    )
    stubRefSpecificExec({'git ls-remote --heads origin dev': ''})

    await autoDev()

    const commands = vi.mocked(exec).mock.calls.map(([command]) => command)
    expect(commands).toContain('git checkout -b dev')
    expect(commands).not.toContain('git checkout -b dev main')
    expect(commands.indexOf('git commit --allow-empty -m')).toBeLessThan(
      commands.indexOf('git checkout -b dev')
    )
    expect(commands).toContain('git push -u origin refs/heads/dev')
  })

  it('should push with --force-with-lease pinned to the observed remote sha', async () => {
    vi.mocked(getInput).mockImplementation(
      input => ({token: 'token', base: 'main'})[input] || ''
    )

    await autoDev()

    expect(exec).toHaveBeenCalledWith(
      `git push --force-with-lease=refs/heads/dev:${REMOTE_DEV_SHA} -u origin refs/heads/dev`,
      undefined,
      expect.objectContaining({ignoreReturnCode: true})
    )
    expect(exec).not.toHaveBeenCalledWith(
      'git push -f -u origin refs/heads/dev',
      undefined,
      expect.anything()
    )
  })

  it('should warn but not fail when the push is rejected because origin/dev moved', async () => {
    vi.mocked(getInput).mockImplementation(
      input => ({token: 'token', base: 'main'})[input] || ''
    )

    vi.mocked(exec).mockImplementation((cmd, _args, opts) => {
      if (cmd === 'git ls-remote --heads origin dev') {
        opts?.listeners?.stdout?.(
          Buffer.from(`${REMOTE_DEV_SHA}\trefs/heads/dev\n`)
        )
        return Promise.resolve(0)
      }
      if (cmd === 'git rev-parse origin/dev') {
        opts?.listeners?.stdout?.(Buffer.from(`${REMOTE_DEV_SHA}\n`))
        return Promise.resolve(0)
      }
      if (cmd === 'git rev-parse HEAD') {
        opts?.listeners?.stdout?.(Buffer.from(`${REMOTE_HEAD_SHA}\n`))
        return Promise.resolve(0)
      }
      if (cmd.startsWith('git push --force-with-lease')) {
        opts?.listeners?.stderr?.(
          Buffer.from(
            "! [rejected] dev -> dev (stale info)\nerror: failed to push some refs to 'origin'\n"
          )
        )
        return Promise.resolve(1)
      }
      return Promise.resolve(0)
    })

    await autoDev()

    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining(
        `push to dev skipped: origin/dev moved during this run`
      )
    )
    expect(setFailed).not.toHaveBeenCalled()
  })

  it('should warn but not fail when GitHub rejects the push with "is at … but expected …" (server-side lease mismatch)', async () => {
    vi.mocked(getInput).mockImplementation(
      input => ({token: 'token', base: 'main'})[input] || ''
    )

    vi.mocked(exec).mockImplementation((cmd, _args, opts) => {
      if (cmd === 'git ls-remote --heads origin dev') {
        opts?.listeners?.stdout?.(
          Buffer.from(`${REMOTE_DEV_SHA}\trefs/heads/dev\n`)
        )
        return Promise.resolve(0)
      }
      if (cmd === 'git rev-parse origin/dev') {
        opts?.listeners?.stdout?.(Buffer.from(`${REMOTE_DEV_SHA}\n`))
        return Promise.resolve(0)
      }
      if (cmd === 'git rev-parse HEAD') {
        opts?.listeners?.stdout?.(Buffer.from(`${REMOTE_HEAD_SHA}\n`))
        return Promise.resolve(0)
      }
      if (cmd.startsWith('git push --force-with-lease')) {
        opts?.listeners?.stderr?.(
          Buffer.from(
            `! [remote rejected] dev -> dev (cannot lock ref 'refs/heads/dev': is at ${REMOTE_HEAD_SHA} but expected ${REMOTE_DEV_SHA})\nerror: failed to push some refs to 'https://github.com/Staffbase/infrastructure'\n`
          )
        )
        return Promise.resolve(1)
      }
      return Promise.resolve(0)
    })

    await autoDev()

    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining(
        `push to dev skipped: origin/dev moved during this run`
      )
    )
    expect(setFailed).not.toHaveBeenCalled()
  })

  it('should setFailed with a generic message when the push fails for non-lease reasons', async () => {
    vi.mocked(getInput).mockImplementation(
      input => ({token: 'token', base: 'main'})[input] || ''
    )

    vi.mocked(exec).mockImplementation((cmd, _args, opts) => {
      if (cmd === 'git ls-remote --heads origin dev') {
        opts?.listeners?.stdout?.(
          Buffer.from(`${REMOTE_DEV_SHA}\trefs/heads/dev\n`)
        )
        return Promise.resolve(0)
      }
      if (cmd === 'git rev-parse origin/dev') {
        opts?.listeners?.stdout?.(Buffer.from(`${REMOTE_DEV_SHA}\n`))
        return Promise.resolve(0)
      }
      if (cmd === 'git rev-parse HEAD') {
        opts?.listeners?.stdout?.(Buffer.from(`${REMOTE_HEAD_SHA}\n`))
        return Promise.resolve(0)
      }
      if (cmd.startsWith('git push --force-with-lease')) {
        opts?.listeners?.stderr?.(
          Buffer.from('fatal: unable to access remote: connection refused\n')
        )
        return Promise.resolve(128)
      }
      return Promise.resolve(0)
    })

    await autoDev()

    expect(setFailed).toHaveBeenCalledWith(
      expect.stringContaining('push to dev failed with exit code 128')
    )
    expect(setFailed).toHaveBeenCalledWith(
      expect.stringContaining('connection refused')
    )
  })

  it('should pin --force-with-lease to the start-of-run sha even after a second fetch advances origin/dev', async () => {
    vi.mocked(getInput).mockImplementation(
      input => ({token: 'token', base: 'main'})[input] || ''
    )

    const STALE_DEV_SHA = REMOTE_DEV_SHA
    const ADVANCED_DEV_SHA = 'cccccccccccccccccccccccccccccccccccccccc'

    let lsRemoteCalls = 0
    let revParseOriginCalls = 0
    vi.mocked(exec).mockImplementation((cmd, _args, opts) => {
      if (cmd === 'git ls-remote --heads origin dev') {
        lsRemoteCalls += 1
        opts?.listeners?.stdout?.(
          Buffer.from(`${STALE_DEV_SHA}\trefs/heads/dev\n`)
        )
        return Promise.resolve(0)
      }
      if (cmd === 'git rev-parse origin/dev') {
        // After the second `git fetch`, the local origin/dev now points at the
        // newer remote tip. The lease must NOT adopt this value.
        revParseOriginCalls += 1
        opts?.listeners?.stdout?.(Buffer.from(`${ADVANCED_DEV_SHA}\n`))
        return Promise.resolve(0)
      }
      if (cmd === 'git rev-parse HEAD') {
        opts?.listeners?.stdout?.(Buffer.from(`${REMOTE_HEAD_SHA}\n`))
        return Promise.resolve(0)
      }
      return Promise.resolve(0)
    })

    await autoDev()

    expect(lsRemoteCalls).toBeGreaterThanOrEqual(1)
    expect(revParseOriginCalls).toBeGreaterThanOrEqual(1)
    expect(exec).toHaveBeenCalledWith(
      `git push --force-with-lease=refs/heads/dev:${STALE_DEV_SHA} -u origin refs/heads/dev`,
      undefined,
      expect.objectContaining({ignoreReturnCode: true})
    )
    expect(exec).not.toHaveBeenCalledWith(
      `git push --force-with-lease=refs/heads/dev:${ADVANCED_DEV_SHA} -u origin refs/heads/dev`,
      undefined,
      expect.anything()
    )
  })

  it('should not post comments or labels when the push is rejected', async () => {
    vi.mocked(getInput).mockImplementation(
      input =>
        ({token: 'token', base: 'main', comments: 'true', labels: 'true'})[
          input
        ] || ''
    )

    vi.mocked(exec).mockImplementation((cmd, _args, opts) => {
      if (cmd === 'git ls-remote --heads origin dev') {
        opts?.listeners?.stdout?.(
          Buffer.from(`${REMOTE_DEV_SHA}\trefs/heads/dev\n`)
        )
        return Promise.resolve(0)
      }
      if (cmd === 'git rev-parse origin/dev') {
        opts?.listeners?.stdout?.(Buffer.from(`${REMOTE_DEV_SHA}\n`))
        return Promise.resolve(0)
      }
      if (cmd === 'git rev-parse HEAD') {
        opts?.listeners?.stdout?.(Buffer.from(`${REMOTE_HEAD_SHA}\n`))
        return Promise.resolve(0)
      }
      if (cmd.startsWith('git push --force-with-lease')) {
        opts?.listeners?.stderr?.(
          Buffer.from('! [rejected] dev -> dev (stale info)\n')
        )
        return Promise.resolve(1)
      }
      return Promise.resolve(0)
    })

    await autoDev()

    expect(commentsSpy).not.toHaveBeenCalled()
    expect(labelsSpy).not.toHaveBeenCalled()
  })

  it('should post comments and labels only after a successful push', async () => {
    vi.mocked(getInput).mockImplementation(
      input =>
        ({token: 'token', base: 'main', comments: 'true', labels: 'true'})[
          input
        ] || ''
    )

    const callOrder: string[] = []
    vi.mocked(exec).mockImplementation((cmd, _args, opts) => {
      if (cmd === 'git ls-remote --heads origin dev') {
        opts?.listeners?.stdout?.(
          Buffer.from(`${REMOTE_DEV_SHA}\trefs/heads/dev\n`)
        )
        return Promise.resolve(0)
      }
      if (cmd === 'git rev-parse origin/dev') {
        opts?.listeners?.stdout?.(Buffer.from(`${REMOTE_DEV_SHA}\n`))
        return Promise.resolve(0)
      }
      if (cmd === 'git rev-parse HEAD') {
        opts?.listeners?.stdout?.(Buffer.from(`${REMOTE_HEAD_SHA}\n`))
        return Promise.resolve(0)
      }
      if (cmd.startsWith('git push --force-with-lease')) {
        callOrder.push('push')
      }
      return Promise.resolve(0)
    })
    commentsSpy.mockImplementation(() => {
      callOrder.push('comment')
      return Promise.resolve()
    })
    labelsSpy.mockImplementation(() => {
      callOrder.push('label')
      return Promise.resolve()
    })

    await autoDev()

    expect(callOrder).toEqual(['push', 'comment', 'label'])
  })

  it('should extract conflicting files from git merge stderr and pass them in failedPulls', async () => {
    vi.mocked(getInput).mockImplementation(
      input => ({token: 'token', base: 'main', comments: 'true'})[input] || ''
    )

    vi.mocked(exec).mockImplementation((cmd, _args, opts) => {
      if (cmd === 'git ls-remote --heads origin dev') {
        opts?.listeners?.stdout?.(
          Buffer.from(`${REMOTE_DEV_SHA}\trefs/heads/dev\n`)
        )
        return Promise.resolve(0)
      }
      if (cmd === 'git rev-parse origin/dev') {
        opts?.listeners?.stdout?.(Buffer.from(`${REMOTE_DEV_SHA}\n`))
        return Promise.resolve(0)
      }
      if (cmd === 'git rev-parse HEAD') {
        opts?.listeners?.stdout?.(Buffer.from(`${REMOTE_HEAD_SHA}\n`))
        return Promise.resolve(0)
      }
      // Both merges fail with a conflict on a single file each.
      if (cmd === 'git merge origin/feature-1') {
        opts?.listeners?.stderr?.(
          Buffer.from(
            'Auto-merging path/to/file.yaml\n' +
              'CONFLICT (content): Merge conflict in path/to/file.yaml\n' +
              'Automatic merge failed; fix conflicts and then commit the result.\n'
          )
        )
        return Promise.reject(new Error('merge failed'))
      }
      if (cmd === 'git merge origin/feature-3') {
        opts?.listeners?.stderr?.(
          Buffer.from('CONFLICT (add/add): Merge conflict in other/file.yaml\n')
        )
        return Promise.reject(new Error('merge failed'))
      }
      return Promise.resolve(0)
    })

    await autoDev()

    expect(commentsSpy).toHaveBeenCalled()
    const failedArg = commentsSpy.mock.calls[0]?.[6]
    expect(failedArg).toEqual([
      expect.objectContaining({
        branch: 'feature-1',
        conflictingFileToPulls: new Map([['path/to/file.yaml', []]])
      }),
      expect.objectContaining({
        branch: 'feature-3',
        conflictingFileToPulls: new Map([['other/file.yaml', []]])
      })
    ])
  })

  it('should point the failing PR at the dev-labeled PR that was merged into dev first', async () => {
    vi.mocked(getInput).mockImplementation(
      input => ({token: 'token', base: 'main', comments: 'true'})[input] || ''
    )

    vi.mocked(exec).mockImplementation((cmd, _args, opts) => {
      if (cmd === 'git ls-remote --heads origin dev') {
        opts?.listeners?.stdout?.(
          Buffer.from(`${REMOTE_DEV_SHA}\trefs/heads/dev\n`)
        )
        return Promise.resolve(0)
      }
      if (cmd === 'git rev-parse origin/dev') {
        opts?.listeners?.stdout?.(Buffer.from(`${REMOTE_DEV_SHA}\n`))
        return Promise.resolve(0)
      }
      if (cmd === 'git rev-parse HEAD') {
        opts?.listeners?.stdout?.(Buffer.from(`${REMOTE_HEAD_SHA}\n`))
        return Promise.resolve(0)
      }
      // feature-1 is merged into the dev rebuild first and touches the file.
      // From its perspective everything is fine; it ends up on dev.
      if (cmd === 'git merge origin/feature-1') {
        return Promise.resolve(0)
      }
      if (cmd === `git diff --name-status -M ${REMOTE_HEAD_SHA} HEAD`) {
        opts?.listeners?.stdout?.(Buffer.from('M\tpath/to/file.yaml\n'))
        return Promise.resolve(0)
      }
      // feature-3's merge attempt then fails because feature-1's changes to
      // the same file are already in the working tree. feature-3 is excluded
      // from this dev rebuild; feature-1 stays.
      if (cmd === 'git merge origin/feature-3') {
        opts?.listeners?.stderr?.(
          Buffer.from(
            'CONFLICT (content): Merge conflict in path/to/file.yaml\n'
          )
        )
        return Promise.reject(new Error('merge failed'))
      }
      return Promise.resolve(0)
    })

    await autoDev()

    expect(commentsSpy).toHaveBeenCalled()
    const failedArg = commentsSpy.mock.calls[0]?.[6]
    expect(failedArg).toEqual([
      expect.objectContaining({
        branch: 'feature-3',
        conflictingFileToPulls: new Map([
          [
            'path/to/file.yaml',
            [expect.objectContaining({branch: 'feature-1', number: 1})]
          ]
        ])
      })
    ])

    expect(info).toHaveBeenCalledWith(
      expect.stringContaining(
        '- PR 3 feature-3 (58767ad) - conflicts with PR 1 feature-1 (38767ad)'
      )
    )
  })

  it('reports a conflict with base in the log message when no prior dev PR owns the file', async () => {
    vi.mocked(getInput).mockImplementation(
      input => ({token: 'token', base: 'main'})[input] || ''
    )

    vi.mocked(exec).mockImplementation((cmd, _args, opts) => {
      if (cmd === 'git ls-remote --heads origin dev') {
        opts?.listeners?.stdout?.(
          Buffer.from(`${REMOTE_DEV_SHA}\trefs/heads/dev\n`)
        )
        return Promise.resolve(0)
      }
      if (cmd === 'git rev-parse origin/dev') {
        opts?.listeners?.stdout?.(Buffer.from(`${REMOTE_DEV_SHA}\n`))
        return Promise.resolve(0)
      }
      if (cmd === 'git rev-parse HEAD') {
        opts?.listeners?.stdout?.(Buffer.from(`${REMOTE_HEAD_SHA}\n`))
        return Promise.resolve(0)
      }
      if (cmd === 'git merge origin/feature-1') {
        return Promise.resolve(0)
      }
      if (cmd === `git diff --name-status -M ${REMOTE_HEAD_SHA} HEAD`) {
        opts?.listeners?.stdout?.(Buffer.from('M\tunrelated.yaml\n'))
        return Promise.resolve(0)
      }
      if (cmd === 'git merge origin/feature-3') {
        opts?.listeners?.stderr?.(
          Buffer.from(
            'CONFLICT (content): Merge conflict in path/to/file.yaml\n'
          )
        )
        return Promise.reject(new Error('merge failed'))
      }
      return Promise.resolve(0)
    })

    await autoDev()

    expect(info).toHaveBeenCalledWith(
      expect.stringContaining(
        '- PR 3 feature-3 (58767ad) - conflicts with main'
      )
    )
  })

  // Two PRs fail in the same run for different reasons:
  //
  // Merge order:
  //   pr-touches-shared-file (#10) ✓  — merges first, touches shared/config.yaml
  //   pr-conflict-with-main  (#11) ✗  — conflicts on service/deployment.yaml;
  //                                      no prior dev PR touched that file,
  //                                      so the conflict is against main
  //   pr-conflict-with-pr    (#12) ✗  — conflicts on shared/config.yaml;
  //                                      pr-touches-shared-file merged first
  //                                      and owns that file → pointer populated
  it('two PRs fail in one run: one conflict against main (no pointer), one conflict against a prior dev PR (pointer)', async () => {
    vi.mocked(getInput).mockImplementation(
      input => ({token: 'token', base: 'main', comments: 'true'})[input] || ''
    )

    vi.spyOn(utils, 'fetchPulls').mockResolvedValue([
      {
        number: 10,
        labels: [{name: 'dev'}],
        head: {
          ref: 'pr-touches-shared-file',
          sha: 'aaa0000000000000000000000000000000000000'
        }
      },
      {
        number: 11,
        labels: [{name: 'dev'}],
        head: {
          ref: 'pr-conflict-with-main',
          sha: 'bbb0000000000000000000000000000000000000'
        }
      },
      {
        number: 12,
        labels: [{name: 'dev'}],
        head: {
          ref: 'pr-conflict-with-pr',
          sha: 'ccc0000000000000000000000000000000000000'
        }
      }
    ] as PullsListResponseData)

    vi.mocked(exec).mockImplementation((cmd, _args, opts) => {
      if (cmd === 'git ls-remote --heads origin dev') {
        opts?.listeners?.stdout?.(
          Buffer.from(`${REMOTE_DEV_SHA}\trefs/heads/dev\n`)
        )
        return Promise.resolve(0)
      }
      if (cmd === 'git rev-parse origin/dev') {
        opts?.listeners?.stdout?.(Buffer.from(`${REMOTE_DEV_SHA}\n`))
        return Promise.resolve(0)
      }
      if (cmd === 'git rev-parse HEAD') {
        opts?.listeners?.stdout?.(Buffer.from(`${REMOTE_HEAD_SHA}\n`))
        return Promise.resolve(0)
      }

      // pr-touches-shared-file merges first and touches shared/config.yaml.
      if (cmd === 'git merge origin/pr-touches-shared-file') {
        return Promise.resolve(0)
      }
      if (cmd === `git diff --name-status -M ${REMOTE_HEAD_SHA} HEAD`) {
        opts?.listeners?.stdout?.(Buffer.from('M\tshared/config.yaml\n'))
        return Promise.resolve(0)
      }

      // pr-conflict-with-main conflicts on service/deployment.yaml.
      // No prior dev PR in this run touched that file — conflict is against main.
      // → mergedFirstInThisRun must be empty.
      if (cmd === 'git merge origin/pr-conflict-with-main') {
        opts?.listeners?.stderr?.(
          Buffer.from(
            'CONFLICT (content): Merge conflict in service/deployment.yaml\n' +
              'Automatic merge failed; fix conflicts and then commit the result.\n'
          )
        )
        return Promise.reject(new Error('merge failed'))
      }

      // pr-conflict-with-pr conflicts on shared/config.yaml.
      // pr-touches-shared-file merged first and owns that file.
      // → mergedFirstInThisRun must point at pr-touches-shared-file (#10).
      if (cmd === 'git merge origin/pr-conflict-with-pr') {
        opts?.listeners?.stderr?.(
          Buffer.from(
            'CONFLICT (content): Merge conflict in shared/config.yaml\n' +
              'Automatic merge failed; fix conflicts and then commit the result.\n'
          )
        )
        return Promise.reject(new Error('merge failed'))
      }

      return Promise.resolve(0)
    })

    await autoDev()

    expect(commentsSpy).toHaveBeenCalled()
    const failedArg = commentsSpy.mock.calls[0]?.[6]

    expect(failedArg).toEqual([
      // pr-conflict-with-main: no prior dev PR touched service/deployment.yaml.
      expect.objectContaining({
        branch: 'pr-conflict-with-main',
        number: 11,
        conflictingFileToPulls: new Map([['service/deployment.yaml', []]])
      }),
      // pr-conflict-with-pr: pr-touches-shared-file (#10) merged first.
      expect.objectContaining({
        branch: 'pr-conflict-with-pr',
        number: 12,
        conflictingFileToPulls: new Map([
          [
            'shared/config.yaml',
            [
              expect.objectContaining({
                branch: 'pr-touches-shared-file',
                number: 10
              })
            ]
          ]
        ])
      })
    ])
  })
})

describe('autodev committed results (real Git)', () => {
  let directory: string
  let work: string
  let remote: string
  let baseSha: string
  let firstSha: string
  let fallbackSha: string
  let inputs: Record<string, string>
  let realGit: typeof exec

  const git = (args: string[], cwd = work): string =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim()

  const pulls = (...branches: string[]): PullsListResponseData =>
    branches.map((branch, index) => ({
      number: index + 1,
      labels: [{name: 'dev'}],
      // Deliberately stale API snapshot: the fetched Git ref is authoritative.
      head: {ref: branch, sha: '0000000000000000000000000000000000000000'}
    })) as PullsListResponseData

  const report = (): unknown =>
    JSON.parse(git(['show', 'dev:generated/nested/results.json'], remote))

  const parents = (): string[] =>
    git(['show', '-s', '--format=%P', 'dev'], remote).split(' ')

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'autodev-results-'))
    work = join(directory, 'work')
    remote = join(directory, 'remote.git')
    vi.stubEnv('GIT_CONFIG_GLOBAL', join(directory, 'no-global-config'))
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
    vi.stubEnv('GIT_AUTHOR_DATE', '2026-01-02T03:04:05Z')
    vi.stubEnv('GIT_COMMITTER_DATE', '2026-01-02T03:04:05Z')
    vi.stubEnv('GIT_MERGE_AUTOEDIT', 'no')
    git(['init', '--bare', '--initial-branch=main', remote], directory)
    git(['init', '--initial-branch=main', work], directory)
    git(['config', 'user.name', 'AutoDev Test'])
    git(['config', 'user.email', 'autodev@example.com'])
    git(['remote', 'add', 'origin', remote])
    await writeFile(join(work, 'conflict.txt'), 'original\n')
    await writeFile(join(work, 'results.json'), 'existing report\n')
    git(['add', '.'])
    git(['commit', '-m', 'Initial'])
    git(['checkout', '-b', 'conflict-with-base'])
    await writeFile(join(work, 'conflict.txt'), 'conflicting branch\n')
    git(['commit', '-am', 'Conflicts with base'])
    git(['checkout', 'main'])
    await writeFile(join(work, 'conflict.txt'), 'base\n')
    await writeFile(join(work, '.gitignore'), 'generated/\n')
    git(['add', '.'])
    git(['commit', '-m', 'Base'])
    baseSha = git(['rev-parse', 'HEAD'])
    git(['checkout', '-b', 'feature-1'])
    await writeFile(join(work, 'conflict.txt'), 'first feature\n')
    git(['commit', '-am', 'First feature'])
    firstSha = git(['rev-parse', 'HEAD'])
    git(['checkout', '-b', 'feature-3', 'main'])
    await writeFile(join(work, 'conflict.txt'), 'third feature\n')
    git(['commit', '-am', 'Third feature'])
    git(['checkout', '-b', 'fallback-feature', 'main'])
    await writeFile(join(work, 'fallback.txt'), 'fallback\n')
    git(['add', '.'])
    git(['commit', '-m', 'Fallback feature'])
    fallbackSha = git(['rev-parse', 'HEAD'])
    git(['checkout', '-b', 'dev', 'main'])
    git(['push', 'origin', '--all'])
    git(['checkout', 'main'])

    inputs = {
      token: 'token',
      mergiraf: 'false',
      results_file: 'generated/nested/results.json',
      comments: 'true',
      labels: 'true'
    }
    vi.mocked(getInput).mockImplementation(input => inputs[input] || '')
    vi.spyOn(utils, 'getRepoString').mockReturnValue('owner/repo')
    vi.spyOn(utils, 'fetchPulls').mockResolvedValue(
      pulls('feature-1', 'feature-3')
    )
    vi.spyOn(utils, 'createComments').mockResolvedValue()
    vi.spyOn(utils, 'updateLabels').mockResolvedValue()
    const {exec: realExec} = await vi.importActual<{exec: typeof exec}>(
      '@actions/exec'
    )
    realGit = (command, args, options) =>
      realExec(command, args, {...options, cwd: work, silent: true})
    vi.mocked(exec).mockImplementation(realGit)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    await rm(directory, {recursive: true, force: true})
  })

  it('commits only successes with fetched hashes, preserves parents, and repeats deterministically', async () => {
    await autoDev()

    expect(report()).toEqual([{branch: 'feature-1', sha: firstSha}])
    expect(parents()).toEqual([baseSha, firstSha])
    expect(git(['show', 'dev:conflict.txt'], remote)).toBe('first feature')
    const firstResult = git(['rev-parse', 'dev'], remote)

    // A new Actions checkout has no local replacement refs from the first run.
    work = join(directory, 'repeat')
    git(['clone', remote, work], directory)
    await autoDev()
    expect(git(['rev-parse', 'dev'], remote)).toBe(firstResult)
    expect(report()).toEqual([{branch: 'feature-1', sha: firstSha}])
  })

  it('includes a successful built-in fallback alongside a normal success', async () => {
    inputs.mergiraf = 'true'
    vi.mocked(utils.fetchPulls).mockResolvedValue(
      pulls('feature-1', 'fallback-feature')
    )
    let attempts = 0
    vi.mocked(exec).mockImplementation((command, args, options) => {
      if (command === `git merge ${fallbackSha}` && ++attempts === 1) {
        return Promise.reject(new Error('Mergiraf unavailable'))
      }
      return realGit(command, args, options)
    })

    await autoDev()

    expect(report()).toEqual([
      {branch: 'feature-1', sha: firstSha},
      {branch: 'fallback-feature', sha: fallbackSha}
    ])
    expect(parents()).toEqual([baseSha, firstSha, fallbackSha])
    expect(git(['show', 'dev:fallback.txt'], remote)).toBe('fallback')
  })

  it.each(['no labeled PRs', 'all merges failed'])(
    'commits [] when %s',
    async scenario => {
      vi.mocked(utils.fetchPulls).mockResolvedValue(
        scenario === 'no labeled PRs' ? [] : pulls('conflict-with-base')
      )
      // Also cover initial creation of the target branch from a results-only commit.
      git(['push', 'origin', '--delete', 'dev'])
      git(['branch', '-D', 'dev'])

      await autoDev()

      expect(report()).toEqual([])
      expect(parents()).toEqual([baseSha])
      expect(git(['rev-parse', 'dev'], remote)).not.toBe(baseSha)
    }
  )

  it.each(['', undefined])(
    'leaves existing reports alone when results_file is %s',
    async value => {
      if (value === undefined) delete inputs.results_file
      else inputs.results_file = value

      await autoDev()

      expect(git(['show', 'dev:results.json'], remote)).toBe('existing report')
      expect(
        git(['ls-tree', '-r', '--name-only', 'dev', 'generated'], remote)
      ).toBe('')
      expect(parents()).toEqual([baseSha, firstSha])
    }
  )

  it.each(['no labeled PRs', 'all merges failed'])(
    'keeps the base tip without results when %s',
    async scenario => {
      delete inputs.results_file
      vi.mocked(utils.fetchPulls).mockResolvedValue(
        scenario === 'no labeled PRs' ? [] : pulls('conflict-with-base')
      )

      await autoDev()

      expect(git(['rev-parse', 'dev'], remote)).toBe(baseSha)
      expect(git(['show', 'dev:results.json'], remote)).toBe('existing report')
    }
  )

  it('overwrites the prior snapshot instead of appending to it', async () => {
    inputs.results_file = 'results.json'
    await autoDev()
    expect(JSON.parse(git(['show', 'dev:results.json'], remote))).toEqual([
      {branch: 'feature-1', sha: firstSha}
    ])
  })

  it('keeps a concurrent target update and skips PR updates when the report push loses its lease', async () => {
    vi.mocked(exec).mockImplementation((command, args, options) => {
      if (command.startsWith('git push --force-with-lease=')) {
        git(['update-ref', 'refs/heads/dev', firstSha], remote)
      }
      return realGit(command, args, options)
    })

    await autoDev()

    expect(git(['rev-parse', 'dev'], remote)).toBe(firstSha)
    expect(utils.createComments).not.toHaveBeenCalled()
    expect(utils.updateLabels).not.toHaveBeenCalled()
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('moved during this run')
    )
  })

  it.each(['../outside.json', '/outside.json'])(
    'rejects a report outside the repository: %s',
    async path => {
      inputs.results_file = path

      await expect(autoDev()).rejects.toThrow(
        'results_file must name a file inside the repository'
      )

      expect(git(['rev-parse', 'dev'], remote)).toBe(baseSha)
      expect(utils.createComments).not.toHaveBeenCalled()
      expect(utils.updateLabels).not.toHaveBeenCalled()
    }
  )

  it.each(['write', 'stage'])(
    'does not publish or update PRs after a report %s failure',
    async failure => {
      if (failure === 'write') {
        inputs.results_file = 'conflict.txt/results.json'
      } else {
        vi.mocked(exec).mockImplementation((command, args, options) => {
          if (command === 'git --literal-pathspecs add --force --') {
            return Promise.reject(new Error('staging failed'))
          }
          return realGit(command, args, options)
        })
      }

      await expect(autoDev()).rejects.toThrow()

      expect(git(['rev-parse', 'dev'], remote)).toBe(baseSha)
      expect(utils.createComments).not.toHaveBeenCalled()
      expect(utils.updateLabels).not.toHaveBeenCalled()
    }
  )
})
