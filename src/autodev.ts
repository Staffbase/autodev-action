import {
  Pull,
  createComments,
  createOctokit,
  fetchPulls,
  getRepoString,
  updateLabels
} from './utils'
import {getInput, info, setFailed} from '@actions/core'
import {ExecOptions} from '@actions/exec/lib/interfaces'
import {exec} from '@actions/exec'

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
    const message = await merge(
      base,
      pulls,
      updateComment,
      updateLabel,
      commitDate
    )
    info(message)
  }
  await exec(`git checkout -B ${branch}`)

  // only push to defined branch if there are changes
  await exec('git fetch')
  if (await hasDiff('HEAD', `origin/${branch}`)) {
    // ignore any errors
    await exec('git push -f', undefined, {
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
  for (const pull of pulls) {
    try {
      await exec(`git merge origin/${pull.branch}`)
      success.push(pull)
    } catch (error) {
      info(
        `encountered merge conflicts with branch "${pull.branch}", error: ${error}`
      )
      await exec(`git merge --abort`)
    }
  }
  await exec(`git reset origin/${base}`)
  await exec('git add -A')

  const overrideDate = {
    env: {
      GIT_COMMITTER_DATE: commitDate,
      GIT_AUTHOR_DATE: commitDate
    }
  }
  const message = `AutoDev Merge\n\nThe following branches have been merged:\n${success
    .map(p => `- ${p.branch}`)
    .join('\n')}`

  await exec('git commit -m', [message], overrideDate)
  // replace with graft commit so we can preserve commit parents
  await exec(
    `git replace --graft HEAD ${base}`,
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
