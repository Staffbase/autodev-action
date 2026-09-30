import {createHash} from 'node:crypto'

import {describe, expect, it} from 'vitest'

import releaseManifest from './mergiraf-release.json'
import {createUpdatedManifest} from './mergiraf-release-updater'

const releaseFor = (tag: string) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  assets: Object.values(releaseManifest.assets).map(asset => ({
    name: asset.name,
    browser_download_url: `https://codeberg.org/mergiraf/mergiraf/releases/download/${tag}/${asset.name}`
  }))
})

describe('Mergiraf release updater', () => {
  it('updates every supported checksum for a newer stable release', async () => {
    const release = releaseFor('v0.20.0')
    const downloads: string[] = []
    const updated = await createUpdatedManifest(
      releaseManifest,
      release,
      input => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url
        downloads.push(url)
        return Promise.resolve(new Response(Buffer.from(url)))
      }
    )

    if (!updated) throw new Error('expected a manifest update')
    expect(updated.version).toBe('0.20.0')
    expect(downloads).toHaveLength(Object.keys(releaseManifest.assets).length)
    for (const [target, asset] of Object.entries(updated.assets)) {
      const downloadedAsset = release.assets.find(
        item => item.name === asset.name
      )
      if (!downloadedAsset) throw new Error(`missing fixture for ${asset.name}`)
      const downloadUrl = downloadedAsset.browser_download_url
      expect(asset.sha256).toBe(
        createHash('sha256').update(downloadUrl).digest('hex')
      )
      expect(
        releaseManifest.assets[target as keyof typeof releaseManifest.assets]
          .sha256
      ).not.toBe(asset.sha256)
    }
  })

  it('does not download the same or an older release', async () => {
    const request = (): Promise<Response> =>
      Promise.reject(new Error('unexpected download'))

    await expect(
      createUpdatedManifest(
        releaseManifest,
        releaseFor(`v${releaseManifest.version}`),
        request
      )
    ).resolves.toBeUndefined()
    await expect(
      createUpdatedManifest(releaseManifest, releaseFor('v0.19.0'), request)
    ).resolves.toBeUndefined()
  })

  it('rejects prereleases and incomplete platform assets', async () => {
    await expect(
      createUpdatedManifest(releaseManifest, {
        ...releaseFor('v0.20.0'),
        prerelease: true
      })
    ).rejects.toThrow('Refusing non-stable Mergiraf release')

    await expect(
      createUpdatedManifest(releaseManifest, {
        ...releaseFor('v0.20.0'),
        assets: []
      })
    ).rejects.toThrow('Expected one')
  })

  it('rejects asset URLs outside Codeberg', async () => {
    const release = releaseFor('v0.20.0')
    release.assets[0].browser_download_url =
      'https://example.com/mergiraf.tar.gz'

    await expect(
      createUpdatedManifest(releaseManifest, release)
    ).rejects.toThrow('Unexpected Mergiraf asset URL')
  })
})
