import {Pull, createComments, fetchPulls, getRepoString} from './utils'
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
  const optimistic = getInput('optimistic') === 'true'
  const disableComments = getInput('disableComments') === 'true'
  const base = getInput('base') || 'master'

  const allPulls = await fetchPulls(token, owner, repo)
  const pulls = allPulls
    .filter(pull => pull.labels.some(l => l.name === 'dev'))
    .map(pull => ({
      number: pull.number,
      branch: pull.head.ref
    }))

  if (pulls.length === 0) {
    info('nothing to merge.')
    return
  }

  await exec('git config --global user.email "staffbot@staffbase.com"')
  await exec('git config --global user.name "AutoDev Action"')
  await exec('git fetch')
  await exec('git checkout dev')
  await exec(`git reset --hard origin/${base}`)

  const comment = async (successfulPulls: Pull[]): Promise<void> =>
    disableComments
      ? Promise.resolve()
      : createComments(token, owner, repo, pulls, successfulPulls)

  const message = optimistic
    ? await merge(base, pulls, comment)
    : await mergeAll(pulls, comment)

  // only push to origin/dev if there are changes
  if (await hasDiff('HEAD', 'origin/dev')) {
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

const merge = async (
  base: string,
  pulls: Pull[],
  comment: Comment
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
  await comment(success)

  return message
}

const mergeAll = async (pulls: Pull[], comment: Comment): Promise<string> => {
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
  return message
}

export default autoDev