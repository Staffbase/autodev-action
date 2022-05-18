import {components} from '@octokit/openapi-types'
import {getOctokit} from '@actions/github'
import {info} from '@actions/core'

type PullsListResponseData = components['schemas']['pull-request-simple'][]

export interface Pull {
  number: number
  branch: string
}

export const getRepoString = (): undefined | string => {
  return process.env['GITHUB_REPOSITORY']
}

export const fetchPulls = async (
  token: string,
  owner: string,
  repo: string
): Promise<PullsListResponseData> => {
  const octokit = getOctokit(token)
  const {data: allPulls} = await octokit.rest.pulls.list({owner, repo})
  return allPulls
}

const magicString = '<!---__GENERATED_BY_AUTO_DEV_ACTION-->'

const appendMagicString = (comment: string): string =>
  [comment, '', magicString].join('\n')

const commentSuccess = (owner: string, repo: string, pulls: Pull[]): string =>
  `
🟢 Sucessfully deployed to dev.
The following Pull Requests have been deployed to dev:
${pulls.map(pull => `- ${pullURL(owner, repo, pull.number)}`).join('\n')}
`

const commentFail = (): string =>
  `
🚨 Unable to deploy this Pull Request to dev.
Please check the logs of the github action. The Pull requests with dev-labels might have merge conflicts.
`

const pullURL = (owner: string, repo: string, number: number): string =>
  `https://github.com/${owner}/${repo}/pull/${number}`

export const createComments = async (
  token: string,
  owner: string,
  repo: string,
  pulls: Pull[],
  successfulPulls: Pull[],
  customSuccessComment: string,
  customFailureComment: string
): Promise<void> => {
  const octokit = getOctokit(token)
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

    // update last comment
    const previousComments = comments.data.filter(
      comment => comment.body && comment.body.includes(magicString)
    )
    info(`check 1: ${previousComments}`)
    if (previousComments.length !== 0) {
      const lastComment = previousComments[0]
      info('update status comment')
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: lastComment.id,
        body: message
      })

      continue
    }
    info('create status comment')
    // create comment for new pull request
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pull.number,
      body: message
    })
  }
}
