// Include the native helper binaries in the packaged .tgz. The packager copies
// each matched file to the package root by basename, so the filenames carry a
// platform-arch suffix (e.g. nes-helper-darwin-arm64) and findHelper() resolves
// them by `${process.platform}-${process.arch}`.
module.exports = {
	extraFiles: ['helpers/nes-helper-*'],
	// node-hid is the Windows input path (native module); keep it out of the
	// esbuild bundle and ship it (with its win32 prebuilts) in the package.
	externals: ['node-hid'],
}
