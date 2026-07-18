import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ProfileAvatar, useStoredProfileAvatar } from "../../components/ProfileAvatar";
import { useApiBaseUrl, useApiClient, useAuth } from "../../lib/ApiClientProvider";
import { useLanguage } from "../../lib/i18n/LanguageProvider";
import {
  PROFILE_AVATAR_PRESETS,
  createCustomAvatarSource,
  drawCustomAvatarCrop,
  profileAvatarToRemotePreference,
  profileAvatarScope,
  readProfileAvatar,
  releaseCustomAvatarSource,
  renderCustomAvatar,
  supportsCustomAvatarUpload,
  writeProfileAvatar,
  type ProfileAvatarPreference,
  type ProfileAvatarPresetId,
  type CustomAvatarCrop,
  type CustomAvatarSource,
} from "../../lib/profileAvatar";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { useToast } from "../../lib/toast";
import { SettingsSectionLayout } from "./SettingsSectionLayout";

export function SettingsProfileAvatarPage() {
  const { t } = useLanguage();
  useDocumentTitle(t("settings.profileAvatar.documentTitle"));
  const [apiBaseUrl] = useApiBaseUrl();
  const client = useApiClient();
  const { currentUserId } = useAuth();
  const { showToast } = useToast();
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const scope = currentUserId ? profileAvatarScope(apiBaseUrl, currentUserId) : undefined;
  const [preference, setPreference] = useState<ProfileAvatarPreference | null>(() =>
    scope && currentUserId ? readProfileAvatar(scope, currentUserId) : null
  );
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorSource, setEditorSource] = useState<CustomAvatarSource | null>(null);
  const [crop, setCrop] = useState<CustomAvatarCrop>({
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const canUpload = supportsCustomAvatarUpload();
  const syncedPreference = useStoredProfileAvatar(scope, currentUserId, client);

  useEffect(() => {
    setPreference(syncedPreference);
  }, [syncedPreference]);

  useEffect(() => {
    if (!editorSource) return;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>("#profile-avatar-zoom")?.focus();
    });
    const handleBack = (event: KeyboardEvent) => {
      const isBack =
        event.key === "Escape" ||
        event.key === "BrowserBack" ||
        event.key === "GoBack" ||
        event.keyCode === 10009 ||
        event.keyCode === 461;
      if (!isBack) return;
      event.preventDefault();
      event.stopPropagation();
      setEditorSource(null);
    };
    window.addEventListener("keydown", handleBack, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleBack, true);
      releaseCustomAvatarSource(editorSource);
    };
  }, [editorSource]);

  useEffect(() => {
    if (!editorSource || !cropCanvasRef.current) return;
    try {
      drawCustomAvatarCrop(cropCanvasRef.current, editorSource, crop, 480);
    } catch {
      setError(t("settings.profileAvatar.uploadFailed"));
    }
  }, [crop, editorSource, t]);

  async function savePreference(
    next: ProfileAvatarPreference,
    toast: string
  ): Promise<boolean> {
    if (!scope || saving) return false;
    setSaving(true);
    try {
      await client.updateProfileAvatar({
        preference: profileAvatarToRemotePreference(next),
      });
      if (!writeProfileAvatar(scope, next)) {
        throw new Error("profile_avatar_cache_failed");
      }
      setPreference(next);
      setError(null);
      showToast(toast);
      return true;
    } catch {
      setError(t("settings.profileAvatar.saveFailed"));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function selectPreset(preset: ProfileAvatarPresetId) {
    if (preference?.kind === "preset" && preference.preset === preset) return;
    await savePreference(
      { kind: "preset", preset },
      t("settings.profileAvatar.presetSaved")
    );
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const source = await createCustomAvatarSource(file);
      setCrop({ zoom: 1, offsetX: 0, offsetY: 0 });
      setEditorSource(source);
    } catch (uploadError) {
      const code = uploadError instanceof Error ? uploadError.message : "";
      setError(
        code === "unsupported_image_type"
          ? t("settings.profileAvatar.unsupportedType")
          : code === "image_too_large"
            ? t("settings.profileAvatar.tooLarge")
            : t("settings.profileAvatar.uploadFailed")
      );
    } finally {
      setUploading(false);
    }
  }

  function handleCropPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function handleCropPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    setCrop((current) => ({
      ...current,
      offsetX: Math.max(-1, Math.min(1, current.offsetX + (deltaX / rect.width) * 2)),
      offsetY: Math.max(-1, Math.min(1, current.offsetY + (deltaY / rect.height) * 2)),
    }));
  }

  function finishCropDrag(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  async function saveCrop() {
    if (!editorSource) return;
    try {
      const dataUrl = renderCustomAvatar(editorSource, crop);
      if (
        await savePreference(
          { kind: "custom", dataUrl },
          t("settings.profileAvatar.customSaved")
        )
      ) {
        setEditorSource(null);
      }
    } catch {
      setError(t("settings.profileAvatar.uploadFailed"));
    }
  }

  if (!preference || !currentUserId) {
    return (
      <SettingsSectionLayout kicker="" title="" description="">
        <section className="card settings-card settings-card-wide">
          <p className="muted">{t("settings.profileAvatar.signInRequired")}</p>
        </section>
      </SettingsSectionLayout>
    );
  }

  return (
    <SettingsSectionLayout kicker="" title="" description="">
      <section className="card settings-card settings-card-wide profile-avatar-settings">
        <div
          className="profile-avatar-preset-grid"
          role="group"
          aria-label={t("settings.profileAvatar.presetLabel")}
        >
          {PROFILE_AVATAR_PRESETS.map((preset) => {
            const selected =
              preference.kind === "preset" && preference.preset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                className={`profile-avatar-preset${selected ? " is-active" : ""}`}
                aria-label={t(`settings.profileAvatar.preset.${preset.id}`)}
                aria-pressed={selected}
                disabled={saving}
                onClick={() => void selectPreset(preset.id)}
              >
                <ProfileAvatar
                  preference={{ kind: "preset", preset: preset.id }}
                />
              </button>
            );
          })}

          {preference.kind === "custom" ? (
            <button
              type="button"
              className="profile-avatar-preset is-active"
              aria-label={t("settings.profileAvatar.customCurrent")}
              aria-pressed="true"
              onClick={() => canUpload && uploadInputRef.current?.click()}
            >
              <ProfileAvatar preference={preference} />
            </button>
          ) : null}
        </div>

        {canUpload ? (
          <div className="profile-avatar-upload">
            <input
              ref={uploadInputRef}
              className="profile-avatar-upload-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              tabIndex={-1}
              onChange={(event) => void handleUpload(event)}
            />
            <button
              type="button"
              className="btn btn-secondary"
              disabled={uploading || saving}
              onClick={() => uploadInputRef.current?.click()}
            >
              {uploading
                ? t("settings.profileAvatar.uploading")
                : preference.kind === "custom"
                  ? t("settings.profileAvatar.replacePhoto")
                  : t("settings.profileAvatar.uploadPhoto")}
            </button>
            <p className="muted">{t("settings.profileAvatar.deviceNote")}</p>
          </div>
        ) : (
          <p className="muted profile-avatar-device-note">
            {t("settings.profileAvatar.presetsOnly")}
          </p>
        )}

        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {editorSource ? (
        <div className="profile-avatar-editor-backdrop" role="presentation">
          <section
            className="profile-avatar-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-avatar-editor-title"
            data-tv-scroll-container
            data-tv-scroll-axis="vertical"
            data-navigation-scroll-key="settings:profile-avatar:editor"
          >
            <button
              type="button"
              className="profile-avatar-editor-close"
              aria-label={t("settings.profileAvatar.cancelCrop")}
              onClick={() => setEditorSource(null)}
            >
              ×
            </button>
            <h2 id="profile-avatar-editor-title">{t("settings.profileAvatar.cropTitle")}</h2>
            <p className="muted">{t("settings.profileAvatar.cropDescription")}</p>
            <canvas
              ref={cropCanvasRef}
              className="profile-avatar-crop-canvas"
              role="img"
              aria-label={t("settings.profileAvatar.cropPreview")}
              onPointerDown={handleCropPointerDown}
              onPointerMove={handleCropPointerMove}
              onPointerUp={finishCropDrag}
              onPointerCancel={finishCropDrag}
            />
            <div className="profile-avatar-crop-controls">
              <label>
                <span>{t("settings.profileAvatar.zoom")}</span>
                <input
                  id="profile-avatar-zoom"
                  type="range"
                  min="1"
                  max="3"
                  step="0.05"
                  value={crop.zoom}
                  onChange={(event) =>
                    setCrop((current) => ({ ...current, zoom: Number(event.target.value) }))
                  }
                />
              </label>
              <label>
                <span>{t("settings.profileAvatar.horizontalPosition")}</span>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.02"
                  value={crop.offsetX}
                  onChange={(event) =>
                    setCrop((current) => ({ ...current, offsetX: Number(event.target.value) }))
                  }
                />
              </label>
              <label>
                <span>{t("settings.profileAvatar.verticalPosition")}</span>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.02"
                  value={crop.offsetY}
                  onChange={(event) =>
                    setCrop((current) => ({ ...current, offsetY: Number(event.target.value) }))
                  }
                />
              </label>
            </div>
            <div className="profile-avatar-editor-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCrop({ zoom: 1, offsetX: 0, offsetY: 0 })}
              >
                {t("settings.profileAvatar.resetCrop")}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setEditorSource(null)}
              >
                {t("settings.profileAvatar.cancelCrop")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving}
                onClick={() => void saveCrop()}
              >
                {t("settings.profileAvatar.saveCrop")}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </SettingsSectionLayout>
  );
}
