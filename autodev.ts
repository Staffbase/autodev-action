import {getInput, setFailed, info} from '@actions/core'
import {getOctokit} from '@actions/github'
import {exec} from '@actions/exec';

const run = async (): Promise<void> => {
    const repoString = process.env['GITHUB_REPOSITORY']
    if (!repoString) {
        setFailed("couldn't retrieve the repo string. GITHUB_REPOSITORY not set?")
        return
    }
    const [owner, repo] = repoString.split('/')
    
    const token = getInput('token');
    const octokit = getOctokit(token)

    const {data: allPulls} = await octokit.rest.pulls.list({owner, repo})
    const pulls = allPulls.
        filter(pull => pull.labels.some(l => l.name === "dev"))

    if (pulls.length == 0) {
        info("nothing to merge.")
        return
    }

    const branches = pulls.map(pull => pull.head.ref);
    const message = `AutoDev Action\n\nThe following branches have been merged:\n${branches.map(b => `- ${b}`).join('\n')}`

    await exec('git config --global user.email "staffbot@staffbase.com"')
    await exec('git config --global user.name "AutoDev Action"')
    await exec('git fetch')
    await exec('git checkout -b new-dev origin/master')
    await exec('git merge -s octopus', [...branches.map(b => `origin/${b}`), '--no-ff', "--allow-unrelated-histories", "-m", message])
    await exec('git checkout dev')
    await exec('git reset --hard new-dev')
    await exec('git push -f')
    
    info(message)
}

export default run;