import {describe, expect, it} from 'vitest'

import {releaseAssetFor, verifyReleaseChecksum} from './mergiraf'

describe('Mergiraf release selection', () => {
  it.each([
    ['linux', 'x64', 'mergiraf_x86_64-unknown-linux-gnu.tar.gz'],
    ['linux', 'arm64', 'mergiraf_aarch64-unknown-linux-gnu.tar.gz'],
    ['darwin', 'x64', 'mergiraf_x86_64-apple-darwin.tar.gz'],
    ['darwin', 'arm64', 'mergiraf_aarch64-apple-darwin.tar.gz'],
    ['win32', 'x64', 'mergiraf_x86_64-pc-windows-gnu.zip']
  ] as const)('selects the pinned asset for %s-%s', (platform, arch, name) => {
    expect(releaseAssetFor(platform, arch).name).toBe(name)
  })

  it('rejects runner targets without a pinned release asset', () => {
    expect(() => releaseAssetFor('linux', 'ia32')).toThrow(
      'does not support runner platform linux-ia32'
    )
  })
})

describe('Mergiraf release checksum', () => {
  it('accepts matching SHA-256 and rejects modified archive bytes', () => {
    const contents = Buffer.from('verified archive')
    const expected =
      '040a1170825ade3ff37b189dd280153ecfafb99ee929d1cbebb40fe135afdf26'

    expect(() => {
      verifyReleaseChecksum(contents, expected)
    }).not.toThrow()
    expect(() => {
      verifyReleaseChecksum(Buffer.from('modified archive'), expected)
    }).toThrow('Mergiraf release checksum mismatch')
  })
})
