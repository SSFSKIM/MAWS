// maws-voice-helper: push-to-talk dictation for MAWS over Apple's Speech framework.
//
// Protocol (E9 execution document, Design §1): newline-delimited JSON, commands on stdin, events on stdout,
// logs on stderr (never parsed). One capture at a time; recognition is on-device only.
//
// Concurrency: one serial queue (`state`) owns every piece of mutable state. Every command, every permission
// callback, every recognition callback, every timer and every stdout write runs on it, so a `cancel` and a
// permission answer cannot interleave and the "was this capture cancelled" check after each asynchronous step is
// exact. Stdin is read on a background thread; the main thread runs the run loop.

import AVFoundation
import Foundation
import Speech

// MARK: - JSON out (ordered, so the lines read the way the protocol table writes them)

indirect enum JSON {
    case string(String)
    case bool(Bool)
    case int(Int)
    case null
    case array([JSON])
    case object([(String, JSON)])

    var encoded: String {
        switch self {
        case .string(let s): return JSON.quote(s)
        case .bool(let b): return b ? "true" : "false"
        case .int(let i): return String(i)
        case .null: return "null"
        case .array(let items): return "[" + items.map(\.encoded).joined(separator: ",") + "]"
        case .object(let fields):
            return "{" + fields.map { JSON.quote($0.0) + ":" + $0.1.encoded }.joined(separator: ",") + "}"
        }
    }

    static func quote(_ s: String) -> String {
        var out = "\""
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case "\u{2028}": out += "\\u2028"
            case "\u{2029}": out += "\\u2029"
            default:
                if scalar.value < 0x20 {
                    out += String(format: "\\u%04x", scalar.value)
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        return out + "\""
    }
}

func optionalString(_ s: String?) -> JSON { s.map(JSON.string) ?? .null }

// MARK: - Output

let state = DispatchQueue(label: "dev.maws.voice-helper.state")

/// Writes one event line to stdout. Called on `state` only. A closed stdout means the parent is gone: exit.
func emit(_ fields: [(String, JSON)]) {
    dispatchPrecondition(condition: .onQueue(state))
    let bytes = Array((JSON.object(fields).encoded + "\n").utf8)
    var offset = 0
    while offset < bytes.count {
        let written = bytes[offset...].withUnsafeBytes { write(STDOUT_FILENO, $0.baseAddress, $0.count) }
        if written < 0 {
            if errno == EINTR { continue }
            exit(0)
        }
        offset += written
    }
}

func log(_ message: String) {
    FileHandle.standardError.write(Data("[voice-helper] \(message)\n".utf8))
}

func emitError(id: String?, code: String, message: String) {
    log("error id=\(id ?? "null") code=\(code) \(message)")
    emit([("type", .string("error")), ("id", optionalString(id)), ("code", .string(code)), ("message", .string(message))])
}

// MARK: - Locales and permission states

/// Apple's identifiers as BCP-47 with hyphens (`en-US`); `Locale.current` reports `ko_KR`.
func hyphenated(_ identifier: String) -> String { identifier.replacingOccurrences(of: "_", with: "-") }

/// The system locale as language-region (`ko-KR`), the shape `supportedLocales()` uses, without the
/// calendar, numbering or region-override extensions `Locale.current` may carry.
func systemLocaleIdentifier() -> String {
    let current = Locale.current
    guard let language = current.language.languageCode?.identifier else { return hyphenated(current.identifier) }
    if let region = current.region?.identifier { return "\(language)-\(region)" }
    return language
}

func supportedLocaleIdentifiers() -> [String] {
    SFSpeechRecognizer.supportedLocales().map { hyphenated($0.identifier) }.sorted()
}

/// The supported identifier matching `identifier` (case-insensitive, `_` or `-`), or nil when Apple does not list it.
func supportedMatch(_ identifier: String) -> String? {
    let wanted = hyphenated(identifier).lowercased()
    return supportedLocaleIdentifiers().first { $0.lowercased() == wanted }
}

func name(_ status: SFSpeechRecognizerAuthorizationStatus) -> String {
    switch status {
    case .notDetermined: return "notDetermined"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .authorized: return "authorized"
    @unknown default: return "denied"
    }
}

func name(_ status: AVAuthorizationStatus) -> String {
    switch status {
    case .notDetermined: return "notDetermined"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .authorized: return "authorized"
    @unknown default: return "denied"
    }
}

/// Non-prompting reads of both TCC services.
func permissionFields() -> [(String, JSON)] {
    [
        ("microphone", .string(name(AVCaptureDevice.authorizationStatus(for: .audio)))),
        ("speech", .string(name(SFSpeechRecognizer.authorizationStatus()))),
    ]
}

// MARK: - The capture

final class Capture {
    enum Phase { case starting, listening, stopping }

    let id: String
    let locale: String
    var phase: Phase = .starting
    /// Set by `cancel` (and by `quit`); every asynchronous continuation checks it before acting.
    var ended = false
    /// Set when the helper itself called `task.cancel()`; the task's cancellation error is then not a failure.
    var taskCancelled = false
    var lastPartial = ""
    var recognizer: SFSpeechRecognizer?
    var request: SFSpeechAudioBufferRecognitionRequest?
    var task: SFSpeechRecognitionTask?
    var engine: AVAudioEngine?

    init(id: String, locale: String) {
        self.id = id
        self.locale = locale
    }
}

/// The capture in progress (reserved at `start`, cleared when it ends). Owned by `state`.
var active: Capture?
/// The id of the capture that ended last, so a `cancel` racing the helper's own final is answered `cancelled`.
var lastEndedId: String?

let finalTimeoutSeconds = 3.0
let tapBufferFrames: AVAudioFrameCount = 1024

/// Whether a continuation for `capture` may still act: it is the active capture and was not ended meanwhile.
func isLive(_ capture: Capture) -> Bool { !capture.ended && active === capture }

/// Releases the microphone and the recognition task, and frees the slot for the next capture.
func end(_ capture: Capture, cancelTask: Bool) {
    capture.ended = true
    if let engine = capture.engine {
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
    }
    capture.request?.endAudio()
    if cancelTask, let task = capture.task {
        capture.taskCancelled = true
        task.cancel()
    }
    capture.engine = nil
    capture.request = nil
    capture.task = nil
    capture.recognizer = nil
    if active === capture { active = nil }
    lastEndedId = capture.id
}

func fail(_ capture: Capture, code: String, message: String) {
    end(capture, cancelTask: true)
    emitError(id: capture.id, code: code, message: message)
}

func emitFinal(_ capture: Capture, text: String, timedOut: Bool) {
    end(capture, cancelTask: timedOut)
    log("final id=\(capture.id) timedOut=\(timedOut)")
    emit([("type", .string("final")), ("id", .string(capture.id)), ("text", .string(text)), ("timedOut", .bool(timedOut))])
}

// MARK: - Commands

func probe(locale requested: String?) {
    let resolved = requested.map { supportedMatch($0) ?? $0 } ?? systemLocaleIdentifier()
    var onDevice = false
    if supportedMatch(resolved) != nil, let recognizer = SFSpeechRecognizer(locale: Locale(identifier: resolved)) {
        onDevice = recognizer.supportsOnDeviceRecognition
    }
    emit([
        ("type", .string("probe")),
        ("locales", .array(supportedLocaleIdentifiers().map(JSON.string))),
        ("systemLocale", .string(systemLocaleIdentifier())),
        ("locale", .string(resolved)),
        ("supportsOnDevice", .bool(onDevice)),
        ("permission", .object(permissionFields())),
    ])
}

func start(id: String, locale requested: String?) {
    if active != nil {
        emitError(id: id, code: "busy", message: "Another capture is running.")
        return
    }
    let wanted = requested ?? systemLocaleIdentifier()
    let capture = Capture(id: id, locale: supportedMatch(wanted) ?? wanted)
    active = capture
    log("starting id=\(id) locale=\(capture.locale)")

    guard supportedMatch(wanted) != nil else {
        fail(capture, code: "locale_unsupported", message: "Speech recognition does not support \(wanted).")
        return
    }
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: capture.locale)), recognizer.isAvailable else {
        fail(capture, code: "recognizer_unavailable", message: "The speech recognizer for \(capture.locale) is unavailable.")
        return
    }
    guard recognizer.supportsOnDeviceRecognition else {
        fail(capture, code: "on_device_unavailable", message: "\(capture.locale) has no on-device speech model on this Mac.")
        return
    }
    capture.recognizer = recognizer
    requestMicrophone(capture)
}

