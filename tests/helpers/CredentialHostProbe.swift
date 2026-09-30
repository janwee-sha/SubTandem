import Darwin
import Foundation

struct CredentialHostProbe {
    static func run(_ operation: CredentialOpenedOperation) throws -> Data {
        let expected = Data("SubTandem-credential-probe-20260930".utf8)
        let snapshot = try JSONSerialization.jsonObject(with: operation.envelope.snapshot) as! [String: Any]
        guard operation.value == expected,
              operation.envelope.context.purpose == "draft-test", operation.envelope.context.source == nil,
              snapshot["endpoint"] as? String == "https://credential-host-probe.invalid",
              let action = snapshot["model"] as? String,
              ["create", "recover", "replace", "remove"].contains(action),
              let dataIndex = CommandLine.arguments.firstIndex(of: "--data-directory"),
              CommandLine.arguments.indices.contains(dataIndex + 1)
        else { throw CredentialFailure.invalidMessage }
        return try runSample(action: action, dataDirectory: URL(fileURLWithPath: CommandLine.arguments[dataIndex + 1]), protection: CredentialProtection())
    }

    static func runSample(action: String, dataDirectory: URL, protection: CredentialProtection) throws -> Data {
        let expected = Data("SubTandem-credential-probe-20260930".utf8)
        guard ["create", "recover", "replace", "remove"].contains(action) else { throw CredentialFailure.invalidMessage }
        let directory = dataDirectory.appendingPathComponent("credential-host-probe", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let attributes = try FileManager.default.attributesOfItem(atPath: directory.path)
        guard attributes[.type] as? FileAttributeType == .typeDirectory else { throw CredentialFailure.unavailable }
        let path = directory.appendingPathComponent("protected-sample.json")
        if action == "remove" {
            if FileManager.default.fileExists(atPath: path.path) { try FileManager.default.removeItem(at: path) }
            try FileManager.default.removeItem(at: directory)
            return Data()
        }
        if action == "create" || action == "replace" {
            if action == "create" && FileManager.default.fileExists(atPath: path.path) { throw CredentialFailure.unavailable }
            let slot = try protection.makeKeySlot()
            let sealed = try protection.seal(expected, storeID: "probe-store", profileID: "probe-profile", slot: slot)
            let bytes = try JSONSerialization.data(withJSONObject: ["keyId": slot.keyID, "wrappedRepresentation": slot.wrappedRepresentation, "credentialId": sealed.credentialID, "envelope": sealed.envelope])
            try bytes.write(to: path, options: [.atomic])
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
        }
        let document = try CredentialWire.record(JSONSerialization.jsonObject(with: Data(contentsOf: path)), keys: ["keyId", "wrappedRepresentation", "credentialId", "envelope"])
        guard let keyID = document["keyId"] as? String, let wrapped = document["wrappedRepresentation"] as? String,
              let credentialID = document["credentialId"] as? String, let envelope = document["envelope"] as? String
        else { throw CredentialFailure.invalidMessage }
        return try protection.open(CredentialStoredValue(credentialID: credentialID, envelope: envelope), storeID: "probe-store", profileID: "probe-profile", slots: [keyID: CredentialDeviceKeySlot(keyID: keyID, wrappedRepresentation: wrapped)])
    }
}
