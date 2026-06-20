// nes-helper.swift  —  macOS input helper for the Companion NES surface module.
//
// Reads Nintendo NES-style Switch controllers and prints newline-delimited JSON
// events to stdout. The Companion surface module (Node) spawns this binary and
// translates those events into LOCAL surface button presses.
//
// Input strategy (proven on the bench):
//   • GameController framework  -> A, B, L, R, D-pad   (reliable, low latency)
//   • raw IOHID 0x3F byte[2]    -> Select (bit0), Start (bit1)
//     (GameController delivers those two — the reserved Menu/Options buttons —
//      with a ~500ms idle lag, so we read them straight from HID instead.)
//
// Identity is the controller's Bluetooth address (from the HID serial),
// correlated to the GameController object by side (L/R) — robust for the usual
// one-Left + one-Right pair.
//
// Protocol (one JSON object per line, to stdout):
//   {"type":"add","id":"B8:78:26:1A:DF:D4","side":"L","name":"NES Controller (L)"}
//   {"type":"remove","id":"B8:78:26:1A:DF:D4"}
//   {"type":"button","id":"B8:78:26:1A:DF:D4","button":"A","pressed":true}
//   {"type":"ready"}                      (emitted once at startup)
//
// Buttons emitted: Up Down Left Right A B L R Select Start
//
// Build (arm64): swiftc -O nes-helper.swift -o nes-helper -framework GameController
// macOS only.

import Foundation
import GameController
import IOKit
import IOKit.hid

setvbuf(stdout, nil, _IONBF, 0)   // unbuffered: Node sees lines immediately

let NINTENDO_VENDOR_ID = 0x057E
let serialQueue = DispatchQueue(label: "nes.helper")   // serializes all state

// ---- JSON line emission -----------------------------------------------------

func jsonEscape(_ s: String) -> String {
    var out = ""
    for c in s.unicodeScalars {
        switch c {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        default: out.unicodeScalars.append(c)
        }
    }
    return out
}
func emit(_ fields: [(String, String)]) {
    // values are already-quoted-or-literal pairs
    let body = fields.map { "\"\($0.0)\":\($0.1)" }.joined(separator: ",")
    print("{\(body)}")
}
func q(_ s: String) -> String { "\"\(jsonEscape(s))\"" }

func emitAdd(id: String, side: String, name: String) {
    emit([("type", q("add")), ("id", q(id)), ("side", q(side)), ("name", q(name))])
}
func emitRemove(id: String) { emit([("type", q("remove")), ("id", q(id))]) }
func emitButton(id: String, button: String, pressed: Bool) {
    emit([("type", q("button")), ("id", q(id)), ("button", q(button)), ("pressed", pressed ? "true" : "false")])
}

// ---- Per-controller record (keyed by side "L"/"R") --------------------------

final class Record {
    let side: String
    var bdaddr: String?       // from HID serial
    var name: String          // "NES Controller (L)"
    var gcBound = false
    var added = false
    // last raw center-button states (debounce edges)
    var lastSelect = false
    var lastStart = false
    init(side: String, name: String) { self.side = side; self.name = name }
}
var records: [String: Record] = [:]            // side -> Record
var gcSide: [ObjectIdentifier: String] = [:]   // GCController -> side

func sideFrom(productName: String) -> String? {
    if productName.contains("(L)") { return "L" }
    if productName.contains("(R)") { return "R" }
    return nil
}
func record(forSide side: String, name: String) -> Record {
    if let r = records[side] { return r }
    let r = Record(side: side, name: name); records[side] = r; return r
}

// Emit "add" only once both halves (GC + HID-derived BD address) are known.
func tryEmitAdd(_ r: Record) {
    guard !r.added, r.gcBound, let id = r.bdaddr else { return }
    r.added = true
    emitAdd(id: id, side: r.side, name: r.name)
}
func emitRemoveIfAdded(_ r: Record) {
    if r.added, let id = r.bdaddr { emitRemove(id: id) }
    r.added = false
    r.gcBound = false   // require a fresh gcAttach before re-adding
}

