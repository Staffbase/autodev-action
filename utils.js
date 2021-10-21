"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createComments = exports.fetchPulls = exports.getRepoString = void 0;
const github_1 = require("@actions/github");
;
const getRepoString = () => {
    return process.env['GITHUB_REPOSITORY'];
};
exports.getRepoString = getRepoString;
const fetchPulls = async (token, owner, repo) => {
    const octokit = (0, github_1.getOctokit)(token);
    const { data: allPulls } = await octokit.rest.pulls.list({ owner, repo });
    return allPulls;
};
exports.fetchPulls = fetchPulls;
const magicString = "<!---__GENERATED_BY_AUTO_DEV_ACTION-->";
const commentSuccess = (owner, repo, pulls) => (`
🟢 Sucessfully deployed to dev.
The following Pull Requests have been deployed to dev:
${pulls.map(pull => `- ${pullURL(owner, repo, pull.number)}`).join('\n')}

${magicString}
`);
const commentFail = () => (`
🚨 Unable to deploy this Pull Request to dev.
Please check the logs of the github action. The Pull requests with dev-labels might have merge conflicts.

${magicString}
`);
const pullURL = (owner, repo, number) => `https://github.com/${owner}/${repo}/pull/${number}`;
const createComments = async (token, owner, repo, pulls, successfulPulls) => {
    const octokit = (0, github_1.getOctokit)(token);
    for (const pull of pulls) {
        const comments = await octokit.rest.issues.listComments({
            owner,
            repo,
            issue_number: pull.number,
        });
        const previousComments = comments.data.filter(comment => comment.body && comment.body.includes(magicString));
        for (const comment of previousComments) {
            await octokit.rest.issues.deleteComment({
                owner,
                repo,
                comment_id: comment.id,
            });
        }
        if (successfulPulls.some(sp => sp.branch == pull.branch)) {
            await octokit.rest.issues.createComment({
                owner,
                repo,
                issue_number: pull.number,
                body: commentSuccess(owner, repo, successfulPulls)
            });
        }
        else {
            await octokit.rest.issues.createComment({
                owner,
                repo,
                issue_number: pull.number,
                body: commentFail()
            });
        }
    }
};
exports.createComments = createComments;