/// Prompts only while the state is `notDetermined`; otherwise continues at once with the current state.
func requestMicrophone(_ capture: Capture) {
    guard isLive(capture) else { return }
    if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
        log("asking microphone id=\(capture.id)")
        AVCaptureDevice.requestAccess(for: .audio) { _ in state.async { afterMicrophone(capture) } }
    } else {
        afterMicrophone(capture)
    }
}

func afterMicrophone(_ capture: Capture) {
    guard isLive(capture) else { return }
    let status = AVCaptureDevice.authorizationStatus(for: .audio)
    guard status == .authorized else {
        emitPermission(capture)
        fail(capture, code: "microphone_denied", message: "Microphone access is \(name(status)) for this app.")
        return
    }
    if SFSpeechRecognizer.authorizationStatus() == .notDetermined {
        log("asking speech id=\(capture.id)")
        SFSpeechRecognizer.requestAuthorization { _ in state.async { afterSpeech(capture) } }
    } else {
        afterSpeech(capture)
    }
}

func afterSpeech(_ capture: Capture) {
    guard isLive(capture) else { return }
    emitPermission(capture)
    let status = SFSpeechRecognizer.authorizationStatus()
    guard status == .authorized else {
        fail(capture, code: "speech_denied", message: "Speech recognition is \(name(status)) for this app.")
        return
    }
    startAudio(capture)
}

