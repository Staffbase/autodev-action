AutoDev action
---

```
on:
  push:
    branches-ignore:
      - dev
  pull_request:
    types: [labeled, unlabeled, opened, closed]

jobs:
  autodev:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v2
        with:
          fetch-depth: 0
      - uses: @staffbase/autodev@1.0.1
        with:
          optimistic: true
          token: ${{ secrets.DEV_PUSH_TOKEN }}
          user: ${{ secrets.DEV_PUSH_USER }}
```

Build:

- `npm build`

Test:

- `npm test`