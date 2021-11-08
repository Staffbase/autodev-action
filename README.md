# AutoDev Action

[![Continuous Integration](https://github.com/Staffbase/autodev-action/actions/workflows/main.yml/badge.svg)](https://github.com/Staffbase/autodev-action/actions/workflows/main.yml)

This action merges commits from different Pull requests that have been tagged with the label `dev` into the `dev` branch on your github repository.

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
          # Base branch. This branch is used as base, in which other branches will be merged into.
          # Default: master
          base: main
          # Weather the action should perform an "optimistic" merge of the given Pull requests.
          # If this is set to false, the dev branch will only be build if all Pull requests can be merged.
          # Default: false
          optimistic: true
          # The github action creates a new comment inside every pull request.
          # If you don't want any comments, you can disable the comments by setting this to true
          # Default: false
          disableComments: false
          # The token used to fetch the pull requests from the API
          token: ${{ secrets. PERSONAL_ACCESS_TOKEN }}
          # E-mail address of the user that should merge the PRs
          user: "autodev@example.com"
```

# Release a new version of this action

```bash
npm run package
git add dist
git commit -a -m "build package"
# add tags and push the tags
git tag <tag>
git push --tags
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