func emitPermission(_ capture: Capture) {
    emit([("type", .string("permission")), ("id", .string(capture.id))] + permissionFields())
}

func startAudio(_ capture: Capture) {
    guard isLive(capture), let recognizer = capture.recognizer else { return }

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    request.addsPunctuation = true
    request.requiresOnDeviceRecognition = true

    let engine = AVAudioEngine()
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
        fail(capture, code: "audio_failed", message: "No audio input device is available.")
        return
    }
    input.installTap(onBus: 0, bufferSize: tapBufferFrames, format: format) { buffer, _ in request.append(buffer) }
    capture.request = request
    capture.engine = engine

    engine.prepare()
    do {
        try engine.start()
    } catch {
        fail(capture, code: "audio_failed", message: error.localizedDescription)
        return
    }

    capture.task = recognizer.recognitionTask(with: request) { result, error in
        state.async { recognized(capture, result: result, error: error) }
    }
    capture.phase = .listening
    log("started id=\(capture.id) locale=\(capture.locale)")
    emit([("type", .string("started")), ("id", .string(capture.id)), ("locale", .string(capture.locale))])
}

// Apple's task errors that are not recognition failures (Design §1). The domains and codes are undocumented
// constants of the Speech framework's private services, as they appear in the errors it delivers.
let assistantErrorDomain = "kAFAssistantErrorDomain"
let localSpeechErrorDomain = "kLSRErrorDomain"
let noSpeechDetectedCode = 1110
let taskCancelledCodes: Set<Int> = [216, 301]

/// What a recognition task's error means for its capture when no final result came with it.
enum TaskErrorOutcome: Equatable {
    /// "No speech detected" (what a hold with nothing said produces after `endAudio()`): settle the last partial.
    case noSpeech
    /// The cancellation error of a task the helper itself cancelled: the capture was already answered.
    case cancelledByHelper
    /// Anything else, a cancellation the helper did not issue included: `recognition_failed`.
    case failure
}

/// Pure: reads only the error and whether the helper called `task.cancel()` on this capture's task.
func classify(_ error: Error, cancelledByHelper: Bool) -> TaskErrorOutcome {
    let error = error as NSError
    if error.domain == assistantErrorDomain && error.code == noSpeechDetectedCode { return .noSpeech }
    let isCancellation = (error.domain == assistantErrorDomain || error.domain == localSpeechErrorDomain)
        && taskCancelledCodes.contains(error.code)
    if isCancellation && cancelledByHelper { return .cancelledByHelper }
    return .failure
}

