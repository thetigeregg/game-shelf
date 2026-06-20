import Capacitor

public class MainViewController: CAPBridgeViewController {
    override public func capacitorDidLoad() {
        bridge?.registerPluginInstance(NativeLoggerPlugin())
    }
}
