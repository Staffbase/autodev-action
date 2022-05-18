import {
  Pull,
  createComments,
  createOctokit,
  fetchPulls,
  getRepoString,
  updateLabels
} from './utils'
import {getInput, info, setFailed} from '@actions/core'
import {exec} from '@actions/exec'

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
  const base = getInput('base') || 'master'

  const optimistic = getInput('optimistic') === 'true'

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
  await exec(`git config --global user.email "${email}"`)
  await exec(`git config --global user.name "${user}"`)
  await exec(`git checkout ${branch}`)
  await exec(`git reset --hard origin/${base}`)

  if (pulls.length === 0) {
    if (await hasDiff('HEAD', `origin/${branch}`)) {
      await exec('git push -f')
      info(
        `🎉 No Pull Requests found. Pushed changes, because "${branch}" and "${base}" diverged.`
      )
    } else {
      info('🎉 No Pull Requests found. Nothing to merge.')
    }
    return
  }

  const message = optimistic
    ? await merge(base, pulls, updateComment, updateLabel)
    : await mergeAll(pulls, updateComment, updateLabel)

  // only push to defined branch if there are changes
  if (await hasDiff('HEAD', `origin/${branch}`)) {
    await exec('git push -f')
  }

  info(message)
}

const hasDiff = async (a: string, b: string): Promise<boolean> => {
  let ret = false
  await exec(`git diff ${a}..${b}`, undefined, {
    listeners: {
      stdout: () => {
        ret = true
      }
    }
  })

  return ret
}

type Comment = (success: Pull[]) => Promise<void>
type Label = (success: Pull[]) => Promise<void>

const merge = async (
  base: string,
  pulls: Pull[],
  comment: Comment,
  label: Label
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

  const message = `AutoDev Merge\n\nThe following branches have been merged:\n${success
    .map(p => `- ${p.branch}`)
    .join('\n')}`
  await exec('git commit -m', [message])
  info('test')
  await comment(success)
  await label(success)
  return message
}

const mergeAll = async (
  pulls: Pull[],
  comment: Comment,
  label: Label
): Promise<string> => {
  const message = `AutoDev Merge\n\nThe following branches have been merged:\n${pulls
    .map(p => `- ${p.branch}`)
    .join('\n')}`
  await exec(`git merge -s octopus`, [
    ...pulls.map(p => `origin/${p.branch}`),
    '--no-ff',
    '-m',
    message
  ])
  await comment(pulls)
  await label(pulls)
  return message
}

export default autoDev
