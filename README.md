# AutoDev Action

[![Continuous Integration](https://github.com/Staffbase/autodev-action/actions/workflows/main.yml/badge.svg)](https://github.com/Staffbase/autodev-action/actions/workflows/main.yml)

This action merges commits from different Pull requests that have been tagged with the label `dev` into the `dev` branch on your GitHub repository.

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
        uses: actions/checkout@v2
        with:
          # The token of the user that should perform the merges. 
          # This must be a personal access token with the necessary permissions
          token: ${{ secrets.PERSONAL_ACCESS_TOKEN }}
          fetch-depth: 0

      - name: Autodev
        uses: staffbase/autodev-action@v1.0.0
        with:
          # The token used to fetch the pull requests from the GitHub API
          token: ${{ secrets. PERSONAL_ACCESS_TOKEN }}
          # This is the base branch. The merge history originates from this branch.
          # Default: master
          base: main
          # Whether the action should perform an "optimistic" merge of the given Pull requests.
          # If this is set to false, the dev branch is only built if there are zero merge conflicts between branches.
          # Default: false
          optimistic: true
          # The GitHub action creates a new comment inside every pull request.
          # If you don't want any comments, you can disable the comments by setting this to true
          # Default: false
          disableComments: false
          # Name of the user which does the git commit.
          # Default: staffbot@staffbase.com 
          user: "autodev@example.com"
          # E-Mail of the user which does the git commit."
          # Default: staffbot@staffbase.com 
          email: "staffbot@staffbase.com"
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
