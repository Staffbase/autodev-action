import * as core from '@actions/core'
import * as github from '@actions/github'

const run = async (): Promise<void> => {
    const repoString = process.env['GITHUB_REPOSITORY']
    if (!repoString) {
        core.setFailed("couldn't retrieve the repo string. GITHUB_REPOSITORY not set?")
        return
    }
    const [owner, repo] = repoString.split('/')
    
    const token = core.getInput('token');
    const octokit = github.getOctokit(token)

    const {data: pulls} = await octokit.rest.pulls.list({owner, repo})
    core.info(`it's working, wowsers ${JSON.stringify(pulls, null, 2)}`)
}

export default run;