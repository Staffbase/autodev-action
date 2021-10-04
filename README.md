AutoDev action

```
on: push
name: Create Default Labels
jobs:
  autodev:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: staffbase/autodev@1.0.0
```

Build:

- `npm build`

Test:

- `npm test`


- new stuff