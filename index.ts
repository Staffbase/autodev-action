import { setFailed } from '@actions/core'
import run from './autodev'

run().catch((error) => {
    setFailed(error)
})
