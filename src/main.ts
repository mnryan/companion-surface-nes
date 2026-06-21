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
import { WinReader } from './win-reader.js'

const logger = createModuleLogger('Plugin')

// Shown on each controller's surface settings page (loaded from the repo/release).
const TEMPLATE_PREVIEW_URL =
	'https://raw.githubusercontent.com/mnryan/companion-surface-nes/main/docs/template-preview.png'
const TEMPLATE_DOWNLOAD_URL =
	'https://github.com/mnryan/companion-surface-nes/releases/latest/download/NES-StreamDeck-Template.companionconfig'
const STUDIO_UPGRADE_URL = 'https://studioupgrade.com'
const SPONSOR_URL = 'https://github.com/sponsors/mnryan'

// Player number -> "set player lights" LED bitfield (light the first N LEDs).
const PLAYER_LED = [0x00, 0x01, 0x03, 0x07, 0x0f]

export interface NesInfo {
	id: string // Bluetooth address (stable per physical controller)
	side: string // "L" | "R" | "?"
	name: string
}

// Shared event bus: instances subscribe for their own controller's events.
//   'button' (id, button, pressed)   'gone' (id)
const bus = new EventEmitter()
bus.setMaxListeners(0)

class NesDetection
	extends EventEmitter<SurfacePluginDetectionEvents<NesInfo>>
	implements SurfacePluginDetection<NesInfo>
{
	async triggerScan(): Promise<void> {}
	rejectSurface(): void {}
}

// Locate the platform-specific native helper binary (macOS/Linux). Packager
// flattens extra files to basename, so helpers carry a platform-arch suffix.
// NOTE: webpack (companion-surface-build) HARDCODES import.meta.url to the build
// machine's path, so it's useless at runtime on any other machine. Resolve the
// helper from real runtime locations instead (same approach as win-reader's
// node-hid loader) — otherwise the helper is only found on the build machine.
function findHelper(): string | null {
	const ext = process.platform === 'win32' ? '.exe' : ''
	const name = `nes-helper-${process.platform}-${process.arch}${ext}`
	const bases: string[] = []
	try {
		if (typeof __dirname !== 'undefined' && __dirname) bases.push(__dirname)
	} catch {
		/* __dirname may not exist in ESM dev */
	}
	try {
		if (process.argv[1]) bases.push(dirname(process.argv[1]))
	} catch {
		/* ignore */
	}
	try {
		bases.push(dirname(fileURLToPath(import.meta.url)))
	} catch {
		/* import.meta.url may be a build path */
	}
	bases.push(process.cwd())
	const candidates: string[] = []
	for (const b of bases) candidates.push(join(b, name), join(b, 'helpers', name), join(b, '..', 'helpers', name))
	const found = candidates.find((p) => existsSync(p))
	if (!found) logger.warn(`No NES helper for ${process.platform}-${process.arch}; tried: ${candidates.join(' | ')}`)
	return found ?? null
}

class NesControllerPlugin implements SurfacePlugin<NesInfo> {
	readonly detection = new NesDetection()
	#child: ChildProcess | null = null
	#winReader: WinReader | null = null

	async init(): Promise<void> {
		// Windows: no gamecontrollerd interference, so read raw HID in-process via
		// node-hid (runs in Companion's bundled Node) — no separate helper needed.
		if (process.platform === 'win32') {
			logger.info('Windows: reading controllers via node-hid (in-process)')
			this.#winReader = new WinReader({
				onAdd: (i) => this.#handleAdd(i),
				onRemove: (id) => this.#handleRemove(id),
				onButton: (id, b, p) => this.#handleButton(id, b, p),
			})
			try {
				await this.#winReader.start()
			} catch (e) {
				logger.error(`win-reader failed (node-hid missing?): ${String(e)}`)
			}
			return
		}

		// macOS / Linux: spawn the native helper, parse its JSON event stream.
		const path = findHelper()
		if (!path) {
			logger.warn(`No NES helper binary for ${process.platform}-${process.arch}. Controllers won't appear.`)
			return
		}
		try {
			chmodSync(path, 0o755)
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

	// Shared handlers — called by both the helper-JSON path and the Windows reader.
	#handleAdd(info: NesInfo): void {
		const labelled = info.side === 'L' || info.side === 'R'
		const discovered: DetectionSurfaceInfo<NesInfo> = {
			surfaceId: info.id,
			deviceHandle: info.id,
			description: labelled ? `${info.name} · ${shortAddr(info.id)}` : info.name,
			pluginInfo: info,
		}
		logger.info(`controller added: ${info.name} (${info.id})`)
		this.detection.emit('surfacesAdded', [discovered])
	}
	#handleRemove(id: string): void {
		logger.info(`controller removed: ${id}`)
		bus.emit('gone', id)
		this.detection.emit('surfacesRemoved', [id])
	}
	#handleButton(id: string, button: string, pressed: boolean): void {
		bus.emit('button', id, button, pressed)
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
			case 'add':
				this.#handleAdd({ id: String(msg.id), side: String(msg.side), name: String(msg.name) })
				break
			case 'remove':
				this.#handleRemove(String(msg.id))
				break
			case 'button':
				this.#handleButton(String(msg.id), String(msg.button), !!msg.pressed)
				break
		}
	}

	// Set a controller's player-number LEDs. Windows: node-hid write here.
	// macOS/Linux: send a command to the helper over stdin (helper performs it).
	setLed(id: string, player: number): void {
		const arg = PLAYER_LED[player] ?? 0
		if (this.#winReader) {
			this.#winReader.setLed(id, arg)
			return
		}
		try {
			this.#child?.stdin?.write(JSON.stringify({ type: 'setLed', id, led: arg }) + '\n')
		} catch {
			/* ignore */
		}
	}

	async destroy(): Promise<void> {
		if (this.#winReader) {
			this.#winReader.stop()
			this.#winReader = null
		}
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
			surface: new NesSurface(surfaceId, pluginInfo, context, bus, (id, player) => this.setLed(id, player)),
			registerProps: {
				brightness: false,
				surfaceLayout: createLayout(),
				pincodeMap: null,
				location: null,
				configFields: [
					{
						id: 'player',
						type: 'dropdown',
						label: 'Controller number (LED)',
						tooltip: 'Sets the solid player LEDs on the controller (stops the dancing lights).',
						default: '0',
						choices: [
							{ id: '0', label: 'Off' },
							{ id: '1', label: 'Player 1' },
							{ id: '2', label: 'Player 2' },
							{ id: '3', label: 'Player 3' },
							{ id: '4', label: 'Player 4' },
						],
					},
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