// =====================================================================
// GameController: A, B, L, R, D-pad
// =====================================================================

let GC_TO_BUTTON: [String: String] = [
    "Button A": "A", "Button B": "B",
    "Left Shoulder": "L", "Right Shoulder": "R",
]
let dpadDirs: Set<String> = ["Up", "Down", "Left", "Right"]

func gcAttach(_ controller: GCController) {
    let name = controller.vendorName ?? "NES Controller"
    guard let side = sideFrom(productName: name) else { return }   // NES only
    let r = record(forSide: side, name: name)
    r.gcBound = true
    gcSide[ObjectIdentifier(controller)] = side

    let profile = controller.physicalInputProfile
    var idMap: [ObjectIdentifier: String] = [:]
    for (gcName, input) in profile.buttons {
        if let logical = GC_TO_BUTTON[gcName] { idMap[ObjectIdentifier(input)] = logical }
    }

    profile.valueDidChangeHandler = { _, element in
        serialQueue.async {
            guard r.added, let id = r.bdaddr else { return }
            if let d = element as? GCControllerDirectionPad {
                emitButton(id: id, button: "Up", pressed: d.up.isPressed)
                emitButton(id: id, button: "Down", pressed: d.down.isPressed)
                emitButton(id: id, button: "Left", pressed: d.left.isPressed)
                emitButton(id: id, button: "Right", pressed: d.right.isPressed)
            } else if let b = element as? GCControllerButtonInput,
                      let logical = idMap[ObjectIdentifier(b)] {
                emitButton(id: id, button: logical, pressed: b.isPressed)
            }
        }
    }
    serialQueue.async { tryEmitAdd(r) }
}

func gcDetach(_ controller: GCController) {
    let oid = ObjectIdentifier(controller)
    guard let side = gcSide.removeValue(forKey: oid), let r = records[side] else { return }
    serialQueue.async {
        r.gcBound = false
        emitRemoveIfAdded(r)
    }
}

// =====================================================================
// Raw IOHID: Select (0x3F byte[2] bit0) + Start (bit1) + BD address
// =====================================================================

let CENTER_REPORT_ID: UInt32 = 0x3F
let CENTER_BYTE = 2
let SELECT_MASK: UInt8 = 0x01
let START_MASK: UInt8  = 0x02

final class RawDev {
    let side: String
    let bdaddr: String
    let buffer: UnsafeMutablePointer<UInt8>
    let bufLen: Int
    init(side: String, bdaddr: String, bufLen: Int) {
        self.side = side; self.bdaddr = bdaddr; self.bufLen = bufLen
        buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufLen)
        buffer.initialize(repeating: 0, count: bufLen)
    }
}
var rawDevs: [UnsafeMutableRawPointer: RawDev] = [:]
var rawManager: IOHIDManager?

let rawReportCallback: IOHIDReportCallback = { context, _, _, _, reportID, reportPtr, reportLength in
    guard reportID == CENTER_REPORT_ID, let context = context, let dev = rawDevs[context] else { return }
    guard Int(reportLength) > CENTER_BYTE else { return }
    let b = reportPtr[CENTER_BYTE]
    let sel = (b & SELECT_MASK) != 0
    let sta = (b & START_MASK) != 0
    serialQueue.async {
        guard let r = records[dev.side], r.added, let id = r.bdaddr else { return }
        if sel != r.lastSelect { r.lastSelect = sel; emitButton(id: id, button: "Select", pressed: sel) }
        if sta != r.lastStart { r.lastStart = sta; emitButton(id: id, button: "Start", pressed: sta) }
    }
}

