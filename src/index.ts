import autoDev from './autodev'
import {setFailed} from '@actions/core'

async function run(): Promise<void> {
  try {
    await autoDev()
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error)
    }
  }
}

run()
