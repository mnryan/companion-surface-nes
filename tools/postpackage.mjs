// Post-package step: companion-surface-build doesn't ship runtime node_modules,
// so inject node-hid (the Windows input path) + its loader pkg-prebuilds into the
// built package, prune node-hid's prebuilds to win32 only, and re-tar.
import { cpSync, rmSync, readdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import * as tar from 'tar'

if (!existsSync('pkg')) {
	console.error('postpackage: pkg/ not found — run companion-surface-build first')
	process.exit(1)
}

const pkgJsonPath = 'pkg/package.json'
const meta = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
meta.dependencies = { ...meta.dependencies, 'node-hid': '^3.3.0', 'pkg-prebuilds': '^1.0.0' }
writeFileSync(pkgJsonPath, JSON.stringify(meta))

for (const m of ['node-hid', 'pkg-prebuilds']) {
	rmSync(`pkg/node_modules/${m}`, { recursive: true, force: true })
	cpSync(`node_modules/${m}`, `pkg/node_modules/${m}`, { recursive: true })
}

// Keep only the Windows prebuilts (node-hid is only used on win32).
const pre = 'pkg/node_modules/node-hid/prebuilds'
if (existsSync(pre)) {
	for (const d of readdirSync(pre)) if (!d.includes('win32')) rmSync(`${pre}/${d}`, { recursive: true, force: true })
}

// Re-tar with the SAME Node tar library Companion uses (portable mode), so the
// archive extracts cleanly on import. (macOS `tar`/bsdtar produced Apple-metadata
// quirks that made Companion's extractor fail with EISDIR.)
const out = `${meta.name}-${meta.version}.tgz`
rmSync(out, { force: true })
await tar.create({ gzip: true, file: out, portable: true }, ['pkg'])
console.log(`postpackage: repacked ${out} with node-hid (win32 prebuilts) via node-tar`)
