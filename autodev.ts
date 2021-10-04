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

    const branches = pulls.map(pull => pull.head.ref);
    const message = `AutoDev Action Commit\nThe following branches have been merged:\n${branches.map(b => `- ${b}`).join('\n')}`
    await exec('git fetch')
    await exec('git merge -s octopus origin/dev', [...branches.map(b => `origin/${b}`), "-m", message])
    
    info(message)
}

export default run;