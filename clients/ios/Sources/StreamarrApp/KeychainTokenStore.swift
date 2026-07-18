import Foundation
import Security
import StreamarrKit

enum KeychainTokenStoreError: Error {
    case unexpectedStatus(OSStatus)
}

/// Per-server session storage. Tokens survive relaunch but never sync to
/// another device or leave the Keychain in plaintext app preferences.
actor KeychainTokenStore: AccessTokenProviding {
    private let service: String
    private let account: String
    private var cachedSession: StoredAuthSession?

    init(service: String, account: String) {
        self.service = service
        self.account = account
        self.cachedSession = try? Self.read(service: service, account: account)
    }

    func currentSession() -> StoredAuthSession? {
        cachedSession
    }

    func storeSession(_ session: StoredAuthSession) throws {
        let data = try JSONEncoder().encode(session)
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
    }

    func clearSession() throws {
        let status = SecItemDelete(Self.query(service: service, account: account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainTokenStoreError.unexpectedStatus(status)
        }
        cachedSession = nil
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
