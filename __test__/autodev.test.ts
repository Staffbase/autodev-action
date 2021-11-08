import autoDev from '../src/autodev'
import * as exec from '@actions/exec'
import * as core from '@actions/core'

jest.mock('../src/utils', () => ({
  getRepoString: () => '@staffbase/auto-dev-action',
  createComments: () => Promise.resolve(),
  fetchPulls: async () => [
    {
      labels: [{name: 'dev'}],
      head: {
        ref: 'feature-1'
      }
    },
    {
      labels: [{name: 'not-dev'}],
      head: {
        ref: 'feature-2'
      }
    },
    {
      labels: [{name: 'dev'}],
      head: {
        ref: 'feature-3'
      }
    }
  ]
}))

describe('autodev', () => {
  it('it runs', async () => {
    jest.spyOn(exec, 'exec').mockResolvedValue(0)
    jest
      .spyOn(core, 'getInput')
      .mockImplementation(
        input =>
          ({optimistic: 'true', token: 'token', base: 'master'}[input] || '')
      )

    const info = jest.spyOn(core, 'info')
    await autoDev()

    expect(info).toHaveBeenCalledWith(`AutoDev Merge

The following branches have been merged:
- feature-1
- feature-3`)
  })
})