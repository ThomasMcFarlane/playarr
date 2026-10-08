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
    /// Light-theme TV stage key-art: greyscale, contrast 0.88, brightness 1.1,
    /// opacity 0.4 baked into alpha, with the same right-edge fade as `Stage`.
    StageLight,
    /// `Stage`'s greyscale, contrast and brightness only: an opaque JPEG at most 1920 x 1080, with no baked opacity or
    /// edge fade. For clients that crop the picture to a box and apply the opacity and fade themselves; about a
    /// twentieth of the bytes of the PNG.
    StageGrey,
    /// `StageLight`'s numbers in the same opaque JPEG form as `StageGrey`.
    StageGreyLight,
}

impl ArtworkStyle {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Original => "original",
            Self::Stage => "stage",
            Self::StageLight => "stage-light",
            Self::StageGrey => "stage-grey",
            Self::StageGreyLight => "stage-grey-light",
        }
    }

    /// Stable cache-file segment for derivatives (`backdrop-HASH.stage.png`).
    pub fn cache_segment(self) -> Option<&'static str> {
        match self {
            Self::Original => None,
            Self::Stage => Some("stage"),
            Self::StageLight => Some("stage-light"),
            Self::StageGrey => Some("stage-grey"),
            Self::StageGreyLight => Some("stage-grey-light"),
        }
    }

    /// Content type of the processed body when this style is applied.
    pub fn output_content_type(self) -> Option<&'static str> {
        match self {
            Self::Original => None,
            Self::Stage | Self::StageLight => Some("image/png"),
            Self::StageGrey | Self::StageGreyLight => Some("image/jpeg"),
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
            "stage-light" | "stage_light" => Ok(Self::StageLight),
            "stage-grey" | "stage_grey" | "stage-gray" => Ok(Self::StageGrey),
            "stage-grey-light" | "stage_grey_light" | "stage-gray-light" => {
                Ok(Self::StageGreyLight)
            }
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
        ArtworkStyle::Stage => encode_stage(source, STAGE_DARK),
        ArtworkStyle::StageLight => encode_stage(source, STAGE_LIGHT),
        ArtworkStyle::StageGrey => encode_stage_grey(source, STAGE_DARK),
        ArtworkStyle::StageGreyLight => encode_stage_grey(source, STAGE_LIGHT),
    }
}

/// The opaque form: the same greyscale, contrast and brightness as `encode_stage`, JPEG, no alpha.
fn encode_stage_grey(
    source: &[u8],
    look: StageLook,
) -> Result<(Vec<u8>, &'static str), ArtworkStyleError> {
    let image = image::load_from_memory(source)
        .map_err(|error| ArtworkStyleError::Decode(error.to_string()))?;
    let image = {
        let (w, h) = image.dimensions();
        if w > 1920 || h > 1080 {
            image.resize(1920, 1080, FilterType::Triangle)
        } else {
            image
        }
    };
    let mut grey = image.grayscale().to_luma8();
    for pixel in grey.pixels_mut() {
        let mut v = pixel[0] as f32 / 255.0;
        v = (v - 0.5) * look.contrast + 0.5;
        v *= look.brightness;
        pixel[0] = (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    }
    let mut out = Cursor::new(Vec::new());
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 84)
        .encode_image(&grey)
        .map_err(|error| ArtworkStyleError::Encode(error.to_string()))?;
    Ok((out.into_inner(), "image/jpeg"))
}

/// The CSS filter numbers of one theme's `.tv-key-art img`.
#[derive(Clone, Copy)]
struct StageLook {
    contrast: f32,
    brightness: f32,
    opacity: f32,
}

const STAGE_DARK: StageLook = StageLook {
    contrast: 0.82,
    brightness: 0.6,
    opacity: 0.72,
};
const STAGE_LIGHT: StageLook = StageLook {
    contrast: 0.88,
    brightness: 1.1,
    opacity: 0.4,
};

fn encode_stage(
    source: &[u8],
    look: StageLook,
) -> Result<(Vec<u8>, &'static str), ArtworkStyleError> {
    let image = image::load_from_memory(source)
        .map_err(|error| ArtworkStyleError::Decode(error.to_string()))?;
    let rgba = stage_process(image, look);
    let mut out = Cursor::new(Vec::new());
    rgba.write_to(&mut out, ImageFormat::Png)
        .map_err(|error| ArtworkStyleError::Encode(error.to_string()))?;
    Ok((out.into_inner(), "image/png"))
}

/// Mirrors dark-theme `.tv-key-art img` pixel math from tv-web:
/// `filter: grayscale(1) contrast(0.82) brightness(0.6)` then opacity 0.72
/// and a right-edge alpha fade (mask solid until 72% width).
fn stage_process(image: DynamicImage, look: StageLook) -> RgbaImage {
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
    let StageLook {
        contrast,
        brightness,
        opacity: base_opacity,
    } = look;
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
    fn stage_light_is_lighter_and_fainter_than_stage() {
        assert_eq!(
            "stage-light".parse::<ArtworkStyle>().unwrap(),
            ArtworkStyle::StageLight
        );
        let jpeg = sample_jpeg();
        let dark =
            image::load_from_memory(&apply_artwork_style(&jpeg, ArtworkStyle::Stage).unwrap().0)
                .unwrap()
                .to_rgba8();
        let light = image::load_from_memory(
            &apply_artwork_style(&jpeg, ArtworkStyle::StageLight)
                .unwrap()
                .0,
        )
        .unwrap()
        .to_rgba8();
        let (d, l) = (dark.get_pixel(4, 12), light.get_pixel(4, 12));
        assert_eq!(l[0], l[1]);
        assert!(l[0] > d[0], "light {} dark {}", l[0], d[0]);
        assert!(l[3] < d[3], "light alpha {} dark alpha {}", l[3], d[3]);
        assert!((90..=115).contains(&l[3]), "alpha={}", l[3]);
    }

    #[test]
    fn stage_grey_is_an_opaque_grey_jpeg() {
        assert_eq!(
            "stage-grey".parse::<ArtworkStyle>().unwrap(),
            ArtworkStyle::StageGrey
        );
        let jpeg = sample_jpeg();
        let (bytes, content_type) = apply_artwork_style(&jpeg, ArtworkStyle::StageGrey).unwrap();
        assert_eq!(content_type, "image/jpeg");
        let img = image::load_from_memory(&bytes).unwrap().to_luma8();
        let (dark_px, _) = (img.get_pixel(4, 12)[0], ());
        let (light_bytes, _) = apply_artwork_style(&jpeg, ArtworkStyle::StageGreyLight).unwrap();
        let light = image::load_from_memory(&light_bytes).unwrap().to_luma8();
        assert!(
            light.get_pixel(4, 12)[0] > dark_px,
            "light must be brighter"
        );
        // No fade: the right edge keeps its value.
        let edge = img.get_pixel(img.width() - 1, 12)[0];
        let mid = img.get_pixel(img.width() - 3, 12)[0];
        assert!(edge.abs_diff(mid) < 40);
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
