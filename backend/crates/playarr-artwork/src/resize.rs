//! Width-limited artwork derivatives: a poster on a 200 px card does not need the 2000 px source.

use std::io::Cursor;
use std::path::{Path, PathBuf};

use image::imageops::FilterType;
use image::ImageFormat;

/// The only widths a client may request; any other value snaps up to the next one, so an image has
/// at most this many cached variants.
pub const ALLOWED_WIDTHS: [u32; 7] = [160, 240, 360, 540, 780, 1280, 1920];

/// The smallest allowed width that is at least `requested` (the largest when it exceeds them all).
pub fn snap_width(requested: u32) -> u32 {
    ALLOWED_WIDTHS
        .iter()
        .copied()
        .find(|width| *width >= requested)
        .unwrap_or(ALLOWED_WIDTHS[ALLOWED_WIDTHS.len() - 1])
}

pub(crate) fn resized_cache_path(source: &Path, width: u32) -> Option<PathBuf> {
    let stem = source.file_stem()?.to_str()?;
    let extension = source.extension()?.to_str()?;
    // Alpha-carrying PNG stays PNG; everything else becomes a JPEG derivative.
    let out_extension = if extension.eq_ignore_ascii_case("png") {
        "png"
    } else {
        "jpg"
    };
    Some(
        source
            .parent()?
            .join(format!("{stem}.w{width}.{out_extension}")),
    )
}

pub(crate) fn keep_marker_path(resized: &Path) -> PathBuf {
    resized.with_extension("keep")
}

pub(crate) fn output_content_type(source_content_type: &'static str) -> &'static str {
    if source_content_type == "image/png" {
        "image/png"
    } else {
        "image/jpeg"
    }
}

/// Resize to `width`, or `None` when the source is already no wider.
pub(crate) fn resize_to_width(source: &[u8], width: u32) -> Result<Option<Vec<u8>>, String> {
    let image = image::load_from_memory(source)
        .map_err(|error| format!("could not decode artwork: {error}"))?;
    if image.width() <= width {
        return Ok(None);
    }
    let height =
        ((u64::from(image.height()) * u64::from(width)) / u64::from(image.width())).max(1) as u32;
    let resized = image.resize_exact(width, height, FilterType::CatmullRom);
    let is_png = image::guess_format(source).ok() == Some(ImageFormat::Png);
    let mut out = Vec::new();
    if is_png {
        resized
            .write_to(&mut Cursor::new(&mut out), ImageFormat::Png)
            .map_err(|error| format!("could not encode resized artwork: {error}"))?;
    } else {
        let rgb = resized.to_rgb8();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 82)
            .encode_image(&rgb)
            .map_err(|error| format!("could not encode resized artwork: {error}"))?;
    }
    Ok(Some(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jpeg(width: u32, height: u32) -> Vec<u8> {
        let image = image::RgbImage::from_pixel(width, height, image::Rgb([40, 80, 120]));
        let mut out = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 90)
            .encode_image(&image)
            .unwrap();
        out
    }

    #[test]
    fn widths_snap_up_to_a_small_fixed_set() {
        assert_eq!(snap_width(1), 160);
        assert_eq!(snap_width(160), 160);
        assert_eq!(snap_width(161), 240);
        assert_eq!(snap_width(500), 540);
        assert_eq!(snap_width(99_999), 1920);
    }

    #[test]
    fn resizes_down_keeping_the_aspect_ratio_and_never_upscales() {
        let source = jpeg(1000, 1500);
        let resized = resize_to_width(&source, 240).unwrap().unwrap();
        let decoded = image::load_from_memory(&resized).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (240, 360));
        assert!(resized.len() < source.len());
        assert!(resize_to_width(&jpeg(200, 300), 240).unwrap().is_none());
    }

    #[test]
    fn derivative_paths_are_per_width_and_keep_png_alpha() {
        let jpg = resized_cache_path(Path::new("/c/a-1.jpg"), 240).unwrap();
        assert_eq!(jpg, Path::new("/c/a-1.w240.jpg"));
        let png = resized_cache_path(Path::new("/c/a-1.stage.png"), 540).unwrap();
        assert_eq!(png, Path::new("/c/a-1.stage.w540.png"));
        assert_eq!(output_content_type("image/webp"), "image/jpeg");
        assert_eq!(output_content_type("image/png"), "image/png");
    }
}
