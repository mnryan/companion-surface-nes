# companion-surface-nes

**A free plugin from [Studio Upgrade](https://studioupgrade.com), designed by Ryan Grams.**

Use Nintendo's **NES-style Switch Online controllers** as **local surfaces** in [Bitfocus Companion](https://bitfocus.io/companion). Each controller (Left and Right) shows up as its own surface — just like a Stream Deck — identified by its Bluetooth address, with its own enable/disable toggle.

> **Platform:** macOS (Apple Silicon & Intel) today. **Windows and Linux are coming but not ready yet.**

## What it does

- Pairs the NES Switch controllers over Bluetooth and exposes each as a **local Companion surface** (not a network/Satellite surface).
- Maps every button onto a 5×3 grid that lines up with a standard 15-key Stream Deck, so you can pair a controller with a Stream Deck (or the built-in Emulator) and *see* what each button does.
- Reads input reliably via a small native helper (Apple's GameController framework + a raw-HID path for the Select/Start buttons), so there's no input lag and no fighting macOS for the device.

## Requirements

- macOS (Apple Silicon or Intel)
- Bitfocus Companion **4.3+**
- One or two Nintendo **NES Controllers for Nintendo Switch Online**, paired to the Mac over Bluetooth

## Install

1. Download `nes-controller-<version>.tgz` from the [Releases](../../releases) page.
2. In Companion: **Settings → Modules → Import module package**, choose the `.tgz`.
3. Enable **NES Switch Controllers** under **Modules → Surfaces**.
4. Pair the controllers in **System Settings → Bluetooth**, then wake them — each appears under **Surfaces → Local Surfaces**.

**First run:** macOS may ask to grant **Companion** *Input Monitoring* (System Settings → Privacy & Security → Input Monitoring). This is needed for the Select/Start buttons. If the helper binary is blocked by Gatekeeper, allow it under Privacy & Security.

## Button map

```
 col:  0          1        2        3        4
row0  (page up)   Up       SL       SR       —
row1  (page #)    Left     Right    B        A
row2  (page dn)   Down     Select   Start    —
```

`SL`/`SR` are the shoulder rail buttons (Companion sees them as `L`/`R`). Column 0 is intentionally left free so a paired Stream Deck keeps its default page-navigation buttons. See [`companion/HELP.md`](companion/HELP.md) for the full guide, including the included **label template** (`template/`) and how to run a controller + Stream Deck/Emulator together in a **surface group**.

## Why this exists + tips

I have more Stream Decks than I can count and I love them — but I'd been playing with wireless options, and I had a pile of Bluetooth Switch controllers sitting around. The NES pads are my favorite, so: why not drive Companion with one? The only catch is a controller has no screen — so I park a spare **15-key Stream Deck (or the Emulator) next to it as a live legend**. That's exactly why the layout maps to a 15-key grid and why the button graphics exist: glance at the Deck, see what every NES button does.

A few ways I use it — steal freely:

- **Shoulders as pages.** Map **L / R** to page up / page down. The shoulders become a *mode selector* — flip pages to switch modes, then use the face buttons + D-pad to run whatever mode you're on.
- **Hold-to-shift (modifier buttons).** Set **R** to flip a custom variable *hot* on press and clear it on release. Then on, say, **A**, use a conditional (if/then) action: when the R variable is hot, A does one thing; when it isn't, A does another. Instant "shift key" — double your buttons.

Got a clever use? **[Share it in Discussions »](https://github.com/mnryan/companion-surface-nes/discussions)** — I'm genuinely curious how people put this to work.

## Build from source (macOS + Swift)

```sh
# 1. native helper (universal arm64 + x86_64)
swiftc -O -target arm64-apple-macos13  helper-src/nes-helper.swift -o /tmp/h-arm64 -framework GameController
swiftc -O -target x86_64-apple-macos13 helper-src/nes-helper.swift -o /tmp/h-x64   -framework GameController
lipo -create -output helpers/nes-helper-darwin-arm64 /tmp/h-arm64 /tmp/h-x64
cp helpers/nes-helper-darwin-arm64 helpers/nes-helper-darwin-x64
codesign --force --sign - helpers/nes-helper-darwin-*

# 2. module + package
npm install
npm run package      # -> nes-controller-<version>.tgz
```

For development, point Companion's **Developer modules path** at the parent folder and run `npm run build`.

## About Studio Upgrade

[Studio Upgrade](https://studioupgrade.com) designs and builds **custom, self-operated automated studios** — the kind one person can run without breaking a sweat. Building **custom Bitfocus Companion modules** is part of that work.

Need a module built, a commissioned project, or just have questions about your studio setup? Consulting's available too. 📧 **ryan@studioupgrade.com**

## Support

This plugin is free. If it saved you time on a show, you can [**sponsor it / buy me a coffee ☕**](https://github.com/sponsors/mnryan). Totally optional — bug reports, ideas, and shares help just as much.

## License

[MIT](LICENSE) — © Ryan Grams / Studio Upgrade
