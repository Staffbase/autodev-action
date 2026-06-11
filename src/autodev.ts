import {debug, getInput, info, setFailed, warning} from '@actions/core'
import type {ExecOptions} from '@actions/exec'
import {exec} from '@actions/exec'

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

  const runUrl =
    `https://github.com/${owner}/${repo}/actions/runs/` +
    (process.env['GITHUB_RUN_ID'] ?? '')

  const updateComment = async (successfulPulls: Pull[]): Promise<void> => {
    if (!comments) return
    const failureCommentByPR: Map<number, string> =
      mergeResult?.failureCommentByPR ?? new Map<number, string>()
    return createComments(
      octokit,
      owner,
      repo,
      pulls,
      successfulPulls,
      customSuccessComment,
      customFailureComment,
      failureCommentByPR
    )
  }

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

  // Snapshot origin/${branch} at the start of the run. This SHA becomes the
  // --force-with-lease expectation for the final push: if a concurrent run
  // advances origin/${branch} while we are working, our push must abort
  // instead of overwriting the newer tip with our stale build. Capturing it
  // immediately before the push would defeat the guard, because the stale
  // run would simply observe (and adopt) the newer SHA as its expectation.
  const initialBranchSnapshot = await execAndSlurp(
    `git ls-remote --heads origin ${branch}`
  )
  let initialRemoteSha = initialBranchSnapshot.split(/\s+/)[0] || ''

  await exec(`git checkout ${base}`)

  let mergeResult: MergeResult | undefined
  if (pulls.length === 0) {
    info('🎉 No Pull Requests found. Nothing to merge.')
  } else {
    debug(`merging pull requests: ${JSON.stringify(pulls, null, '\t')}`)
    mergeResult = await merge(base, pulls, commitDate, runUrl)
    info(mergeResult.message)
  }

  // check if the branch exists, if not create it from base
  if (!initialBranchSnapshot) {
    info(`Branch ${branch} does not exist. Creating branch from ${base}.`)
    await exec(`git checkout -b ${branch} ${base}`)
    await exec(`git push -u origin refs/heads/${branch}`)
    // Branch was just created in this run; the lease should expect the SHA
    // we just pushed, not an empty ref.
    initialRemoteSha = (await execAndSlurp(`git rev-parse HEAD`)).trim()
  }
  await exec(`git checkout -B ${branch}`)

  // only push to defined branch if there are changes
  await exec('git fetch')
  if (await hasDiff('HEAD', `origin/${branch}`)) {
    let pushStderr = ''
    const code = await exec(
      `git push --force-with-lease=refs/heads/${branch}:${initialRemoteSha} -u origin refs/heads/${branch}`,
      undefined,
      {
        ignoreReturnCode: true,
        listeners: {
          stderr: (data: Buffer) => {
            pushStderr += data.toString()
          }
        }
      }
    )

    if (code !== 0) {
      const leaseRejected =
        /stale info|non-fast-forward|\[rejected\]|is at [0-9a-f]+ but expected [0-9a-f]+/i.test(
          pushStderr
        )
      if (leaseRejected) {
        // A concurrent run won the race. This is expected behavior, not a
        // failure: the workflow that pushed last has already produced a fresh
        // ${branch} tip, and a subsequent AutoDev run will reconcile any
        // changes that landed afterwards. Surface it as a warning so the run
        // stays green and we don't spam failure notifications.
        warning(
          `push to ${branch} skipped: origin/${branch} moved during this run ` +
            `(expected ${initialRemoteSha.substring(0, 7)}). A subsequent AutoDev run will rebuild the branch.`
        )
      } else {
        setFailed(
          `push to ${branch} failed with exit code ${code}: ${pushStderr.trim() || 'no stderr captured'}`
        )
      }
      return
    }
  }

  // Comments and labels are written to the PRs only after the push step has
  // completed without rejection. Otherwise a lease-rejected push would leave
  // success comments/labels on PRs whose merges never landed on the branch.
  if (mergeResult) {
    await updateComment(mergeResult.success)
    await updateLabel(mergeResult.success)
  }
}

