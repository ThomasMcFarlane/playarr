import { useEffect, useRef, useState } from "react";
import { ApiError } from "@streamarr-tv/api-client";
import { usePrimaryApiClient } from "../../lib/ApiClientProvider";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { useToast } from "../../lib/toast";
import { useLanguage } from "../../lib/i18n/LanguageProvider";
import {
  readPlayerDefaults,
  writePlayerDefaults,
  type PlayerDefaults,
} from "../../lib/playerDefaults";
import { QualityMatrix } from "../../components/QualityMatrix";
import { SettingsSectionLayout } from "./SettingsSectionLayout";

const AUDIO_LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Chinese" },
  { value: "hi", label: "Hindi" },
  { value: "ar", label: "Arabic" },
  { value: "th", label: "Thai" },
] as const;

type AudioLanguage = (typeof AUDIO_LANGUAGE_OPTIONS)[number]["value"];

type PlayerPreferenceState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; message: string };

function isAudioLanguage(value: string): value is AudioLanguage {
  return AUDIO_LANGUAGE_OPTIONS.some((option) => option.value === value);
}

export function SettingsPlayerPage() {
  const { t } = useLanguage();
  useDocumentTitle(t("settings.playerPreferences.documentTitle"));
  const client = usePrimaryApiClient();
  const { showToast } = useToast();
  const [audioLanguage, setAudioLanguage] = useState<AudioLanguage>("en");
  const [playerDefaults, setPlayerDefaults] = useState<PlayerDefaults>(readPlayerDefaults);
  const [playerPreferenceState, setPlayerPreferenceState] = useState<PlayerPreferenceState>({
    status: "loading",
  });
  const playerPreferenceRequestRef = useRef(0);

  useEffect(() => {
    const requestId = ++playerPreferenceRequestRef.current;
    setPlayerPreferenceState({ status: "loading" });

    void client
      .getPlayerPreferences()
      .then((preferences) => {
        if (playerPreferenceRequestRef.current !== requestId) return;
        const language = preferences.preferred_audio_language;
        setAudioLanguage(isAudioLanguage(language) ? language : "en");
        setPlayerPreferenceState({ status: "ready" });
      })
      .catch((error) => {
        if (playerPreferenceRequestRef.current !== requestId) return;
        const message = error instanceof ApiError ? error.message : String(error);
        setPlayerPreferenceState({ status: "error", message });
      });

    return () => {
      if (playerPreferenceRequestRef.current === requestId) {
        playerPreferenceRequestRef.current += 1;
      }
    };
  }, [client]);

  async function handleAudioLanguageChange(nextLanguage: AudioLanguage) {
    if (
      nextLanguage === audioLanguage ||
      playerPreferenceState.status === "loading" ||
      playerPreferenceState.status === "saving"
    ) {
      return;
    }

    const previousLanguage = audioLanguage;
    const requestId = ++playerPreferenceRequestRef.current;
    setAudioLanguage(nextLanguage);
    setPlayerPreferenceState({ status: "saving" });

    try {
      const preferences = await client.updatePlayerPreferences({
        preferred_audio_language: nextLanguage,
      });
      if (playerPreferenceRequestRef.current !== requestId) return;
      const savedLanguage = preferences.preferred_audio_language;
      setAudioLanguage(isAudioLanguage(savedLanguage) ? savedLanguage : nextLanguage);
      setPlayerPreferenceState({ status: "saved" });
      showToast(t("settings.playerPreferences.toastSaved"));
    } catch (error) {
      if (playerPreferenceRequestRef.current !== requestId) return;
      setAudioLanguage(previousLanguage);
      const message = error instanceof ApiError ? error.message : String(error);
      setPlayerPreferenceState({ status: "error", message });
    }
  }

  function updatePlayerDefaults(update: Partial<PlayerDefaults>) {
    const nextDefaults = { ...playerDefaults, ...update };
    writePlayerDefaults(nextDefaults);
    setPlayerDefaults(nextDefaults);
    showToast(t("settings.playerPreferences.toastDefaultsSaved"));
  }

  const selectedAudioLanguage =
    AUDIO_LANGUAGE_OPTIONS.find((option) => option.value === audioLanguage)?.label ?? "English";

  return (
    <SettingsSectionLayout
      kicker={t("settings.playerPreferences.kicker")}
      title={t("settings.playerPreferences.title")}
      description={t("settings.playerPreferences.description")}
    >
      <section className="card settings-card settings-card-wide">
        <div className="player-default-group">
          <div className="player-default-heading">
            <h3>{t("settings.playerPreferences.qualityTitle")}</h3>
            <p>{t("settings.playerPreferences.qualityDescription")}</p>
          </div>
          <div
            className="player-quality-default-matrix"
            role="radiogroup"
            aria-label={t("settings.playerPreferences.qualityAriaLabel")}
          >
            <QualityMatrix
              variant="settings"
              role="radio"
              selectedId={playerDefaults.qualityId}
              standaloneChoices={[
                {
                  id: "original",
                  label: t("quality.original"),
                  detail: t("quality.originalDetail"),
                },
              ]}
              onSelect={(qualityId) =>
                updatePlayerDefaults({
                  qualityId: qualityId as PlayerDefaults["qualityId"],
                })
              }
            />
          </div>
        </div>

        <div className="player-default-group">
          <div className="player-default-heading">
            <h3>{t("settings.playerPreferences.subtitlesTitle")}</h3>
            <p>{t("settings.playerPreferences.subtitlesDescription")}</p>
          </div>
          <div
            className="player-default-choice"
            role="radiogroup"
            aria-label={t("settings.playerPreferences.subtitlesAriaLabel")}
          >
            {([
              ["off", t("settings.playerPreferences.subtitlesOff")],
              ["forced", t("settings.playerPreferences.subtitlesForced")],
              ["always", t("settings.playerPreferences.subtitlesAlways")],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                className={`player-default-button${
                  playerDefaults.subtitleMode === value ? " is-active" : ""
                }`}
                aria-checked={playerDefaults.subtitleMode === value}
                onClick={() => updatePlayerDefaults({ subtitleMode: value })}
              >
                <span>{label}</span>
              </button>
            ))}
          </div>

          {playerDefaults.subtitleMode !== "off" && (
            <div
              className="player-language-choice player-subtitle-language-choice"
              role="radiogroup"
              aria-label={t("settings.playerPreferences.subtitleLanguageAriaLabel")}
            >
              {AUDIO_LANGUAGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  className={`player-language-button${
                    playerDefaults.subtitleLanguage === option.value ? " is-active" : ""
                  }`}
                  aria-checked={playerDefaults.subtitleLanguage === option.value}
                  onClick={() => updatePlayerDefaults({ subtitleLanguage: option.value })}
                >
                  <span>{option.label}</span>
                  <small>{option.value}</small>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="player-default-group">
          <div className="player-default-heading">
            <h3>{t("settings.playerPreferences.audioTitle")}</h3>
            <p>{t("settings.playerPreferences.audioDescription")}</p>
          </div>
          <div
            className="player-language-choice"
            role="radiogroup"
            aria-label={t("settings.playerPreferences.audioLanguageAriaLabel")}
            aria-busy={
              playerPreferenceState.status === "loading" ||
              playerPreferenceState.status === "saving"
            }
          >
            {AUDIO_LANGUAGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                className={`player-language-button${
                  audioLanguage === option.value ? " is-active" : ""
                }`}
                aria-checked={audioLanguage === option.value}
                onClick={() => void handleAudioLanguageChange(option.value)}
              >
                <span>{option.label}</span>
                <small>{option.value}</small>
              </button>
            ))}
          </div>

          <p
            className={`player-preference-status${
              playerPreferenceState.status === "error" ? " is-error" : ""
            }`}
            aria-live="polite"
          >
            {playerPreferenceState.status === "loading"
              ? t("settings.playerPreferences.statusLoading")
              : playerPreferenceState.status === "saving"
                ? t("settings.playerPreferences.statusSaving", {
                    language: selectedAudioLanguage,
                  })
                : playerPreferenceState.status === "error"
                  ? t("settings.playerPreferences.statusError", {
                      message: playerPreferenceState.message,
                    })
                  : t("settings.playerPreferences.statusReady", {
                      language: selectedAudioLanguage,
                    })}
          </p>
        </div>

        <p className="player-default-device-note">
          {t("settings.playerPreferences.deviceNote")}
        </p>
      </section>
    </SettingsSectionLayout>
  );
}
