"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@actions/core");
const exec_1 = require("@actions/exec");
const utils_1 = require("./utils");
const run = async () => {
    const repoString = (0, utils_1.getRepoString)();
    if (!repoString) {
        (0, core_1.setFailed)("couldn't retrieve the repo string. GITHUB_REPOSITORY not set?");
        return;
    }
    const [owner, repo] = repoString.split('/');
    const token = (0, core_1.getInput)('token');
    const optimistic = (0, core_1.getInput)('optimistic') === "true";
    const pulls = (await (0, utils_1.fetchPulls)(token, owner, repo)).
        filter(pull => pull.labels.some(l => l.name === "dev"));
    if (pulls.length == 0) {
        (0, core_1.info)("nothing to merge.");
        return;
    }
    const branches = pulls.map(pull => pull.head.ref);
    await (0, exec_1.exec)('git config --global user.email "staffbot@staffbase.com"');
    await (0, exec_1.exec)('git config --global user.name "AutoDev Action"');
    await (0, exec_1.exec)('git fetch');
    await (0, exec_1.exec)('git checkout dev');
    await (0, exec_1.exec)('git reset --hard origin/master');
    const message = optimistic ?
        await merge(branches) :
        await mergeAll(branches);
    await (0, exec_1.exec)('git push -f');
    (0, core_1.info)(message);
};
const merge = async (branches) => {
    const success = [];
    for (const branch of branches) {
        try {
            await (0, exec_1.exec)(`git merge origin/${branch}`);
            success.push(branch);
        }
        catch (error) {
            (0, core_1.info)(`encountered merge conflicts with branch "${branch}", error: ${error}`);
            await (0, exec_1.exec)(`git merge --abort`);
        }
    }
    await (0, exec_1.exec)('git reset origin/master');
    await (0, exec_1.exec)('git add -A');
    const message = `AutoDev Merge\n\nThe following branches have been merged:\n${success.map(b => `- ${b}`).join('\n')}`;
    await (0, exec_1.exec)('git commit -m', [message]);
    return message;
};
const mergeAll = async (branches) => {
    const message = `AutoDev Merge\n\nThe following branches have been merged:\n${branches.map(b => `- ${b}`).join('\n')}`;
    await (0, exec_1.exec)(`git merge -s octopus`, [...branches.map(branch => `origin/${branch}`), '--no-ff', '-m', message]);
    return message;
};
exports.default = run;
