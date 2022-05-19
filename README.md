# AutoDev Action

[![Continuous Integration](https://github.com/Staffbase/autodev-action/actions/workflows/integration.yml/badge.svg)](https://github.com/Staffbase/autodev-action/actions/workflows/integration.yml) 

This action merges commits from different Pull requests that have been tagged with the label `dev` into the `dev` branch on your GitHub repository.

# Usage
```yaml
name: Autodev
on:
  push:
    branches-ignore:
      - dev
  pull_request:
    types: [labeled, unlabeled, opened, closed]

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
        uses: staffbase/autodev-action@v1.3.0
        with:
          # The token used to fetch the pull requests from the GitHub API
          token: ${{ secrets.PERSONAL_ACCESS_TOKEN }}
          # This is the base branch. The merge history originates from this branch.
          # Default: master
          base: main
          # The label where the action will be triggered.
          # Default: dev
          label: dev
          # The branch the action will merge the Pull Requests to.
          # Default: dev
          branch: dev
          # Whether the action should perform an "optimistic" merge of the given Pull requests.
          # If this is set to false, the dev branch is only built if there are zero merge conflicts between branches.
          # Default: false
          optimistic: true
          # The GitHub action creates a new comment inside every pull request.
          # Default: false
          comments: false
          # The GitHub action updates the labels inside every pull request for successful or failed merges to the dev branch.
          # Default: false
          labels: false
          # Name of the user which does the git commit.
          # Default: AutoDev Action
          user: "AutoDev Action"
          # E-Mail of the user which does the git commit."
          # Default: staffbot@staffbase.com 
          email: "staffbot@staffbase.com"
```

# Inputs to customize your action:
```yaml
# Comment string that will be shown in the Pull request on success.
# Default: '' (using a default message)
success_comment: "🎉 The action successfully merged all branches with the dev label."
# Comment string that will be shown in the Pull request on failure.
# Default: '' (using a default message)
failure_comment: "⚠️ Something went wrong."
# Label string that will be shown on the Pull request on success.
# Default: successful
success_label: 'successful'
# Label string that will be shown on the Pull request on failure.
# Default: failed
failure_label: 'failed'
```

# Development

### Run Tests

```
npm test
```

### Typecheck

```
npm build
```

### Format code

```
npm format
```

### Lint code

```
npm lint
```
