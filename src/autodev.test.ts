import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('@actions/core', () => ({
  debug: vi.fn(),
  getInput: vi.fn(),
  info: vi.fn(),
  setFailed: vi.fn()
}))

vi.mock('@actions/exec', () => ({
  exec: vi.fn()
}))

import {getInput, info, setFailed} from '@actions/core'
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

  it('should setFailed when the push is rejected because origin/dev moved', async () => {
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

    expect(setFailed).toHaveBeenCalledWith(
      expect.stringContaining(
        `push to dev aborted: origin/dev moved during this run`
      )
    )
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
})
