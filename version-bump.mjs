import { readFileSync, writeFileSync } from 'fs'

const writeJson = (path, value) => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

const targetVersion = process.argv[2]
if (!targetVersion) {
  console.error('Please provide a target version as a command line argument.')
  process.exit(1)
}

if (!/^\d+\.\d+\.\d+$/.test(targetVersion)) {
  console.error('Please provide an exact version like 2.0.0 without a leading v.')
  process.exit(1)
}

// read minAppVersion from manifest.json and bump version to target version
let manifest = JSON.parse(readFileSync('manifest.json', 'utf8'))
const { minAppVersion } = manifest
manifest.version = targetVersion
writeJson('manifest.json', manifest)

// update versions.json with target version and minAppVersion from manifest.json
let versions = JSON.parse(readFileSync('versions.json', 'utf8'))
versions[targetVersion] = minAppVersion
writeJson('versions.json', versions)

// update package.json with target version
let packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
packageJson.version = targetVersion
writeJson('package.json', packageJson)

// update package-lock.json with target version
let packageLock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
packageLock.version = targetVersion
packageLock.packages[''].version = targetVersion
writeJson('package-lock.json', packageLock)
