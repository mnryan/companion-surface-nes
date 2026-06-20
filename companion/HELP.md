# NES Switch Controllers — Companion surface

Use Nintendo's NES-style Switch Online controllers as **local Companion surfaces** on macOS. Each controller (Left and Right) appears as its own surface, identified by its Bluetooth address, and shows up under **Local Surfaces** — just like a Stream Deck — with its own enable/disable toggle.

## Button map (5 × 3, lines up with a 15-key Stream Deck)

```
 col:  0          1        2        3        4
row0  (page up)   Up       SL       SR       —
row1  (page #)    Left     Right    B        A
row2  (page dn)   Down     Select   Start    —
```

- **SL / SR** are the two shoulder (rail) buttons → Companion calls them **L / R**.
- **Select** is the left center button; **Start** is the right center button.
- Diagonals on the D-pad press two directions at once.

### Why column 0 is left empty
The NES surface intentionally maps **no buttons to the leftmost column (column 0)**. That column is where Companion puts its **default page-navigation buttons** (page up / page number / page down — the "scroller"). Leaving it free means that when you pair this controller with a Stream Deck (or an Emulator), the Stream Deck's first column still works as page navigation, and nothing on the controller fights it.

## Show the labels on a Stream Deck (or Emulator) — run them in tandem

Because the controller has no screen, the trick is to **group it with a display surface** (a real Stream Deck, a cheaper 15-key clone, or Companion's built-in Emulator). Grouped surfaces share the same page, so the display shows what each button does while you press the controller.

### 1. Import the label template
A ready-made page that labels all 15 keys (Up, A, B, Select, Start, …) is included with this module: **`NES-StreamDeck-Template.companionconfig`**.

1. In Companion, open **Import / Export**.
2. Choose **Import**, select the `.companionconfig` file.
3. Import it onto a spare **page** (it's a single 3×5 page named "NES Controller").

### 2. Create a surface group with the controller + a display
1. Go to **Surfaces**.
2. (No physical Stream Deck? Add an **Emulator** surface first — it's a virtual 15-key panel you open in the browser.)
3. Open the **settings** for your NES controller surface and assign it to a **Surface Group** (create a new one, e.g. "NES Left").
4. Assign your **Stream Deck / clone / Emulator** to the **same group**.
5. Set the group's **startup page** to the template page you imported.

Now both surfaces show and control the same page: the Stream Deck/Emulator **displays the labels** (Up, A, B, Select, Start…) and **pressing the controller** triggers the matching button. Press a button on the NES pad → its key lights up on the display so you always know what you're hitting.

> Tip: make one group per controller ("NES Left", "NES Right") so each pad can sit on its own page with its own display.

## Identity & disable
- Each controller is remembered by its **Bluetooth address**, so its page/group assignment sticks to that specific physical controller across reconnects.
- Put it to sleep or turn Bluetooth off and the surface goes **offline** automatically; wake it and it returns to where it was.

## Platform support
- **macOS:** supported now (Apple Silicon and Intel). Input is read by a small bundled native helper.
- **Windows & Linux:** **coming soon — not ready yet.** The surface module itself is cross-platform; those platforms just need their own helper binary, which is in progress.

---

## Made by
A free plugin from **[Studio Upgrade](https://studioupgrade.com)**, designed by **Ryan Grams**.

Studio Upgrade designs and builds **custom self-operated automated studios** — the kind one person can run solo — and builds **custom Bitfocus Companion modules** as part of that. Need a module built, a commissioned project, or just have questions about your studio setup? We do consulting too. 📧 **ryan@studioupgrade.com**

If it saves you time, [**sponsor it / buy me a coffee ☕**](https://github.com/sponsors/mnryan) — totally optional, always appreciated.
