import {getOctokit} from '@actions/github'

export const getRepoString = (): undefined | string => {
    return process.env['GITHUB_REPOSITORY']
}

export const fetchPulls = async (token: string, owner: string, repo: string) => {
    const octokit = getOctokit(token)
    const {data: allPulls} = await octokit.rest.pulls.list({owner, repo})
    return allPulls
}
