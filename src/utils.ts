import {debug, info} from '@actions/core'
import {GitHub} from '@actions/github/lib/utils'
import {components} from '@octokit/openapi-types'
import {getOctokit} from '@actions/github'

export type PullsListResponseData =
  components['schemas']['pull-request-simple'][]

export interface Pull {
  sha: string
  number: number
  branch: string
  labels: (string | undefined)[]
  files: string[]
}

export const getRepoString = (): undefined | string => {
  return process.env['GITHUB_REPOSITORY']
}

export const createOctokit = (token: string): InstanceType<typeof GitHub> =>
  getOctokit(token)

export const fetchPulls = async (
  octokit: InstanceType<typeof GitHub>,
  owner: string,
  repo: string
): Promise<PullsListResponseData> => {
  const {data: allPulls} = await octokit.rest.pulls.list({
    owner,
    repo,
    per_page: 100,
    // prioritize old PRs
    sort: 'created',
    direction: 'asc'
  })
  return allPulls
}

const magicString = '<!---__GENERATED_BY_AUTO_DEV_ACTION-->'

const appendMagicString = (comment: string): string =>
  [comment, '', magicString].join('\n')

const commentSuccess = (owner: string, repo: string, pulls: Pull[]): string =>
  `
🟢 Sucessfully merged into the dev branch.
It can take up to a few minutes until the changes are rolled out to the dev system.
The following Pull Requests are merged into the dev branch:
${pulls.map(pull => `- ${pullURL(owner, repo, pull.number)}`).join('\n')}
`

const commentFail = (): string =>
  `
🚨 Unable to merge this branch into the dev branch.
This usually means that one of the PRs with a dev label has merge conflicts.
Please check the logs of the github action.
`

const pullURL = (owner: string, repo: string, number: number): string =>
  `https://github.com/${owner}/${repo}/pull/${number}`

export const createComments = async (
  octokit: InstanceType<typeof GitHub>,
  owner: string,
  repo: string,
  pulls: Pull[],
  successfulPulls: Pull[],
  customSuccessComment: string,
  customFailureComment: string
): Promise<void> => {
  info('update comments')

  for (const pull of pulls) {
    const comments = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: pull.number
    })

    const successful = successfulPulls.some(sp => sp.branch === pull.branch)
    const message = successful
      ? appendMagicString(
          customSuccessComment || commentSuccess(owner, repo, successfulPulls)
        )
      : appendMagicString(customFailureComment || commentFail())

    const previousComment = comments.data.find(
      comment => comment.body?.includes(magicString)
    )

    if (!previousComment) {
      debug(`create comment for pull request ${pull.number}`)
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: pull.number,
        body: message
      })

      continue
    }

    if (previousComment.body !== message) {
      debug(`update comment for pull request ${pull.number}`)
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: previousComment.id,
        body: message
      })
    }
  }
}

export const updateLabels = async (
  octokit: InstanceType<typeof GitHub>,
  owner: string,
  repo: string,
  pulls: Pull[],
  successfulPulls: Pull[],
  customSuccessLabel: string,
  customFailureLabel: string
): Promise<void> => {
  info('update labels')

  for (const pull of pulls) {
    const successful = successfulPulls.some(sp => sp.branch === pull.branch)
    const hasSuccessfulLabel = pull.labels.some(
      label => label === customSuccessLabel
    )
    const hasFailureLabel = pull.labels.some(
      label => label === customFailureLabel
    )

    if (
      (successful && hasSuccessfulLabel) ||
      (!successful && hasFailureLabel)
    ) {
      continue
    }

    if (hasSuccessfulLabel || hasFailureLabel) {
      debug(`remove label from pull request ${pull.number}`)
      await octokit.rest.issues.removeLabel({
        owner,
        repo,
        issue_number: pull.number,
        name: successful ? customFailureLabel : customSuccessLabel
      })
    }

    debug(`add label to pull request ${pull.number}`)
    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: pull.number,
      labels: [successful ? customSuccessLabel : customFailureLabel]
    })
  }
}
