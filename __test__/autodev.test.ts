import autoDev from '../src/autodev'
import * as exec from '@actions/exec'
import * as core from '@actions/core'
import * as utils from '../src/utils'
import {PullsListResponseData} from '../src/utils'

describe('autodev', () => {
  let info: jest.SpyInstance
  let commentsSpy: jest.SpyInstance
  let labelsSpy: jest.SpyInstance

  beforeEach(() => {
    labelsSpy = jest.spyOn(utils, 'updateLabels').mockResolvedValue()
    commentsSpy = jest.spyOn(utils, 'createComments').mockResolvedValue()
    jest
      .spyOn(utils, 'getRepoString')
      .mockReturnValue('@staffbase/auto-dev-action')
    jest.spyOn(utils, 'fetchPulls').mockResolvedValue([
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

    info = jest.spyOn(core, 'info')
    jest.spyOn(exec, 'exec').mockResolvedValue(0)
  })

  afterEach(() => jest.clearAllMocks())

  it('should merge two pull requests', async () => {
    jest
      .spyOn(core, 'getInput')
      .mockImplementation(
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
    jest
      .spyOn(core, 'getInput')
      .mockImplementation(
        input => ({token: 'token', base: 'main', comments: 'true'})[input] || ''
      )

    await autoDev()

    expect(commentsSpy).toHaveBeenCalled()
  })

  it('should add successful labels', async () => {
    jest
      .spyOn(core, 'getInput')
      .mockImplementation(
        input => ({token: 'token', base: 'main', labels: 'true'})[input] || ''
      )

    await autoDev()

    expect(labelsSpy).toHaveBeenCalled()
  })
})
