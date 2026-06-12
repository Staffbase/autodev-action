import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// ---------------------------------------------------------------------------
// commentFail rendering
// ---------------------------------------------------------------------------
import {commentFail, updateLabels} from './utils'
import type {FailedPull} from './utils'

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
    expect(result).not.toMatch(/`file-a\.yaml`[\s\S]*?pr-b[\s\S]*?`file-b\.yaml`/)

    // file-b.yaml should mention pr-b but NOT pr-a
    expect(result).toMatch(/`file-b\.yaml`[\s\S]*pr-b/)
    expect(result).not.toMatch(/`file-b\.yaml`[\s\S]*?pr-a/)
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

    await updateLabels(octokit, 'owner', 'repo', [pr], [], [], 'successful', 'failed')

    expect(addLabels).not.toHaveBeenCalled()
    expect(removeLabel).not.toHaveBeenCalled()
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

import {getInput, info, setFailed, warning} from '@actions/core'
import {exec} from '@actions/exec'

import autoDev from './autodev'
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
  const labelsSpy = vi.spyOn(utils, 'updateLabels').mockResolvedValue()
  const commentsSpy = vi.spyOn(utils, 'createComments').mockResolvedValue()

  beforeEach(() => {
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
      input =>
        ({token: 'token', base: 'main', comments: 'true'})[input] || ''
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
          Buffer.from(
            'CONFLICT (add/add): Merge conflict in other/file.yaml\n'
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
      input =>
        ({token: 'token', base: 'main', comments: 'true'})[input] || ''
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
      if (cmd === 'git diff-tree --no-commit-id --name-only -r HEAD') {
        opts?.listeners?.stdout?.(Buffer.from('path/to/file.yaml\n'))
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
          ['path/to/file.yaml', [expect.objectContaining({branch: 'feature-1', number: 1})]]
        ])
      })
    ])
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
      input =>
        ({token: 'token', base: 'main', comments: 'true'})[input] || ''
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
      if (cmd === 'git diff-tree --no-commit-id --name-only -r HEAD') {
        opts?.listeners?.stdout?.(Buffer.from('shared/config.yaml\n'))
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
          ['shared/config.yaml', [expect.objectContaining({branch: 'pr-touches-shared-file', number: 10})]]
        ])
      })
    ])
  })
})
