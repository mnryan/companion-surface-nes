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

	readonly #onButton = (id: string, button: string, pressed: boolean): void => {
		if (id !== this.#info.id) return
		const controlId = BUTTON_TO_CONTROL[button]
		if (!controlId) return
		if (pressed) this.#context.keyDownById(controlId)
		else this.#context.keyUpById(controlId)
	}

	readonly #onGone = (id: string): void => {
		if (id !== this.#info.id) return
		this.#context.disconnect(new Error('Controller disconnected'))
	}

	constructor(surfaceId: string, info: NesInfo, context: SurfaceContext, bus: EventEmitter) {
		this.#surfaceId = surfaceId
		this.#info = info
		this.#context = context
		this.#bus = bus
		this.#bus.on('button', this.#onButton)
		this.#bus.on('gone', this.#onGone)
	}

	get surfaceId(): string {
		return this.#surfaceId
	}
	get productName(): string {
		return this.#info.name
	}

	async init(): Promise<void> {}
	async close(): Promise<void> {
		this.#bus.off('button', this.#onButton)
		this.#bus.off('gone', this.#onGone)
	}
	async ready(): Promise<void> {}
	async setBrightness(_percent: number): Promise<void> {}
	async blank(): Promise<void> {}
	async draw(_signal: AbortSignal, _drawProps: SurfaceDrawProps): Promise<void> {}
	async showStatus(_signal: AbortSignal, _cardGenerator: CardGenerator): Promise<void> {}
}
