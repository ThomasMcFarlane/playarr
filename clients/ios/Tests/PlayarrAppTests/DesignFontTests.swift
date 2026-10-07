@testable import PlayarrApp
import UIKit
import XCTest

/// The fonts are bundled in the app and registered through `UIAppFonts`; the tests run inside the app.
final class DesignFontTests: XCTestCase {
    func testTheWebInstanceIsTheNunitoSansFace() throws {
        let face = try XCTUnwrap(DesignFont.uiFont(
            family: "Nunito Sans", postScriptName: DesignFont.nunitoPostScriptName,
            size: 16, weight: 400, fixedAxes: DesignFont.nunitoAxes
        ))
        XCTAssertTrue(face.familyName.hasPrefix("Nunito Sans"), "got \(face.familyName) / \(face.fontName)")
    }

    func testBundledFontsLoad() {
        XCTAssertNotNil(DesignFont.uiFont(family: "Nunito Sans", postScriptName: DesignFont.nunitoPostScriptName, size: 16, weight: 400, fixedAxes: DesignFont.nunitoAxes))
        XCTAssertNotNil(DesignFont.uiFont(family: "JetBrains Mono", size: 16, weight: 700, fixedAxes: [:]))
    }

    func testWeightAxisChangesTheGlyphWidths() throws {
        let light = try XCTUnwrap(DesignFont.uiFont(family: "Nunito Sans", postScriptName: DesignFont.nunitoPostScriptName, size: 20, weight: 300, fixedAxes: DesignFont.nunitoAxes))
        let heavy = try XCTUnwrap(DesignFont.uiFont(family: "Nunito Sans", postScriptName: DesignFont.nunitoPostScriptName, size: 20, weight: 800, fixedAxes: DesignFont.nunitoAxes))
        func width(_ font: UIFont) -> CGFloat {
            ("Watching now" as NSString).size(withAttributes: [.font: font]).width
        }
        XCTAssertGreaterThan(width(heavy), width(light))
    }

    func testUnknownFamilyIsNotSubstituted() {
        XCTAssertNil(DesignFont.uiFont(family: "No Such Family", size: 16, weight: 400, fixedAxes: [:]))
    }
}
