import { spawn, type ChildProcess } from 'node:child_process'
import EventEmitter from 'node:events'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, chmodSync } from 'node:fs'
import { createInterface } from 'node:readline'
import {
	createModuleLogger,
	type SurfacePlugin,
	type SurfacePluginDetection,
	type SurfacePluginDetectionEvents,
	type DetectionSurfaceInfo,
	type OpenSurfaceResult,
	type SurfaceContext,
} from '@companion-surface/base'
import { NesSurface } from './instance.js'
import { createLayout } from './buttons.js'

const logger = createModuleLogger('Plugin')

// Shown on each controller's surface settings page (loaded from the repo/release).
const TEMPLATE_PREVIEW_URL =
	'https://raw.githubusercontent.com/mnryan/companion-surface-nes/main/docs/template-preview.png'
const TEMPLATE_DOWNLOAD_URL =
	'https://github.com/mnryan/companion-surface-nes/releases/download/v1.0.0/NES-StreamDeck-Template.companionconfig'
const STUDIO_UPGRADE_URL = 'https://studioupgrade.com'
const SPONSOR_URL = 'https://github.com/sponsors/mnryan'

export interface NesInfo {
	id: string // Bluetooth address (stable per physical controller)
	side: string // "L" | "R"
	name: string // "NES Controller (L)"
}

// Shared event bus: instances subscribe for their own controller's events.
//   'button' (id, button, pressed)   'gone' (id)
const bus = new EventEmitter()
bus.setMaxListeners(0)

class NesDetection
	extends EventEmitter<SurfacePluginDetectionEvents<NesInfo>>
	implements SurfacePluginDetection<NesInfo>
{
	async triggerScan(): Promise<void> {
		// Helper streams connect/disconnect live; nothing to re-scan.
	}
	rejectSurface(): void {}
}

// Locate the platform-specific native helper binary. The packager flattens
// extra files to their basename, so helpers carry a platform-arch suffix in the
// filename (e.g. nes-helper-darwin-arm64). Checks the packaged layout (flat,
// beside main.js) and the dev layout (helpers/ at the module root).
function findHelper(): string | null {
	const here = dirname(fileURLToPath(import.meta.url))
	const ext = process.platform === 'win32' ? '.exe' : ''
	const name = `nes-helper-${process.platform}-${process.arch}${ext}`
	const candidates = [
		join(here, name), // packaged: flat beside main.js
		join(here, '..', 'helpers', name), // dev: dist/main.js, helpers/ at module root
	]
	return candidates.find((p) => existsSync(p)) ?? null
}

class NesControllerPlugin implements SurfacePlugin<NesInfo> {
	readonly detection = new NesDetection()
	#child: ChildProcess | null = null

	async init(): Promise<void> {
		const path = findHelper()
		if (!path) {
			logger.warn(
				`No NES helper binary for ${process.platform}-${process.arch}. ` +
					`Controllers won't appear on this platform (macOS only for now).`,
			)
			return
		}
		try {
			chmodSync(path, 0o755) // ensure exec bit survived packaging/extraction
		} catch {
			/* ignore */
		}
		logger.info(`Spawning NES helper: ${path}`)
		this.#child = spawn(path, [], { stdio: ['pipe', 'pipe', 'pipe'] })
		this.#child.on('error', (e) => logger.error(`helper spawn error: ${String(e)}`))
		this.#child.on('exit', (code) => logger.warn(`helper exited (code ${String(code)})`))
		if (this.#child.stderr)
			createInterface({ input: this.#child.stderr }).on('line', (l) => logger.debug(`helper: ${l}`))
		if (this.#child.stdout)
			createInterface({ input: this.#child.stdout }).on('line', (l) => this.#onLine(l))
	}

	#onLine(line: string): void {
		let msg: any
		try {
			msg = JSON.parse(line)
		} catch {
			return
		}
		switch (msg.type) {
			case 'ready':
				logger.info('helper ready')
				break
			case 'add': {
				const info: NesInfo = { id: String(msg.id), side: String(msg.side), name: String(msg.name) }
				const discovered: DetectionSurfaceInfo<NesInfo> = {
					surfaceId: info.id,
					deviceHandle: info.id,
					description: `${info.name} · ${shortAddr(info.id)}`,
					pluginInfo: info,
				}
				logger.info(`controller added: ${info.name} (${info.id})`)
				this.detection.emit('surfacesAdded', [discovered])
				break
			}
			case 'remove': {
				const id = String(msg.id)
				logger.info(`controller removed: ${id}`)
				bus.emit('gone', id)
				this.detection.emit('surfacesRemoved', [id])
				break
			}
			case 'button':
				bus.emit('button', String(msg.id), String(msg.button), !!msg.pressed)
				break
		}
	}

	async destroy(): Promise<void> {
		if (this.#child) {
			try {
				this.#child.stdin?.end()
			} catch {
				/* ignore */
			}
			this.#child.kill()
			this.#child = null
		}
	}

	async openSurface(
		surfaceId: string,
		pluginInfo: NesInfo,
		context: SurfaceContext,
	): Promise<OpenSurfaceResult> {
		logger.debug(`Opening surface ${surfaceId} (${pluginInfo.name})`)
		return {
			surface: new NesSurface(surfaceId, pluginInfo, context, bus),
			registerProps: {
				brightness: false,
				surfaceLayout: createLayout(),
				pincodeMap: null,
				location: null,
				configFields: [
					{
						id: 'template_info',
						type: 'static-text',
						label: 'Stream Deck label template',
						value:
							'Pair this controller with a Stream Deck or Emulator and import the template so the display shows what each button does:' +
							'<br/><br/><img src="' +
							TEMPLATE_PREVIEW_URL +
							'" alt="NES button layout" width="320"/>' +
							'<br/><br/><a href="' +
							TEMPLATE_DOWNLOAD_URL +
							'" target="_blank">⬇ Download the label template (.companionconfig)</a>' +
							' — then load it via Companion\'s <b>Import / Export</b> page.' +
							'<br/><br/>A free plugin from <a href="' +
							STUDIO_UPGRADE_URL +
							'" target="_blank">Studio Upgrade</a>, designed by Ryan Grams · ' +
							'<a href="' +
							SPONSOR_URL +
							'" target="_blank">buy me a coffee ☕</a>',
					},
				],
			},
		}
	}
}

function shortAddr(id: string): string {
	const parts = id.split(':')
	return parts.length >= 2 ? parts.slice(-2).join(':') : id
}

export default new NesControllerPlugin()
