import AVFoundation
import Combine
import Foundation

/// Records spoken prompts as AAC/m4a for the server's local Whisper transcription.
///
/// AVAudioRecorder finalizes the m4a container asynchronously, so `stop()` waits for
/// the delegate callback before handing the file over — reading it right after
/// `recorder.stop()` yields a truncated file and a garbled transcription.
@MainActor
final class VoiceRecorder: NSObject, ObservableObject {
    @Published private(set) var isRecording = false
    @Published private(set) var duration: TimeInterval = 0
    /// 0…1, for a live level meter.
    @Published private(set) var level: Double = 0

    private var recorder: AVAudioRecorder?
    private var fileURL: URL?
    private var timer: Timer?
    private var finished: CheckedContinuation<Void, Never>?

    /// Below this the file holds no usable speech; the server would answer with silence.
    private let minimumDuration: TimeInterval = 0.4

    func start() async throws {
        let session = AVAudioSession.sharedInstance()
        let granted = await withCheckedContinuation { continuation in
            session.requestRecordPermission { continuation.resume(returning: $0) }
        }
        guard granted else { throw VoiceError.permissionDenied }

        do {
            // .playAndRecord + .defaultToSpeaker keeps the mic working while other audio
            // plays and survives a Bluetooth headset connecting mid-session.
            try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            throw VoiceError.sessionUnavailable
        }

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("agent-bridge-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 32_000,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]

        let recorder: AVAudioRecorder
        do {
            recorder = try AVAudioRecorder(url: url, settings: settings)
        } catch {
            throw VoiceError.recorderUnavailable
        }
        recorder.delegate = self
        recorder.isMeteringEnabled = true
        guard recorder.prepareToRecord(), recorder.record() else {
            throw VoiceError.recorderUnavailable
        }

        self.recorder = recorder
        fileURL = url
        duration = 0
        level = 0
        isRecording = true
        startMetering()
    }

    /// Stops and returns the finished file, or nil if nothing usable was captured.
    func stop() async -> URL? {
        guard let recorder else { return nil }
        stopMetering()
        let captured = recorder.currentTime

        if recorder.isRecording {
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                finished = continuation
                recorder.stop()
                // The delegate normally fires immediately; never hang the UI on it.
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
                    self?.resumeFinished()
                }
            }
        }

        self.recorder = nil
        isRecording = false
        level = 0
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        let url = fileURL
        fileURL = nil
        guard let url, captured >= minimumDuration else {
            if let url { try? FileManager.default.removeItem(at: url) }
            return nil
        }
        return url
    }

    func cancel() async {
        if let url = await stop() { try? FileManager.default.removeItem(at: url) }
    }

    private func startMetering() {
        let timer = Timer(timeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    private func tick() {
        guard let recorder, recorder.isRecording else { return }
        recorder.updateMeters()
        duration = recorder.currentTime
        // -50 dB (near silence) … 0 dB (loudest) mapped to 0…1.
        let db = Double(recorder.averagePower(forChannel: 0))
        level = max(0, min(1, (db + 50) / 50))
    }

    private func stopMetering() {
        timer?.invalidate()
        timer = nil
    }

    private func resumeFinished() {
        finished?.resume()
        finished = nil
    }
}

extension VoiceRecorder: AVAudioRecorderDelegate {
    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        Task { @MainActor in self.resumeFinished() }
    }

    nonisolated func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        Task { @MainActor in self.resumeFinished() }
    }
}

enum VoiceError: LocalizedError {
    case permissionDenied
    case sessionUnavailable
    case recorderUnavailable

    var errorDescription: String? {
        switch self {
        case .permissionDenied:
            return "Permesso del microfono negato: attivalo in Impostazioni → Agent Bridge."
        case .sessionUnavailable:
            return "Microfono occupato da un'altra app. Chiudila e riprova."
        case .recorderUnavailable:
            return "Non riesco ad avviare la registrazione."
        }
    }
}
