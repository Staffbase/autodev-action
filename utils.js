"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPulls = exports.getRepoString = void 0;
const github_1 = require("@actions/github");
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
