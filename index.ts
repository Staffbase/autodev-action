import * as core from '@actions/core'

const run = async (): Promise<void> => {
    core.debug("it's working, wowsers")
}

run()

export default run