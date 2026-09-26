import {createHash} from 'node:crypto'
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {isFeatureAvailable, restoreCache, saveCache} from '@actions/cache'
import {addPath, info, warning} from '@actions/core'
import {exec} from '@actions/exec'

import releaseManifest from './mergiraf-release.json'

const VERSION = releaseManifest.version
const BASE_URL = `https://codeberg.org/mergiraf/mergiraf/releases/download/v${VERSION}`

interface ReleaseAsset {
  name: string
  sha256: string
  executable: string
}

const RELEASE_ASSETS = releaseManifest.assets as Partial<
  Record<string, ReleaseAsset>
>

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

const archiveFor = async (asset: ReleaseAsset): Promise<Buffer> => {
  const runnerTemp = process.env.RUNNER_TEMP ?? tmpdir()
  const target = `${process.platform}-${process.arch}`
  const cacheDir = join(runnerTemp, 'autodev-mergiraf-cache', VERSION, target)
  const archivePath = join(cacheDir, asset.name)
  const cacheKey = `autodev-mergiraf-v1-${VERSION}-${target}-${asset.sha256}`
  await mkdir(cacheDir, {recursive: true})
  const cacheAvailable = isFeatureAvailable()
  if (cacheAvailable) {
    try {
      const restoredKey = await restoreCache([cacheDir], cacheKey)
      if (restoredKey) {
        const cachedArchive = await readFile(archivePath)
        verifyReleaseChecksum(cachedArchive, asset.sha256)
        info(`Using cached Mergiraf ${VERSION} archive`)
        return cachedArchive
      }
    } catch (error) {
      warning(
        `Ignoring unavailable or invalid Mergiraf cache: ${String(error)}`
      )
      await rm(cacheDir, {recursive: true, force: true})
      await mkdir(cacheDir, {recursive: true})
    }
  }

  const response = await fetch(`${BASE_URL}/${asset.name}`)
  if (!response.ok) {
    throw new Error(
      `Failed to download Mergiraf ${VERSION}: HTTP ${response.status}`
    )
  }
  const archive = Buffer.from(await response.arrayBuffer())
  verifyReleaseChecksum(archive, asset.sha256)
  await writeFile(archivePath, archive)

  if (cacheAvailable) {
    try {
      const cacheId = await saveCache([cacheDir], cacheKey)
      if (cacheId >= 0) {
        info(`Saved Mergiraf ${VERSION} archive to the GitHub Actions cache`)
      }
    } catch (error) {
      warning(`Could not save Mergiraf archive cache: ${String(error)}`)
    }
  }
  return archive
}

const installBinary = async (
  asset: ReleaseAsset,
  installDir: string
): Promise<string> => {
  const executablePath = join(installDir, asset.executable)
  if (await exists(executablePath)) return executablePath

  const archive = await archiveFor(asset)
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
export const primeMergirafCache = async (): Promise<void> => {
  await archiveFor(releaseAssetFor(process.platform, process.arch))
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
