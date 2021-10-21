import {getOctokit} from '@actions/github'

export interface Pull {
    number: number,
    branch: string,
};

export const getRepoString = (): undefined | string => {
    return process.env['GITHUB_REPOSITORY']
}

export const fetchPulls = async (token: string, owner: string, repo: string) => {
    const octokit = getOctokit(token)
    const {data: allPulls} = await octokit.rest.pulls.list({owner, repo})
    return allPulls
}

const magicString = "<!---__GENERATED_BY_AUTO_DEV_ACTION-->"

const commentSuccess = (owner: string, repo: string, pulls: Pull[]) => (
`
🟢 Sucessfully deployed to dev.
The following Pull Requests have been deployed to dev:
${pulls.map(pull => `- ${pullURL(owner, repo, pull.number)}`).join('\n')}

${magicString}
`);


const commentFail = () => (
`
🚨 Unable to deploy this Pull Request to dev.
Please check the logs of the github action. The Pull requests with dev-labels might have merge conflicts.

${magicString}
`);
    
const pullURL = (owner: string, repo: string, number: number) => `https://github.com/${owner}/${repo}/pull/${number}`;

export const createComments = async (token: string, owner: string, repo: string, pulls: Pull[], successfulPulls: Pull[]) => {
    const octokit = getOctokit(token)
    for (const pull of pulls) {
        const comments = await octokit.rest.issues.listComments({
            owner,
            repo,
            issue_number: pull.number,
        })

        const previousComments = comments.data.filter(comment => comment.body && comment.body.includes(magicString))
        for (const comment of previousComments) {
            await octokit.rest.issues.deleteComment({
                owner,
                repo,
                comment_id: comment.id,
            })
        }

        if (successfulPulls.some(sp => sp.branch == pull.branch)) {
            await octokit.rest.issues.createComment({
                owner,
                repo,
                issue_number: pull.number,
                body: commentSuccess(owner, repo, successfulPulls)
            })
        } else {
            await octokit.rest.issues.createComment({
                owner,
                repo,
                issue_number: pull.number,
                body: commentFail()
            })
        }
    }
}

