import SwiftUI

struct TVRootView: View {
    var body: some View {
        TabView {
            NavigationStack {
                TVHomeView()
            }
            .tabItem { Label("Home", systemImage: "house") }

            NavigationStack {
                TVSearchView()
            }
            .tabItem { Label("Search", systemImage: "magnifyingglass") }

            NavigationStack {
                TVSettingsView()
            }
            .tabItem { Label("Settings", systemImage: "gearshape") }
        }
    }
}
