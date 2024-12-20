import {debug, getInput, info, setFailed} from '@actions/core'
import {exec} from '@actions/exec'
import type {ExecOptions} from '@actions/exec/lib/interfaces'

import type {Pull} from './utils'
import {
  createComments,
  createOctokit,
  fetchPulls,
  getRepoString,
  updateLabels
} from './utils'

/**
 * this function runs a command via exec, and returns the whole output as string.
 */
const execAndSlurp = async (
  commandLine: string,
  args?: string[],
  options?: ExecOptions
): Promise<string> => {
  let ret = ''

  await exec(commandLine, args, {
    ...options,
    listeners: {
      ...options?.listeners,

      stdout: (data: Buffer) => {
        ret += data.toString()
      }
    }
  })

  return ret
}

const autoDev = async (): Promise<void> => {
  const repoString = getRepoString()
  if (!repoString) {
    setFailed("couldn't retrieve the repo string. GITHUB_REPOSITORY not set?")
    return
  }
  const [owner, repo] = repoString.split('/')

  const token = getInput('token')
  const user = getInput('user') || 'AutoDev Action'
  const email = getInput('email') || 'staffbot@staffbase.com'

  const label = getInput('label') || 'dev'
  const branch = getInput('branch') || 'dev'
  const base = getInput('base') || 'main'

  const comments = getInput('comments') === 'true'
  const customSuccessComment = getInput('success_comment') || ''
  const customFailureComment = getInput('failure_comment') || ''

  const labels = getInput('labels') === 'true'
  const customSuccessLabel = getInput('success_label') || 'successful'
  const customFailureLabel = getInput('failure_label') || 'failed'

  const octokit = createOctokit(token)

  const updateComment = async (successfulPulls: Pull[]): Promise<void> =>
    comments
      ? createComments(
          octokit,
          owner,
          repo,
          pulls,
          successfulPulls,
          customSuccessComment,
          customFailureComment
        )
      : Promise.resolve()

  const updateLabel = async (successfulPulls: Pull[]): Promise<void> =>
    labels
      ? updateLabels(
          octokit,
          owner,
          repo,
          pulls,
          successfulPulls,
          customSuccessLabel,
          customFailureLabel
        )
      : Promise.resolve()

  const allPulls = await fetchPulls(octokit, owner, repo)
  const pulls = allPulls
    .filter(pull => pull.labels.some(l => l.name === label))
    .map(pull => ({
      sha: pull.head.sha,
      number: pull.number,
      branch: pull.head.ref,
      labels: pull.labels.map(l => l.name)
    }))

  await exec('git fetch')
  await exec(`git config user.email "${email}"`)
  await exec(`git config user.name "${user}"`)
  const commitDate = await execAndSlurp(
    `git show -s --format='%ci' origin/${base}`
  )

  await exec(`git checkout ${base}`)

  if (pulls.length === 0) {
    info('🎉 No Pull Requests found. Nothing to merge.')
  } else {
    debug(`merging pull requests: ${JSON.stringify(pulls, null, '\t')}`)
    const message = await merge(
      base,
      pulls,
      updateComment,
      updateLabel,
      commitDate
    )
    info(message)
  }

  // check if the branch exists, if not create it from base
  const branchExists = await execAndSlurp(
    `git ls-remote --heads origin ${branch}`
  )
  if (!branchExists) {
    info(`Branch ${branch} does not exist. Creating branch from ${base}.`)
    await exec(`git checkout -b ${branch} ${base}`)
    await exec(`git push -u origin refs/heads/${branch}`)
  }
  await exec(`git checkout -B ${branch}`)

  // only push to defined branch if there are changes
  await exec('git fetch')
  if (await hasDiff('HEAD', `origin/${branch}`)) {
    // ignore any errors
    await exec(`git push -f -u origin refs/heads/${branch}`, undefined, {
      ignoreReturnCode: true
    })
  }
}

const hasDiff = async (a: string, b: string): Promise<boolean> => {
  return (
    (await execAndSlurp(`git rev-parse ${a}`)) !==
    (await execAndSlurp(`git rev-parse ${b}`))
  )
}

type Comment = (success: Pull[]) => Promise<void>
type Label = (success: Pull[]) => Promise<void>

const merge = async (
  base: string,
  pulls: Pull[],
  comment: Comment,
  label: Label,
  commitDate: string
): Promise<string> => {
  const success: Pull[] = []
  const failed: Pull[] = []

  for (const pull of pulls) {
    try {
      await exec(`git merge origin/${pull.branch}`)
      success.push(pull)
    } catch (error) {
      info(
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        `encountered merge conflicts with branch "${pull.branch}", error: ${error}`
      )
      await exec(`git merge --abort`)
      failed.push(pull)
    }
  }

  const overrideDate = {
    env: {
      GIT_COMMITTER_DATE: commitDate,
      GIT_AUTHOR_DATE: commitDate
    }
  }

  const toBulletPoint = (pull: Pull): string =>
    `- PR ${pull.number} ${pull.branch} (${pull.sha.substring(0, 7)})`

  const successList = success.map(toBulletPoint).join('\n')
  const failList = failed.map(toBulletPoint).join('\n')

  const message =
    `AutoDev Merge\n\n` +
    `The following branches have been merged:\n${successList}\n\n` +
    `The following branches failed to merge:\n${failList}`

  if (success.length === 0) {
    return message
  }

  await exec(`git reset origin/${base}`)
  await exec('git add -A')

  await exec('git commit -m', [message], overrideDate)
  // replace with graft commit so we can preserve commit parents
  await exec(
    `git replace --graft HEAD origin/${base}`,
    success.map(p => `origin/${p.branch}`),
    overrideDate
  )
  const rev = await execAndSlurp('git rev-parse HEAD')
  await exec(`git checkout replace/${rev}`)

  await comment(success)
  await label(success)

  return message
}

export default autoDev