/// One recognition callback. Precedence: a final result answers the capture whatever else came with it; a
/// non-final result is a partial; then an error, if any, ends the capture by `classify`.
func recognized(_ capture: Capture, result: SFSpeechRecognitionResult?, error: Error?) {
    // An ended capture was already answered (`cancelled`, `final` or `error`). The helper's own `task.cancel()`
    // always ends the capture first, so the callbacks it causes stop here too.
    guard isLive(capture) else { return }
    if let result {
        let text = result.bestTranscription.formattedString
        if result.isFinal {
            emitFinal(capture, text: text, timedOut: false)
            return
        }
        capture.lastPartial = text
        emit([("type", .string("partial")), ("id", .string(capture.id)), ("text", .string(text))])
    }
    guard let error else { return }
    switch classify(error, cancelledByHelper: capture.taskCancelled) {
    case .noSpeech:
        // Nothing (more) was heard: what was heard is the answer, usually "".
        log("no speech id=\(capture.id)")
        emitFinal(capture, text: capture.lastPartial, timedOut: false)
    case .cancelledByHelper:
        return // not reached while live (`end` marks the capture ended before it cancels the task)
    case .failure:
        let ns = error as NSError
        log("task error id=\(capture.id) domain=\(ns.domain) code=\(ns.code)")
        fail(capture, code: "recognition_failed", message: error.localizedDescription)
    }
}

func stop(id: String) {
    guard let capture = active, capture.id == id else {
        emitError(id: id, code: "bad_request", message: "No active capture \(id).")
        return
    }
    switch capture.phase {
    case .stopping:
        return // the final is already on its way
    case .starting:
        // Nothing was heard: the audio never started. The pending permission step sees `ended` and stops.
        emitFinal(capture, text: "", timedOut: false)
    case .listening:
        capture.phase = .stopping
        if let engine = capture.engine {
            engine.stop()
            engine.inputNode.removeTap(onBus: 0)
        }
        capture.engine = nil
        capture.request?.endAudio()
        log("stopping id=\(id)")
        state.asyncAfter(deadline: .now() + finalTimeoutSeconds) {
            guard isLive(capture) else { return }
            emitFinal(capture, text: capture.lastPartial, timedOut: true)
        }
    }
}

func cancel(id: String) {
    if let capture = active, capture.id == id {
        end(capture, cancelTask: true)
        log("cancelled id=\(id)")
        emit([("type", .string("cancelled")), ("id", .string(id))])
    } else if lastEndedId == id {
        emit([("type", .string("cancelled")), ("id", .string(id))])
    } else {
        emitError(id: id, code: "bad_request", message: "No active capture \(id).")
    }
}

func quit() -> Never {
    if let capture = active { end(capture, cancelTask: true) }
    exit(0)
}

// MARK: - Dispatch

func handle(line: String) {
    guard
        let data = line.data(using: .utf8),
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let cmd = object["cmd"] as? String
    else {
        emitError(id: nil, code: "bad_request", message: "Unparseable command line.")
        return
    }
    let rawId = object["id"]
    let id = rawId as? String
    let rawLocale = object["locale"]
    let localeIsValid = rawLocale == nil || rawLocale is NSNull || rawLocale is String
    let locale = rawLocale as? String

    switch cmd {
    case "probe" where localeIsValid:
        probe(locale: locale)
    case "start" where localeIsValid:
        guard let id, !id.isEmpty else { return emitError(id: nil, code: "bad_request", message: "start needs an id.") }
        start(id: id, locale: locale)
    case "stop":
        guard let id else { return emitError(id: nil, code: "bad_request", message: "stop needs an id.") }
        stop(id: id)
    case "cancel":
        guard let id else { return emitError(id: nil, code: "bad_request", message: "cancel needs an id.") }
        cancel(id: id)
    case "quit":
        quit()
    default:
        emitError(id: id, code: "bad_request", message: "Unknown or malformed command \(cmd).")
    }
}

signal(SIGPIPE, SIG_IGN)

// The parent watch (Design §2): main's SIGTERM at `will-quit` is the first line, this is the second. It runs on its own
// global queue, so a helper wedged on `state` still exits when the app is gone. The pid is checked again after the
// watch is armed, so a parent that died in between is not missed (a watch on a gone pid never fires).
let parent = getppid()
if parent == 1 { exit(0) } // already orphaned
let parentWatch = DispatchSource.makeProcessSource(identifier: parent, eventMask: .exit, queue: .global())
parentWatch.setEventHandler { exit(0) }
parentWatch.resume()
if getppid() != parent { exit(0) }

// `ready` is queued before the reader starts, so it is always the first line.
state.async { emit([("type", .string("ready")), ("protocol", .int(1))]) }

Thread.detachNewThread {
    while let line = readLine(strippingNewline: true) {
        state.async { handle(line: line) }
    }
    state.async { quit() } // EOF: the parent is gone
}

RunLoop.main.run()
