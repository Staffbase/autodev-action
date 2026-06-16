import {debug, getInput, info, setFailed, warning} from '@actions/core'
import type {ExecOptions} from '@actions/exec'
import {exec} from '@actions/exec'

import type {FailedPull, Pull} from './utils'
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

  const updateComment = async (
    successfulPulls: Pull[],
    failedPulls: FailedPull[]
  ): Promise<void> =>
    comments
      ? createComments(
          octokit,
          owner,
          repo,
          base,
          pulls,
          successfulPulls,
          failedPulls,
          customSuccessComment,
          customFailureComment
        )
      : Promise.resolve()

  const updateLabel = async (
    successfulPulls: Pull[],
    failedPulls: FailedPull[]
  ): Promise<void> =>
    labels
      ? updateLabels(
          octokit,
          owner,
          repo,
          pulls,
          successfulPulls,
          failedPulls,
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
    mergeResult = await merge(base, pulls, commitDate)
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
  //
  // Failed-merge comments are also gated behind a successful push: if the
  // push was rejected, the failed PR will be retried on the next run and any
  // "you have a conflict" comment posted now might be wrong by then (e.g.
  // the PR that was merged ahead of it could land on main in the meantime,
  // or a different run-order could let this PR through cleanly).
  if (mergeResult) {
    await updateComment(mergeResult.success, mergeResult.failed)
    await updateLabel(mergeResult.success, mergeResult.failed)
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
  failed: FailedPull[]
}

/**
 * Parse conflicting file paths from git merge output. git uses different line
 * formats depending on the conflict type; each is matched specifically:
 *
 *   content / add-add:  "CONFLICT (...): Merge conflict in <path>"
 *   modify/delete:      "CONFLICT (modify/delete): <path> deleted in HEAD..."
 *   delete/modify:      "CONFLICT (delete/modify): <path> deleted in ..."
 *   rename/rename:      "CONFLICT (rename/rename): <orig> renamed to <a> in ... and to <b> in ..."
 *                       → both target paths extracted since either could be the
 *                         path a sibling PR is also modifying.
 *
 * A single merge attempt produces at most one CONFLICT line per file (verified
 * against real GHA runs), so dedup is not strictly needed but is kept as cheap
 * insurance against future git versions or unexpected multi-hunk output.
 */
const extractConflictFiles = (stderr: string): string[] => {
  const files = new Set<string>()

  for (const m of stderr.matchAll(
    /^CONFLICT \([^)]*\): Merge conflict in (.+)$/gm
  )) {
    files.add(m[1].trim())
  }
  for (const m of stderr.matchAll(
    /^CONFLICT \(modify\/delete\): (.+?) deleted in /gm
  )) {
    files.add(m[1].trim())
  }
  for (const m of stderr.matchAll(
    /^CONFLICT \(delete\/modify\): (.+?) deleted in /gm
  )) {
    files.add(m[1].trim())
  }
  for (const m of stderr.matchAll(
    /^CONFLICT \(rename\/rename\): \S+ renamed to (\S+) in \S+ and to (\S+) in/gm
  )) {
    files.add(m[1].trim())
    files.add(m[2].trim())
  }

  return Array.from(files)
}

const merge = async (
  base: string,
  pulls: Pull[],
  commitDate: string
): Promise<MergeResult> => {
  const success: Pull[] = []
  const failed: FailedPull[] = []

  // file path -> all dev-labeled PRs that successfully merged into the synthetic
  // dev branch *earlier in this loop* and touched that file. The map answers
  // the question a later failing PR needs answered: "which PRs were merged into
  // dev ahead of me and now occupy the file I'm trying to change?"
  //
  // Important: this is NOT mutual blame. PRs that merged first are fine and
  // stay in dev; only the PR whose merge attempt fails is excluded from this
  // dev rebuild. The "winner" is purely temporal — whichever git merge ran
  // first. See commentFail in utils.ts for the user-facing wording.
  //
  // Conflicts caused by commits already on `base` (e.g. another PR merged to
  // main while this one was open) leave the list empty for that file, and the
  // comment lists the file with no PR pointer.
  const fileToPulls = new Map<string, Pull[]>()

  for (const pull of pulls) {
    let mergeOutput = ''
    try {
      await exec(`git merge origin/${pull.branch}`, undefined, {
        listeners: {
          stdout: (data: Buffer) => {
            mergeOutput += data.toString()
          },
          stderr: (data: Buffer) => {
            mergeOutput += data.toString()
          }
        }
      })
      success.push(pull)
    } catch (error) {
      info(
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        `encountered merge conflicts with branch "${pull.branch}", error: ${error}`
      )

      const conflictFiles = extractConflictFiles(mergeOutput)
      const conflictingFileToPulls = new Map<string, Pull[]>()
      for (const file of conflictFiles) {
        conflictingFileToPulls.set(file, fileToPulls.get(file) ?? [])
      }

      await exec(`git merge --abort`)
      failed.push({
        ...pull,
        conflictingFileToPulls
      })
      continue
    }

    // Record which files this PR's merge commit touched, so a later failing
    // merge can point at this PR as "merged ahead of you in this run." The
    // diff is taken against the previous HEAD (the parent of the just-
    // created merge commit), capturing exactly the files this PR contributed.
    const changedFiles = await execAndSlurp(
      `git diff-tree --no-commit-id --name-only -r HEAD`
    )
    for (const file of changedFiles.split('\n')) {
      const trimmed = file.trim()
      if (trimmed) {
        const existing = fileToPulls.get(trimmed) ?? []
        fileToPulls.set(trimmed, [...existing, pull])
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
    return {message, success, failed}
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

  return {message, success, failed}
}

export default autoDev
