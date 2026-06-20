import * as fs from 'fs'
import * as path from 'path'

type PackageMetadata = {
  readonly dependencies?: Record<string, string>
  readonly devDependencies?: Record<string, string>
  readonly optionalDependencies?: Record<string, string>
}

function readPackageDependencies(): Record<string, string> {
  const packageJsonPath = path.join(process.cwd(), 'package.json')
  const packageJson = JSON.parse(
    fs.readFileSync(packageJsonPath, 'utf8'),
  ) as PackageMetadata

  return {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
    ...(packageJson.optionalDependencies ?? {}),
  }
}

describe('SecretStore release contract', () => {
  it('requires Obsidian SecretStorage support in release metadata', () => {
    // Given: provider credentials rely on Obsidian SecretStorage.
    const manifestPath = path.join(process.cwd(), 'manifest.json')
    const versionsPath = path.join(process.cwd(), 'versions.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      minAppVersion: string
      version: string
    }
    const versions = JSON.parse(
      fs.readFileSync(versionsPath, 'utf8'),
    ) as Record<string, string>

    // When/Then: releases do not load on Obsidian versions that fall back to plaintext settings.
    expect(manifest.minAppVersion).toBe('1.11.4')
    expect(versions[manifest.version]).toBe('1.11.4')
  })

  it('does not add native secret storage dependencies', () => {
    // Given: package metadata for the current plugin.
    const dependencies = readPackageDependencies()

    // When/Then: native secret storage packages are absent.
    expect(dependencies).not.toHaveProperty('keytar')
    expect(dependencies).not.toHaveProperty('@napi-rs/keyring')
  })

  it('does not import electron or keychain packages', () => {
    // Given: the first implementation must rely on Obsidian feature detection only.
    const sourcePath = path.join(
      process.cwd(),
      'src',
      'security',
      'secret-store',
      'secret-store.ts',
    )
    const source = fs.readFileSync(sourcePath, 'utf8')
    const dependencies = readPackageDependencies()

    // When/Then: no desktop-only or native keychain dependency enters this layer.
    expect(source).not.toMatch(/\bfrom ['"]electron['"]/)
    expect(source).not.toContain('safeStorage')
    expect(dependencies).not.toHaveProperty('electron')
    expect(dependencies).not.toHaveProperty('keytar')
    expect(dependencies).not.toHaveProperty('@napi-rs/keyring')
  })
})
