import {createHash} from 'node:crypto'
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {addPath, info} from '@actions/core'
import {exec} from '@actions/exec'
const VERSION = '0.19.1'
const BASE_URL = `https://codeberg.org/mergiraf/mergiraf/releases/download/v${VERSION}`

interface ReleaseAsset {
  name: string
  sha256: string
  executable: string
}

// SHA-256 digests of the published archives; update with VERSION and BASE_URL.
const RELEASE_ASSETS: Partial<Record<string, ReleaseAsset>> = {
  'linux-x64': {
    name: 'mergiraf_x86_64-unknown-linux-gnu.tar.gz',
    sha256: 'f8179e1a779a9b50802b96f7244c85bda3990b6411cd92386bf7c1f829e40b42',
    executable: 'mergiraf'
  },
  'linux-arm64': {
    name: 'mergiraf_aarch64-unknown-linux-gnu.tar.gz',
    sha256: '0aeb06842e2a8f225ee3666624b5747d4975f943f007ab4916aaa9a68e74fb85',
    executable: 'mergiraf'
  },
  'darwin-x64': {
    name: 'mergiraf_x86_64-apple-darwin.tar.gz',
    sha256: '6e7a0414823cd07c79539f48523b54f3b6e29144a0efad511c30d3288f14713b',
    executable: 'mergiraf'
  },
  'darwin-arm64': {
    name: 'mergiraf_aarch64-apple-darwin.tar.gz',
    sha256: '5bdcacc88dcabfd131591b3852a34c98fc9a23afdb5bc5ed1a58450269f7ddb2',
    executable: 'mergiraf'
  },
  'win32-x64': {
    name: 'mergiraf_x86_64-pc-windows-gnu.zip',
    sha256: '094d9f4c2a21b7c1888a08481fd52a1354a4d5a9fb5bae599299fc8c7106e72e',
    executable: 'mergiraf.exe'
  }
}

export const releaseAssetFor = (
  platform: NodeJS.Platform,
  architecture: string
): ReleaseAsset => {
  const target = `${platform}-${architecture}`
  const asset = RELEASE_ASSETS[target]
  if (!asset) {
    throw new Error(
      `Mergiraf ${VERSION} does not support runner platform ${target}`
    )
  }
  return asset
}

export const verifyReleaseChecksum = (
  contents: Buffer,
  expected: string
): void => {
  const actual = createHash('sha256').update(contents).digest('hex')
  if (actual !== expected) {
    throw new Error(
      `Mergiraf release checksum mismatch: expected ${expected}, got ${actual}`
    )
  }
}

const exists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

const installBinary = async (
  asset: ReleaseAsset,
  installDir: string
): Promise<string> => {
  const executablePath = join(installDir, asset.executable)
  if (await exists(executablePath)) return executablePath

  const response = await fetch(`${BASE_URL}/${asset.name}`)
  if (!response.ok) {
    throw new Error(
      `Failed to download Mergiraf ${VERSION}: HTTP ${response.status}`
    )
  }
  const archive = Buffer.from(await response.arrayBuffer())
  verifyReleaseChecksum(archive, asset.sha256)

  await mkdir(installDir, {recursive: true})
  const tempDir = await mkdtemp(join(tmpdir(), 'autodev-mergiraf-'))
  try {
    const archivePath = join(tempDir, asset.name)
    const extractDir = join(tempDir, 'extract')
    await mkdir(extractDir)
    await writeFile(archivePath, archive)
    await exec('tar', ['-xf', archivePath, '-C', extractDir])

    const extractedBinary = join(extractDir, asset.executable)
    await access(extractedBinary)
    await chmod(extractedBinary, 0o755)

    const stagedBinary = join(
      installDir,
      `.mergiraf-${process.pid}-${Date.now()}`
    )
    await copyFile(extractedBinary, stagedBinary)
    await chmod(stagedBinary, 0o755)
    try {
      await rename(stagedBinary, executablePath)
    } catch (error) {
      if (!(await exists(executablePath))) throw error
      await rm(stagedBinary, {force: true})
    }
  } finally {
    await rm(tempDir, {recursive: true, force: true})
  }

  return executablePath
}

export const configureMergiraf = async (): Promise<void> => {
  const asset = releaseAssetFor(process.platform, process.arch)
  const toolCache =
    process.env.RUNNER_TOOL_CACHE ?? process.env.RUNNER_TEMP ?? tmpdir()
  const installDir = join(
    toolCache,
    'autodev-mergiraf',
    VERSION,
    `${process.platform}-${process.arch}`
  )
  await installBinary(asset, installDir)
  addPath(installDir)
  info(`Using Mergiraf ${VERSION} (${asset.name})`)
  let attributes = ''
  await exec('mergiraf', ['languages', '--gitattributes'], {
    silent: true,
    listeners: {
      stdout: data => {
        attributes += data.toString()
      }
    }
  })
  if (!attributes.trim())
    throw new Error('Mergiraf returned an empty attributes list')

  const tempDir = await mkdtemp(
    join(process.env.RUNNER_TEMP ?? tmpdir(), 'autodev-mergiraf-')
  )
  const attributesPath = join(tempDir, 'attributes')
  await writeFile(attributesPath, attributes)

  await exec('git', ['config', '--local', 'merge.mergiraf.name', 'Mergiraf'])
  await exec('git', [
    'config',
    '--local',
    'merge.mergiraf.driver',
    'mergiraf merge --git %O %A %B -s %S -x %X -y %Y -p %P -l %L'
  ])
  await exec('git', ['config', '--local', 'merge.conflictStyle', 'diff3'])
  await exec('git', [
    'config',
    '--local',
    'core.attributesFile',
    attributesPath
  ])
}