func rawMatched(_ device: IOHIDDevice) {
    let product = (IOHIDDeviceGetProperty(device, kIOHIDProductKey as CFString) as? String) ?? ""
    guard let side = sideFrom(productName: product) else { return }
    let serial = (IOHIDDeviceGetProperty(device, kIOHIDSerialNumberKey as CFString) as? String) ?? side
    let maxIn = (IOHIDDeviceGetProperty(device, kIOHIDMaxInputReportSizeKey as CFString) as? NSNumber)?.intValue ?? 64
    let bufLen = max(maxIn, 64)
    let dev = RawDev(side: side, bdaddr: serial, bufLen: bufLen)
    let ctx = Unmanaged.passUnretained(device).toOpaque()
    rawDevs[ctx] = dev
    IOHIDDeviceRegisterInputReportCallback(device, dev.buffer, bufLen, rawReportCallback, ctx)
    serialQueue.async {
        let r = record(forSide: side, name: product)
        r.bdaddr = serial
        r.name = product
        tryEmitAdd(r)
    }
}

func rawRemoved(_ device: IOHIDDevice) {
    let ctx = Unmanaged.passUnretained(device).toOpaque()
    guard let dev = rawDevs.removeValue(forKey: ctx) else { return }
    serialQueue.async {
        if let r = records[dev.side] { emitRemoveIfAdded(r); r.bdaddr = nil }  // emit BEFORE clearing id
    }
}

func startRaw() {
    let mgr = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
    IOHIDManagerSetDeviceMatching(mgr, [kIOHIDVendorIDKey: NINTENDO_VENDOR_ID] as CFDictionary)
    IOHIDManagerRegisterDeviceMatchingCallback(mgr, { _, _, _, device in rawMatched(device) }, nil)
    IOHIDManagerRegisterDeviceRemovalCallback(mgr, { _, _, _, device in rawRemoved(device) }, nil)
    IOHIDManagerScheduleWithRunLoop(mgr, CFRunLoopGetMain(), CFRunLoopMode.defaultMode.rawValue)
    _ = IOHIDManagerOpen(mgr, IOOptionBits(kIOHIDOptionsTypeNone))
    rawManager = mgr
}

// =====================================================================
// Boot
// =====================================================================

for c in GCController.controllers() { gcAttach(c) }
NotificationCenter.default.addObserver(forName: .GCControllerDidConnect, object: nil, queue: .main) { n in
    if let c = n.object as? GCController { gcAttach(c) }
}
NotificationCenter.default.addObserver(forName: .GCControllerDidDisconnect, object: nil, queue: .main) { n in
    if let c = n.object as? GCController { gcDetach(c) }
}
GCController.startWirelessControllerDiscovery(completionHandler: {})
startRaw()

emit([("type", q("ready"))])

// Liveness reconcile: GCController didDisconnect / IOHID removal don't always
// fire on Bluetooth-off, but GCController.controllers() membership and the raw
// device list DO drop reliably. Every 2s, if an added controller is no longer
// seen by EITHER subsystem, emit a remove so the surface goes offline.
let reconcileTimer = DispatchSource.makeTimerSource(queue: DispatchQueue.main)
reconcileTimer.schedule(deadline: .now() + 2, repeating: 2.0)
reconcileTimer.setEventHandler {
    let gcSides = Set(GCController.controllers().compactMap { sideFrom(productName: $0.vendorName ?? "") })
    serialQueue.async {
        let rawSides = Set(rawDevs.values.map { $0.side })
        for (side, r) in records where r.added {
            if !gcSides.contains(side) && !rawSides.contains(side) {
                emitRemoveIfAdded(r)
                r.bdaddr = nil
            }
        }
    }
}
reconcileTimer.resume()

// Exit cleanly if stdin closes (parent/module went away).
let stdinSrc = DispatchSource.makeReadSource(fileDescriptor: FileHandle.standardInput.fileDescriptor, queue: serialQueue)
stdinSrc.setEventHandler {
    var buf = [UInt8](repeating: 0, count: 256)
    let n = read(FileHandle.standardInput.fileDescriptor, &buf, buf.count)
    if n <= 0 { Foundation.exit(0) }   // EOF: parent closed the pipe
}
stdinSrc.resume()

CFRunLoopRun()
