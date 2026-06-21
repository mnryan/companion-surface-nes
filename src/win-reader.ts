import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { createModuleLogger } from '@companion-surface/base'

const logger = createModuleLogger('WinReader')

// webpack (used by companion-surface-build) rewrites normal require/import into
// its own module registry and hardcodes import.meta.url to the BUILD path, so
// neither can load node-hid at runtime. __non_webpack_require__ is the real Node
// require; combined with an absolute path it loads node-hid (and lets node-hid
// resolve its own pkg-prebuilds/.node siblings) regardless of host context.
declare const __non_webpack_require__: ((id: string) => any) | undefined

function loadNodeHid(): any {
	const realRequire = typeof __non_webpack_require__ === 'function' ? __non_webpack_require__ : null
	if (!realRequire) throw new Error('no runtime require available (not a webpack bundle?)')

	// Candidate base dirs that may contain node_modules/node-hid at runtime.
	const bases: string[] = []
	try {
		if (typeof __dirname !== 'undefined' && __dirname) bases.push(__dirname)
	} catch {
		/* __dirname may not exist */
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

	const tried: string[] = []
	for (const base of bases) {
		for (const rel of ['node_modules/node-hid', join('..', 'node_modules', 'node-hid')]) {
			const p = join(base, rel)
			tried.push(p)
			if (existsSync(p)) {
				logger.info(`node-hid resolved at: ${p}`)
				return realRequire(p)
			}
		}
	}
	logger.warn(`node-hid not found near module; tried: ${tried.join(' | ')} — falling back to bare require`)
	return realRequire('node-hid')
}

export interface WinControllerInfo {
	id: string
	side: string
	name: string
}

export interface WinReaderHandlers {
	onAdd: (info: WinControllerInfo) => void
	onRemove: (id: string) => void
	onButton: (id: string, button: string, pressed: boolean) => void
}

// "b878261adda5" -> "B8:78:26:1A:DD:A5"
function bdaddr(serial: string): string {
	const h = (serial || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase()
	return h.length === 12 ? h.match(/.{2}/g)!.join(':') : (serial || 'unknown').toUpperCase()
}

interface OpenDev {
	id: string
	hid: any
	state: Record<string, boolean>
}

/**
 * Windows reader: Switch controllers present as a standard HID gamepad with no
 * gamecontrollerd-style interference, so we read raw HID directly via node-hid
 * (in Companion's bundled Node) — no separate helper needed. Decodes the 0x3F
 * "simple HID" report (mapped on the bench) and emits the same button events the
 * native helpers do.
 *
 * 0x3F report (node-hid buffer incl. report id at [0]=0x3f):
 *   [1]: A=0x02 B=0x01 L=0x10 R=0x20
 *   [2]: Select=0x01 Start=0x02
 *   [3]: D-pad hat 0=Up 2=Right 4=Down 6=Left 8=neutral (odd=diagonals)
 */
export class WinReader {
	readonly #handlers: WinReaderHandlers
	#HID: any
	#devs = new Map<string, OpenDev>() // keyed by raw serial/path
	#timer: ReturnType<typeof setInterval> | null = null

	constructor(handlers: WinReaderHandlers) {
		this.#handlers = handlers
	}

	async start(): Promise<void> {
		const mod: any = loadNodeHid()
		this.#HID = mod.default ?? mod
		this.#scan()
		this.#timer = setInterval(() => this.#scan(), 2000) // hotplug + disconnect
	}

	stop(): void {
		if (this.#timer) clearInterval(this.#timer)
		this.#timer = null
		for (const d of this.#devs.values()) {
			try {
				d.hid.close()
			} catch {
				/* ignore */
			}
		}
		this.#devs.clear()
	}

	// ledArg lights the first N LEDs: P1=0x01 P2=0x03 P3=0x07 P4=0x0F, 0=off
	setLed(id: string, ledArg: number): void {
		for (const d of this.#devs.values()) {
			if (d.id !== id) continue
			try {
				d.hid.write([0x01, 0x00, 0x00, 0x01, 0x40, 0x40, 0x00, 0x01, 0x40, 0x40, 0x30, ledArg & 0x0f])
			} catch (e) {
				logger.warn(`setLed failed for ${id}: ${String(e)}`)
			}
			return
		}
	}

	#scan(): void {
		let list: any[]
		try {
			list = this.#HID.devices().filter(
				(d: any) => d.vendorId === 0x057e && d.usagePage === 1 && (d.usage === 5 || d.usage === 4),
			)
		} catch (e) {
			logger.warn(`HID enumerate failed: ${String(e)}`)
			return
		}
		const seen = new Set<string>()
		for (const info of list) {
			const key = String(info.serialNumber || info.path)
			seen.add(key)
			if (!this.#devs.has(key)) this.#open(info, key)
		}
		for (const key of [...this.#devs.keys()]) {
			if (!seen.has(key)) this.#close(key)
		}
	}

	#open(info: any, key: string): void {
		let hid: any
		try {
			hid = new this.#HID.HID(info.path)
		} catch (e) {
			logger.warn(`open failed: ${String(e)}`)
			return
		}
		const id = bdaddr(String(info.serialNumber || key))
		const short = id.includes(':') ? id.split(':').slice(-2).join(':') : id
		const dev: OpenDev = { id, hid, state: {} }
		this.#devs.set(key, dev)
		logger.info(`opened NES controller ${id}`)
		this.#handlers.onAdd({ id, side: '?', name: `NES Controller · ${short}` })
		hid.on('data', (buf: Buffer) => this.#onData(dev, buf))
		hid.on('error', (e: any) => {
			logger.warn(`hid error ${id}: ${String(e)}`)
			this.#close(key)
		})
	}

	#close(key: string): void {
		const d = this.#devs.get(key)
		if (!d) return
		try {
			d.hid.close()
		} catch {
			/* ignore */
		}
		this.#devs.delete(key)
		this.#handlers.onRemove(d.id)
	}

	#onData(dev: OpenDev, buf: Buffer): void {
		if (buf[0] !== 0x3f || buf.length < 4) return
		const b1 = buf[1],
			b2 = buf[2],
			hat = buf[3]
		const next: Record<string, boolean> = {
			A: !!(b1 & 0x02),
			B: !!(b1 & 0x01),
			L: !!(b1 & 0x10),
			R: !!(b1 & 0x20),
			Select: !!(b2 & 0x01),
			Start: !!(b2 & 0x02),
			Up: hat === 0 || hat === 1 || hat === 7,
			Right: hat === 1 || hat === 2 || hat === 3,
			Down: hat === 3 || hat === 4 || hat === 5,
			Left: hat === 5 || hat === 6 || hat === 7,
		}
		for (const k of Object.keys(next)) {
			if (next[k] !== (dev.state[k] || false)) {
				dev.state[k] = next[k]
				this.#handlers.onButton(dev.id, k, next[k])
			}
		}
	}
}
