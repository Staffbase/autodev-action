# AutoDev Action

[![Continuous Integration](https://github.com/Staffbase/autodev-action/actions/workflows/main.yml/badge.svg)](https://github.com/Staffbase/autodev-action/actions/workflows/main.yml)

Tries to merge all commits from a PR with the dev label into the dev branch.

```
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
          fetch-depth: 0

      - uses: staffbase/autodev-action@latest
        with:
          optimistic: true
          disableComments: false
          token: ${{ secrets.DEV_PUSH_TOKEN }}
          user: ${{ secrets.DEV_PUSH_USER }}
```

## Development

Build

```
npm build
```
_please run `npm build` before merging a PR to master (or add a step to the CI to automate this)_

Test

```
npm test
```
