import {createHash} from 'node:crypto'
import {appendFile, readFile, writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'

interface ReleaseAsset {
  name: string
  sha256: string
  executable: string
}

interface ReleaseManifest {
  version: string
  assets: Record<string, ReleaseAsset>
}

interface CodebergRelease {
  tag_name: string
  draft: boolean
  prerelease: boolean
  assets: Array<{
    name: string
    browser_download_url: string
  }>
}

const RELEASES_URL =
  'https://codeberg.org/api/v1/repos/mergiraf/mergiraf/releases/latest'
const MANIFEST_URL = new URL('./mergiraf-release.json', import.meta.url)

const parseVersion = (version: string): [number, number, number] => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) throw new Error(`Unsupported Mergiraf release tag: ${version}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

const compareVersions = (left: string, right: string): number => {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return 0
}

export const createUpdatedManifest = async (
  current: ReleaseManifest,
  release: CodebergRelease,
  request: typeof fetch = fetch
): Promise<ReleaseManifest | undefined> => {
  if (release.draft || release.prerelease) {
    throw new Error(`Refusing non-stable Mergiraf release: ${release.tag_name}`)
  }
  const version = release.tag_name.replace(/^v/, '')
  if (compareVersions(version, current.version) <= 0) return undefined

  const assets: ReleaseManifest['assets'] = {}
  for (const [target, currentAsset] of Object.entries(current.assets)) {
    const matches = release.assets.filter(
      asset => asset.name === currentAsset.name
    )
    if (matches.length !== 1) {
      throw new Error(
        `Expected one ${currentAsset.name} asset in Mergiraf ${version}; found ${matches.length}`
      )
    }

    const url = new URL(matches[0].browser_download_url)
    const expectedPath = `/mergiraf/mergiraf/releases/download/${release.tag_name}/${currentAsset.name}`
    if (
      url.protocol !== 'https:' ||
      url.host !== 'codeberg.org' ||
      url.pathname !== expectedPath
    ) {
      throw new Error(`Unexpected Mergiraf asset URL: ${url.href}`)
    }

    const response = await request(url)
    if (!response.ok) {
      throw new Error(
        `Failed to download ${currentAsset.name}: HTTP ${response.status}`
      )
    }
    const archive = Buffer.from(await response.arrayBuffer())
    if (archive.length === 0) {
      throw new Error(
        `Downloaded an empty Mergiraf asset: ${currentAsset.name}`
      )
    }
    assets[target] = {
      ...currentAsset,
      sha256: createHash('sha256').update(archive).digest('hex')
    }
  }

  return {version, assets}
}

const appendOutput = async (values: string): Promise<void> => {
  const outputFile = process.env.GITHUB_OUTPUT
  if (outputFile) await appendFile(outputFile, `${values}\n`)
}

const main = async (): Promise<void> => {
  const current = JSON.parse(
    await readFile(MANIFEST_URL, 'utf8')
  ) as ReleaseManifest
  const response = await fetch(RELEASES_URL)
  if (!response.ok) {
    throw new Error(
      `Failed to query Codeberg releases: HTTP ${response.status}`
    )
  }
  const release = (await response.json()) as CodebergRelease
  const updated = await createUpdatedManifest(current, release)
  if (!updated) {
    console.log(`Mergiraf ${current.version} is current`)
    await appendOutput('changed=false')
    return
  }

  await writeFile(MANIFEST_URL, `${JSON.stringify(updated, null, 2)}\n`)
  console.log(`Updated Mergiraf manifest to ${updated.version}`)
  await appendOutput(`changed=true\nversion=${updated.version}`)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main()
}
