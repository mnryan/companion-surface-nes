import type {
	SurfaceContext,
	SurfaceInstance,
	SurfaceDrawProps,
	CardGenerator,
} from '@companion-surface/base'
import type EventEmitter from 'node:events'
import { BUTTON_TO_CONTROL } from './buttons.js'
import type { NesInfo } from './main.js'

// One LOCAL Companion surface per physical NES controller. Has no displays, so
// draw/blank/brightness are no-ops; it only translates button events into key
// presses via the injected context.
export class NesSurface implements SurfaceInstance {
	readonly #surfaceId: string
	readonly #info: NesInfo
	readonly #context: SurfaceContext
	readonly #bus: EventEmitter
	readonly #setLed: (id: string, player: number) => void
	readonly #getBattery: (id: string) => number | undefined

	readonly #onButton = (id: string, button: string, pressed: boolean): void => {
		if (id !== this.#info.id) return
		const controlId = BUTTON_TO_CONTROL[button]
		if (!controlId) return
		if (pressed) this.#context.keyDownById(controlId)
		else this.#context.keyUpById(controlId)
	}

	readonly #onBattery = (id: string, percent: number): void => {
		if (id !== this.#info.id) return
		this.#context.sendVariableValue('battery', percent)
	}

	readonly #onGone = (id: string): void => {
		if (id !== this.#info.id) return
		this.#context.disconnect(new Error('Controller disconnected'))
	}

	constructor(
		surfaceId: string,
		info: NesInfo,
		context: SurfaceContext,
		bus: EventEmitter,
		setLed: (id: string, player: number) => void,
		getBattery: (id: string) => number | undefined,
	) {
		this.#surfaceId = surfaceId
		this.#info = info
		this.#context = context
		this.#bus = bus
		this.#setLed = setLed
		this.#getBattery = getBattery
		this.#bus.on('button', this.#onButton)
		this.#bus.on('gone', this.#onGone)
		this.#bus.on('battery', this.#onBattery)
	}

	get surfaceId(): string {
		return this.#surfaceId
	}
	get productName(): string {
		return this.#info.name
	}

	async init(): Promise<void> {
		// Push the last-known battery value (if we already have one) so the variable
		// is populated immediately on connect, not only after the next poll.
		const last = this.#getBattery(this.#info.id)
		if (last !== undefined) this.#context.sendVariableValue('battery', last)
	}
	async updateConfig(config: Record<string, any>): Promise<void> {
		// Apply the "Controller number (LED)" setting (also called on connect with
		// the saved value, so the controller lights up to its assigned player).
		const player = parseInt(String(config?.player ?? '0'), 10) || 0
		this.#setLed(this.#info.id, player)
	}
	async close(): Promise<void> {
		this.#bus.off('button', this.#onButton)
		this.#bus.off('gone', this.#onGone)
		this.#bus.off('battery', this.#onBattery)
	}
	async ready(): Promise<void> {}
	async setBrightness(_percent: number): Promise<void> {}
	async blank(): Promise<void> {}
	async draw(_signal: AbortSignal, _drawProps: SurfaceDrawProps): Promise<void> {}
	async showStatus(_signal: AbortSignal, _cardGenerator: CardGenerator): Promise<void> {}
}
