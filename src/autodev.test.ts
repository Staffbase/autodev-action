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

import {getInput, info} from '@actions/core'
import {exec} from '@actions/exec'

import autoDev from './autodev'
import type {PullsListResponseData} from './utils'
import * as utils from './utils'

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

    vi.mocked(exec).mockResolvedValue(0)
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
})
