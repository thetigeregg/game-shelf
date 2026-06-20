import Capacitor
import Foundation
import UIKit

@objc(NativeLoggerPlugin)
public class NativeLoggerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeLoggerPlugin"
    public let jsName = "NativeLogger"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "log", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportLogs", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearLogs", returnType: CAPPluginReturnPromise),
    ]

    override public func load() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleMemoryWarning),
            name: UIApplication.didReceiveMemoryWarningNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleBackground),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleForeground),
            name: UIApplication.willEnterForegroundNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleTerminate),
            name: UIApplication.willTerminateNotification,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func handleMemoryWarning() {
        NativeLogStore.shared.write("[WARN] native.memory_warning")
    }

    @objc private func handleBackground() {
        NativeLogStore.shared.write("[INFO] native.app_backgrounded")
    }

    @objc private func handleForeground() {
        NativeLogStore.shared.write("[INFO] native.app_foregrounded")
    }

    @objc private func handleTerminate() {
        NativeLogStore.shared.write("[INFO] native.app_terminating")
    }

    @objc public func log(_ call: CAPPluginCall) {
        guard let level = call.getString("level"),
              let message = call.getString("message") else {
            call.reject("Missing required fields: level, message")
            return
        }
        let details = call.getString("details")
        let entry: String
        if let d = details, !d.isEmpty {
            entry = "[\(level.uppercased())] \(message) | \(d)"
        } else {
            entry = "[\(level.uppercased())] \(message)"
        }
        NativeLogStore.shared.write(entry)
        call.resolve()
    }

    @objc public func exportLogs(_ call: CAPPluginCall) {
        let content = NativeLogStore.shared.exportText()
        call.resolve(["content": content])
    }

    @objc public func clearLogs(_ call: CAPPluginCall) {
        NativeLogStore.shared.clear()
        call.resolve()
    }
}