const hasDiff = async (a: string, b: string): Promise<boolean> => {
  return (
    (await execAndSlurp(`git rev-parse ${a}`)) !==
    (await execAndSlurp(`git rev-parse ${b}`))
  )
}

interface MergeResult {
  message: string
  success: Pull[]
  failureCommentByPR: Map<number, string>
}

interface FileAttribution {
  file: string
  culpritPRs: number[]
}

const buildConflictDiagnostics = async (
  conflictingFiles: string[],
  mergedPulls: Pull[],
  baseBranch: string
): Promise<FileAttribution[]> => {
  // For each merged PR, get the files it changed relative to base.
  const prFiles: Array<{number: number; files: Set<string>}> = []
  for (const pull of mergedPulls) {
    try {
      const raw = await execAndSlurp(
        `git diff --name-only origin/${baseBranch} origin/${pull.branch}`
      )
      const files = new Set(
        raw
          .split('\n')
          .map(l => l.trim())
          .filter(Boolean)
      )
      prFiles.push({number: pull.number, files})
    } catch {
      // best-effort — skip this PR if we can't get its diff
    }
  }

  return conflictingFiles.map(file => ({
    file,
    culpritPRs: prFiles.filter(pr => pr.files.has(file)).map(pr => pr.number)
  }))
}

const MAX_CONFLICT_FILES = 20

const formatFailureComment = (
  diagnostics: FileAttribution[],
  runUrl: string
): string => {
  const lines: string[] = []
  const shown = diagnostics.slice(0, MAX_CONFLICT_FILES)
  const hidden = diagnostics.length - shown.length

  for (const {file, culpritPRs} of shown) {
    if (culpritPRs.length > 0) {
      lines.push(
        `- \`${file}\` — also modified by ${culpritPRs.map(n => `#${n}`).join(', ')}`
      )
    } else {
      lines.push(`- \`${file}\` — conflicts with \`main\`, rebase needed`)
    }
  }

  if (hidden > 0) {
    lines.push(`- …and ${hidden} more conflicting file(s)`)
  }

  return (
    `**Conflicting files:**\n${lines.join('\n')}\n\n` +
    `[View action run](${runUrl})`
  )
}

const merge = async (
  base: string,
  pulls: Pull[],
  commitDate: string,
  runUrl: string
): Promise<MergeResult> => {
  const success: Pull[] = []
  const failed: Pull[] = []
  const failureCommentByPR = new Map<number, string>()

  for (const pull of pulls) {
    try {
      await exec(`git merge origin/${pull.branch}`)
      success.push(pull)
    } catch (error) {
      // Capture conflicting paths before aborting so we can report them.
      let conflictingFiles: string[] = []
      try {
        const raw = await execAndSlurp('git diff --name-only --diff-filter=U')
        conflictingFiles = raw
          .split('\n')
          .map(l => l.trim())
          .filter(Boolean)
      } catch {
        // best-effort — if capture fails just continue with empty list
      }

      info(
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        `encountered merge conflicts with branch "${pull.branch}", error: ${error}`
      )
      await exec(`git merge --abort`)
      failed.push({...pull, conflictingFiles})

      try {
        if (conflictingFiles.length === 0) {
          failureCommentByPR.set(pull.number, `[View action run](${runUrl})`)
        } else {
          const diagnostics = await buildConflictDiagnostics(
            conflictingFiles,
            success, // only PRs merged so far
            base
          )
          failureCommentByPR.set(
            pull.number,
            formatFailureComment(diagnostics, runUrl)
          )
        }
      } catch {
        // best-effort — leave no custom comment, will use default
      }
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
    return {message, success, failureCommentByPR}
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

  return {message, success, failureCommentByPR}
}

export default autoDev
