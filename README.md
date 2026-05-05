# 👷 AutoDev Action

[![Continuous Integration](https://github.com/Staffbase/autodev-action/actions/workflows/integration.yml/badge.svg)](https://github.com/Staffbase/autodev-action/actions/workflows/integration.yml)
[![GitHub release (latest by date)](https://img.shields.io/github/v/release/Staffbase/autodev-action)](https://github.com/Staffbase/autodev-action/releases)

This action merges commits from different pull requests that have been tagged with the label `dev` into the `dev` branch on your GitHub repository.

```yaml
name: Autodev
on:
  push:
    branches-ignore:
      - dev
  pull_request:
    types: [labeled, unlabeled, closed]

jobs:
  autodev:
    name: Build Dev Branch
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v3
        with:
          # The token of the user that should perform the merges. 
          # This must be a personal access token with the necessary permissions
          token: ${{ secrets.PERSONAL_ACCESS_TOKEN }}
          fetch-depth: 0

      - name: Autodev
        uses: Staffbase/autodev-action@v2.7.0
        with:
          # The token used to fetch the pull requests from the GitHub API
          token: ${{ secrets.PERSONAL_ACCESS_TOKEN }}
```

# All options

You can find all input options which are available for this action.

| **Input**       | **Description**                                                                                                                                                                               | **Default**            |
|-----------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------|
| token           | PAT for GitHub API authentication                                                                                                                                                             |                        |
| base            | This is the base branch. The merge history originates from this branch.                                                                                                                       | main                   |
| branch          | The branch the action will merge the pull requests to.                                                                                                                                        | dev                    |
| label           | The label where the action will be triggered.                                                                                                                                                 | dev                    |
| comments        | The GitHub action creates a new comment inside every pull request.                                                                                                                            | false                  |
| success_comment | Comment string that will be shown in the pull request on success. Only necessary if `comments` is enabled.                                                                                    | ''                     |
| failure_comment | Comment string that will be shown in the pull request on failure. Only necessary if `comments` is enabled.                                                                                    | ''                     |
| labels          | The GitHub action updates the labels inside every pull request for successful or failed merges to the dev branch.                                                                             | false                  |
| success_label   | Label string that will be shown on the Pull request on success. Only necessary if `labels` is enabled.                                                                                        | successful             |
| failure_label   | Label string that will be shown on the Pull request on failure. Only necessary if `labels` is enabled.                                                                                        | failed                 |
| user            | Name of the user which does the git commit.                                                                                                                                                   | AutoDev Action         |
| email           | E-Mail of the user which does the git commit.                                                                                                                                                 | staffbot@staffbase.com |

# Example Usages

Always create a dev branch if you're using a version older than v2.2.

```yaml
- name: Autodev
  uses: Staffbase/autodev-action@v2.7.0
  with:
    token: ${{ secrets.PERSONAL_ACCESS_TOKEN }}
```

Add a status comment if the merge was successful or failed.

```yaml
- name: Autodev
  uses: Staffbase/autodev-action@v2.7.0
  with:
    token: ${{ secrets.PERSONAL_ACCESS_TOKEN }}
    comments: true
    success_comment: '🎉 The action successfully merged all branches with the dev label.'
    failure_comment: '⚠️ Something went wrong.'
```

Add a status label if the merge was successful or failed.

```yaml
- name: Autodev
  uses: Staffbase/autodev-action@v2.7.0
  with:
    token: ${{ secrets.PERSONAL_ACCESS_TOKEN }}
    labels: true
    success_label: 'successful'
    failure_label: 'failed'
```

# Release

Releases are maintained continuously by [Release Drafter](https://github.com/release-drafter/release-drafter). On every push to `main`, the open draft on the [Releases page](https://github.com/Staffbase/autodev-action/releases) is rebuilt from merged pull requests, with the next version (`vX.Y.Z`) resolved from PR labels (see `.github/release-drafter.yml` for the mapping).

When the draft is ready to ship, open it on the Releases page and click **Publish release**. The tag is created at publish time. Remember to bump the `version` field in `package.json` in a follow-up PR so it matches the published tag.

# Development

Very nice that you want to work on the action. To create a working implementation, you can use the following command to perform all the necessary actions.

```bash
pnpm run all
```

<table>
  <tr>
    <td>
      <img src="docs/assets/images/staffbase.png" alt="Staffbase SE" width="96" />
    </td>
    <td>
      <b>Staffbase SE</b>
      <br />Staffbase is an internal communications platform built to revolutionize the way you work and unite your company. Staffbase is hiring: <a href="https://jobs.staffbase.com" target="_blank" rel="noreferrer">jobs.staffbase.com</a>
      <br /><a href="https://github.com/Staffbase" target="_blank" rel="noreferrer">GitHub</a> | <a href="https://staffbase.com/" target="_blank" rel="noreferrer">Website</a> | <a href="https://jobs.staffbase.com" target="_blank" rel="noreferrer">Jobs</a>
    </td>
  </tr>
</table>
