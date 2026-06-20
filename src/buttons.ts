import type { SurfaceSchemaLayoutDefinition } from '@companion-surface/base'

// The 5x3 "15-key Stream Deck" grid. controlId = "row/col".
export const GRID = { rows: 3, columns: 5 }

// Logical NES button -> Companion control id. Matches the locked v1 layout:
//  row0: [dead0][Up][L][R][dead]
//  row1: [dead][Left][Right][B][A]
//  row2: [dead][Down][Select][Start][dead]   (Select left, Start right)
export const BUTTON_TO_CONTROL: Record<string, string> = {
	Up: '0/1',
	L: '0/2',
	R: '0/3',
	Left: '1/1',
	Right: '1/2',
	B: '1/3',
	A: '1/4',
	Down: '2/1',
	Select: '2/2',
	Start: '2/3',
}

// Full 5x3 grid of controls (no displays => empty default style preset).
export function createLayout(): SurfaceSchemaLayoutDefinition {
	const controls: Record<string, { row: number; column: number }> = {}
	for (let row = 0; row < GRID.rows; row++) {
		for (let col = 0; col < GRID.columns; col++) {
			controls[`${row}/${col}`] = { row, column: col }
		}
	}
	return { stylePresets: { default: {} }, controls }
}
