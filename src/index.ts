import {setFailed} from '@actions/core'

import autoDev from './autodev'

async function run(): Promise<void> {
  try {
    await autoDev()
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error)
    }
  }
}

void run()
