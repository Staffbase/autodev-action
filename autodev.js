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
    const user = (0, core_1.getInput)('user') || "Staffbot";
    const email = (0, core_1.getInput)('email') || "staffbot@staffbase.com";
    const optimistic = (0, core_1.getInput)('optimistic') === "true";
    const disableComments = (0, core_1.getInput)('disableComments') === "true";
    const allPulls = (await (0, utils_1.fetchPulls)(token, owner, repo));
    const pulls = allPulls.
        filter(pull => pull.labels.some(l => l.name === "dev")).
        map(pull => ({
        number: pull.number,
        branch: pull.head.ref,
    }));
    if (pulls.length == 0) {
        (0, core_1.info)("nothing to merge.");
        return;
    }
    await (0, exec_1.exec)(`git config --global user.email "${email}"`);
    await (0, exec_1.exec)(`git config --global user.name "${user}"`);
    await (0, exec_1.exec)('git fetch');
    await (0, exec_1.exec)('git checkout dev');
    await (0, exec_1.exec)('git reset --hard origin/master');
    const comment = (successfulPulls) => disableComments ?
        Promise.resolve() :
        (0, utils_1.createComments)(token, owner, repo, pulls, successfulPulls);
    const message = optimistic ?
        await merge(pulls, comment) :
        await mergeAll(pulls, comment);
    await (0, exec_1.exec)('git push -f');
    (0, core_1.info)(message);
};
const merge = async (pulls, comment) => {
    const success = [];
    for (const pull of pulls) {
        try {
            await (0, exec_1.exec)(`git merge origin/${pull.branch}`);
            success.push(pull);
        }
        catch (error) {
            (0, core_1.info)(`encountered merge conflicts with branch "${pull.branch}", error: ${error}`);
            await (0, exec_1.exec)(`git merge --abort`);
        }
    }
    await (0, exec_1.exec)('git reset origin/master');
    await (0, exec_1.exec)('git add -A');
    const message = `AutoDev Merge\n\nThe following branches have been merged:\n${success.map(p => `- ${p.branch}`).join('\n')}`;
    await (0, exec_1.exec)('git commit -m', [message]);
    await comment(success);
    return message;
};
const mergeAll = async (pulls, comment) => {
    const message = `AutoDev Merge\n\nThe following branches have been merged:\n${pulls.map(p => `- ${p.branch}`).join('\n')}`;
    await (0, exec_1.exec)(`git merge -s octopus`, [...pulls.map(p => `origin/${p.branch}`), '--no-ff', '-m', message]);
    await comment(pulls);
    return message;
};
exports.default = run;
