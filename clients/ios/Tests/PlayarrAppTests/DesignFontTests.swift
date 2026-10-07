@testable import PlayarrApp
import UIKit
import XCTest

/// The fonts are bundled in the app and registered through `UIAppFonts`; the tests run inside the app.
final class DesignFontTests: XCTestCase {
    func testBundledFontsLoad() {
        XCTAssertNotNil(DesignFont.uiFont(family: "Nunito Sans", size: 16, weight: 400, fixedAxes: DesignFont.nunitoAxes(forSize: 16)))
        XCTAssertNotNil(DesignFont.uiFont(family: "JetBrains Mono", size: 16, weight: 700, fixedAxes: [:]))
    }

    func testWeightAxisChangesTheGlyphWidths() throws {
        let light = try XCTUnwrap(DesignFont.uiFont(family: "Nunito Sans", size: 20, weight: 300, fixedAxes: DesignFont.nunitoAxes(forSize: 16)))
        let heavy = try XCTUnwrap(DesignFont.uiFont(family: "Nunito Sans", size: 20, weight: 800, fixedAxes: DesignFont.nunitoAxes(forSize: 16)))
        func width(_ font: UIFont) -> CGFloat {
            ("Watching now" as NSString).size(withAttributes: [.font: font]).width
        }
        XCTAssertGreaterThan(width(heavy), width(light))
    }

    func testOpticalSizeFollowsTheTextSizeWithinTheAxisRange() {
        XCTAssertEqual(DesignFont.nunitoAxes(forSize: 4)["opsz"], 6)
        XCTAssertEqual(DesignFont.nunitoAxes(forSize: 9.92)["opsz"], 9.92)
        XCTAssertEqual(DesignFont.nunitoAxes(forSize: 40)["opsz"], 12)
        XCTAssertEqual(DesignFont.nunitoAxes(forSize: 40)["wdth"], 100)
    }

    func testSmallTextIsWiderThanAFixedOpticalSize() throws {
        let automatic = try XCTUnwrap(DesignFont.uiFont(family: "Nunito Sans", size: 8, weight: 400, fixedAxes: DesignFont.nunitoAxes(forSize: 8)))
        let fixed = try XCTUnwrap(DesignFont.uiFont(
            family: "Nunito Sans", size: 8, weight: 400, fixedAxes: ["wdth": 100, "opsz": 12, "YTLC": 500]
        ))
        func width(_ font: UIFont) -> CGFloat {
            ("Sample Series 1 \u{00B7} Series 2019" as NSString).size(withAttributes: [.font: font]).width
        }
        XCTAssertGreaterThan(width(automatic), width(fixed))
    }

    func testUnknownFamilyIsNotSubstituted() {
        XCTAssertNil(DesignFont.uiFont(family: "No Such Family", size: 16, weight: 400, fixedAxes: [:]))
    }
}
