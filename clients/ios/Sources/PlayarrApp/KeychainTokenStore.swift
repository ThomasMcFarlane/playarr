import Foundation
import Security
import PlayarrKit

enum KeychainTokenStoreError: LocalizedError {
    case unexpectedStatus(OSStatus)

    var errorDescription: String? {
        switch self {
        case .unexpectedStatus(let status):
            let detail = SecCopyErrorMessageString(status, nil) as String? ?? "Unknown Security error"
            return "Playarr couldn't securely save this session (Keychain status \(status): \(detail))."
        }
    }
}

/// Per-server session storage. Physical devices always use Keychain. The
/// simulator uses its app-scoped preferences because an unsigned simulator
/// build has no application identifier entitlement and cannot access Keychain.
actor KeychainTokenStore: AccessTokenProviding {
    private let service: String
    private let account: String
    private var cachedSession: StoredAuthSession?
    #if targetEnvironment(simulator)
    private let simulatorDefaults: UserDefaults
    private let simulatorDefaultsKey: String
    #endif

    init(
        service: String,
        account: String,
        simulatorDefaults: UserDefaults = .standard
    ) {
        self.service = service
        self.account = account
        #if targetEnvironment(simulator)
        self.simulatorDefaults = simulatorDefaults
        self.simulatorDefaultsKey = Self.simulatorDefaultsKey(service: service, account: account)
        self.cachedSession = simulatorDefaults.data(forKey: simulatorDefaultsKey)
            .flatMap { try? JSONDecoder().decode(StoredAuthSession.self, from: $0) }
        #else
        self.cachedSession = try? Self.read(service: service, account: account)
        #endif
    }

    func currentSession() -> StoredAuthSession? {
        cachedSession
    }

    func storeSession(_ session: StoredAuthSession) throws {
        let data = try JSONEncoder().encode(session)
        #if targetEnvironment(simulator)
        simulatorDefaults.set(data, forKey: simulatorDefaultsKey)
        cachedSession = session
        return
        #else
        let query = Self.query(service: service, account: account)
        let attributes: [String: Any] = [kSecValueData as String: data]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)

        if updateStatus == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let addStatus = SecItemAdd(item as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw KeychainTokenStoreError.unexpectedStatus(addStatus)
            }
        } else if updateStatus != errSecSuccess {
            throw KeychainTokenStoreError.unexpectedStatus(updateStatus)
        }

        cachedSession = session
        #endif
    }

    func clearSession() throws {
        #if targetEnvironment(simulator)
        simulatorDefaults.removeObject(forKey: simulatorDefaultsKey)
        cachedSession = nil
        return
        #else
        let status = SecItemDelete(Self.query(service: service, account: account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainTokenStoreError.unexpectedStatus(status)
        }
        cachedSession = nil
        #endif
    }

    private static func simulatorDefaultsKey(service: String, account: String) -> String {
        "\(service).simulator-session.\(account)"
    }

    private static func query(service: String, account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    private static func read(service: String, account: String) throws -> StoredAuthSession? {
        var query = query(service: service, account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw KeychainTokenStoreError.unexpectedStatus(status)
        }
        return try JSONDecoder().decode(StoredAuthSession.self, from: data)
    }
}
