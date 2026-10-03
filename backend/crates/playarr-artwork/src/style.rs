//! Named server-side artwork style presets shared by every Playarr client.
//!
//! Clients request a style via `GET /api/v1/artwork/...?...&style=stage`
//! rather than each re-implementing CSS `filter: grayscale()/contrast()/
//! brightness()` (Roku has no pixel filters; web already pays a GPU filter
//! tax; native clients should not fork their own approximate blends).
//!
//! Presets are intentional product looks, not free-form image operators.
//! Add a new variant when a second client needs the same look; do not grow
//! an arbitrary filter-query language here.

use std::fmt;
use std::io::Cursor;
use std::str::FromStr;

use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView, ImageFormat, Rgba, RgbaImage};

/// Product artwork looks the server can bake into a cacheable derivative.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum ArtworkStyle {
    /// Unprocessed source bytes from the metadata provider / *arr cache.
    #[default]
    Original,
    /// Dark-theme TV stage key-art (`.tv-key-art img` in tv-web global.css):
    /// full greyscale, contrast 0.82, brightness 0.6, opacity 0.72 baked into
    /// alpha, soft right-edge fade from 72% width so the art dissolves into
    /// the stage surface without a hard crop.
    Stage,
}

impl ArtworkStyle {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Original => "original",
            Self::Stage => "stage",
        }
    }

    /// Stable cache-file segment for derivatives (`backdrop-HASH.stage.png`).
    pub fn cache_segment(self) -> Option<&'static str> {
        match self {
            Self::Original => None,
            Self::Stage => Some("stage"),
        }
    }

    /// Content type of the processed body when this style is applied.
    pub fn output_content_type(self) -> Option<&'static str> {
        match self {
            Self::Original => None,
            Self::Stage => Some("image/png"),
        }
    }
}

impl fmt::Display for ArtworkStyle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for ArtworkStyle {
    type Err = ();

    fn from_str(raw: &str) -> Result<Self, Self::Err> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "" | "original" | "raw" | "source" => Ok(Self::Original),
            "stage" | "stage_hero" | "tv-stage" | "tv_stage" => Ok(Self::Stage),
            _ => Err(()),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ArtworkStyleError {
    #[error("could not decode source artwork: {0}")]
    Decode(String),
    #[error("could not encode styled artwork: {0}")]
    Encode(String),
}

/// Apply a named style to already-fetched source artwork bytes.
///
/// `Original` is a no-op and returns the input as-is (content type unchanged
/// at the call site). Other styles return PNG bytes.
pub fn apply_artwork_style(
    source: &[u8],
    style: ArtworkStyle,
) -> Result<(Vec<u8>, &'static str), ArtworkStyleError> {
    match style {
        ArtworkStyle::Original => Err(ArtworkStyleError::Encode(
            "original style has no derivative encode path".into(),
        )),
        ArtworkStyle::Stage => encode_stage(source),
    }
}

fn encode_stage(source: &[u8]) -> Result<(Vec<u8>, &'static str), ArtworkStyleError> {
    let image = image::load_from_memory(source)
        .map_err(|error| ArtworkStyleError::Decode(error.to_string()))?;
    let rgba = stage_process(image);
    let mut out = Cursor::new(Vec::new());
    rgba.write_to(&mut out, ImageFormat::Png)
        .map_err(|error| ArtworkStyleError::Encode(error.to_string()))?;
    Ok((out.into_inner(), "image/png"))
}

/// Mirrors dark-theme `.tv-key-art img` pixel math from tv-web:
/// `filter: grayscale(1) contrast(0.82) brightness(0.6)` then opacity 0.72
/// and a right-edge alpha fade (mask solid until 72% width).
fn stage_process(image: DynamicImage) -> RgbaImage {
    // Cap insane sources so a 8K still does not blow memory on the API node.
    let image = {
        let (w, h) = image.dimensions();
        if w > 2560 || h > 1440 {
            image.resize(2560, 1440, FilterType::Triangle)
        } else {
            image
        }
    };
    let grey = image.grayscale().to_rgba8();
    let (width, height) = grey.dimensions();
    let mut out = RgbaImage::new(width, height);

    // CSS contrast(c) around mid: (x - 0.5) * c + 0.5, then brightness(b): * b.
    let contrast = 0.82_f32;
    let brightness = 0.6_f32;
    let base_opacity = 0.72_f32;
    let fade_start = 0.72_f32;

    for y in 0..height {
        for x in 0..width {
            let px = grey.get_pixel(x, y);
            let mut v = px[0] as f32 / 255.0;
            v = (v - 0.5) * contrast + 0.5;
            v *= brightness;
            v = v.clamp(0.0, 1.0);
            let grey_u8 = (v * 255.0).round() as u8;

            let xf = if width <= 1 {
                1.0
            } else {
                x as f32 / (width - 1) as f32
            };
            let edge = if xf <= fade_start {
                1.0
            } else {
                // Soft ease-out to full transparent at the right edge.
                let t = (xf - fade_start) / (1.0 - fade_start);
                (1.0 - t).clamp(0.0, 1.0).powf(1.35)
            };
            let alpha = (base_opacity * edge * 255.0).round() as u8;
            out.put_pixel(x, y, Rgba([grey_u8, grey_u8, grey_u8, alpha]));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};

    fn sample_jpeg() -> Vec<u8> {
        let img: ImageBuffer<Rgb<u8>, Vec<u8>> =
            ImageBuffer::from_fn(32, 24, |x, y| Rgb([(x * 7) as u8, (y * 11) as u8, 200]));
        let mut buf = Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(img)
            .write_to(&mut buf, ImageFormat::Jpeg)
            .unwrap();
        buf.into_inner()
    }

    #[test]
    fn style_parse_accepts_aliases() {
        assert_eq!(
            "stage".parse::<ArtworkStyle>().unwrap(),
            ArtworkStyle::Stage
        );
        assert_eq!(
            "stage_hero".parse::<ArtworkStyle>().unwrap(),
            ArtworkStyle::Stage
        );
        assert_eq!(
            "original".parse::<ArtworkStyle>().unwrap(),
            ArtworkStyle::Original
        );
        assert!("neon".parse::<ArtworkStyle>().is_err());
    }

    #[test]
    fn stage_output_is_png_and_desaturated() {
        let (bytes, content_type) =
            apply_artwork_style(&sample_jpeg(), ArtworkStyle::Stage).unwrap();
        assert_eq!(content_type, "image/png");
        let img = image::load_from_memory(&bytes).unwrap().to_rgba8();
        // Sample mid-left (solid mask region): R=G=B and alpha ≈ 0.72*255.
        let px = img.get_pixel(4, 12);
        assert_eq!(px[0], px[1]);
        assert_eq!(px[1], px[2]);
        assert!((160..=200).contains(&px[3]), "alpha={}", px[3]);
        // Far-right edge should be nearly transparent.
        let edge = img.get_pixel(img.width() - 1, 12);
        assert!(edge[3] < 40, "edge alpha={}", edge[3]);
    }
}
