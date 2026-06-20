import Foundation

public final class NativeLogStore {
    public static let shared = NativeLogStore()

    private static let maxLines = 500
    private static let logFilename = "game-shelf-native.log"
    private static let gracefulSuffixes = ["native.app_backgrounded", "native.app_terminating"]

    private let queue = DispatchQueue(label: "com.gameshelf.nativelogstore", qos: .utility)
    private let logFileURL: URL

    private init() {
        let dir = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first!
        logFileURL = dir.appendingPathComponent(NativeLogStore.logFilename)
    }

    public func write(_ message: String) {
        let line = "[\(isoTimestamp())] \(message)\n"
        queue.async { [weak self] in
            guard let self = self, let data = line.data(using: .utf8) else { return }
            if FileManager.default.fileExists(atPath: self.logFileURL.path) {
                if let handle = try? FileHandle(forWritingTo: self.logFileURL) {
                    handle.seekToEndOfFile()
                    handle.write(data)
                    try? handle.close()
                }
            } else {
                try? data.write(to: self.logFileURL, options: .atomic)
            }
            self.trimIfNeeded()
        }
    }

    public func exportText() -> String {
        queue.sync {
            (try? String(contentsOf: logFileURL, encoding: .utf8)) ?? ""
        }
    }

    public func clear() {
        queue.sync {
            try? FileManager.default.removeItem(at: logFileURL)
        }
    }

    /// Returns true when the last log file entry does not end with a graceful close marker.
    /// Call this before writing the new session's app_launched entry.
    public func didPreviousSessionEndAbnormally() -> Bool {
        queue.sync {
            guard let content = try? String(contentsOf: logFileURL, encoding: .utf8) else {
                return false
            }
            let lastLine = content
                .components(separatedBy: "\n")
                .filter { !$0.isEmpty }
                .last ?? ""
            guard !lastLine.isEmpty else { return false }
            return !NativeLogStore.gracefulSuffixes.contains(where: { lastLine.hasSuffix($0) })
        }
    }

    private func trimIfNeeded() {
        guard let content = try? String(contentsOf: logFileURL, encoding: .utf8) else { return }
        let lines = content.components(separatedBy: "\n").filter { !$0.isEmpty }
        guard lines.count > NativeLogStore.maxLines else { return }
        let trimmed = lines.suffix(NativeLogStore.maxLines).joined(separator: "\n") + "\n"
        try? trimmed.write(to: logFileURL, atomically: true, encoding: .utf8)
    }

    private func isoTimestamp() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date())
    }
}
