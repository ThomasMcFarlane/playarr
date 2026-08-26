# Private Android publishing through Google Play

Playarr publishes `io.playarr.mobile` to Google Play's **internal testing**
track. It is available only through the tester opt-in link and is not
discoverable in public Play Store search. Internal testing supports up to 100
Google Account or Google Workspace testers.

This is different from a Managed Google Play private app, which is intended for
devices controlled by one or more Android Enterprise organisations. Use the
internal track unless Playarr is being deployed exclusively through an
organisation's mobile-device management system.

## One-time Play Console bootstrap

The account owner must complete these steps once:

1. Register and verify the Google Play developer account, then create an app
   named **Playarr**. Choose **App**, **Free**, the appropriate contact email,
   and accept the Play App Signing terms.
2. Keep the package name `io.playarr.mobile`. Playarr already has signed
   sideload releases, so do not replace its existing signing identity with an
   unrelated Google-generated key. In **Protected with Play > Play Store
   distribution > Play app signing**, choose **Change app signing key** and
   provide a copy of the existing Java-keystore app-signing key using Google's
   PEPK instructions. If Android developer verification asks for proof of an
   existing package, use this same key.
3. In **Test and release > Testing > Internal testing > Testers**, create an
   email list or select a Google Group, save it, and copy the tester opt-in
   link. Testers must opt in with the Google Account used by Play Store.

Do not send the signing keystore, passwords, or service-account JSON through
chat, email, an issue, or a commit.

## Create the CI service account

1. Create or select a Google Cloud project and enable the **Google Play Android
   Developer API** (`androidpublisher.googleapis.com`).
2. Create a service account named `playarr-github-publisher`. It needs no
   Google Cloud project roles.
3. In Play Console **Users and permissions**, invite the service account email.
   Under **App permissions**, grant access only to Playarr with:
   **View app information (read-only)** and **Release apps to testing tracks**.
   Do not grant production, financial, order, tester-management, or account-wide
   permissions.
4. Create one JSON key for the service account and save the downloaded file
   locally. Treat it as a password.

Once the JSON file exists locally, store it in the existing `release-android`
GitHub environment without printing its contents:

```bash
gh secret set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON \
  --repo ThomasMcFarlane/playarr \
  --env release-android \
  < /path/to/playarr-github-publisher.json
```

Delete the downloaded JSON after confirming the GitHub secret exists. The key
can be revoked later in Google Cloud without changing the Android signing key.

## First bundle only

The Google Play Developer API cannot create the Play app's initial package
record. The first CI attempt will still build and upload
`playarr-android.aab` as a GitHub Actions artefact, but the Play upload will
fail with `Package not found`.

1. Download `playarr-android.aab` from that workflow run.
2. In Play Console, create the first internal-testing release and upload that
   bundle manually.
3. Resolve any Play Console declarations shown for the bundle, review the
   release, and start the internal rollout.
4. Do not re-run the same version: Google Play version codes cannot be reused.
   The next Android tag publishes its new bundle to the same internal track
   automatically.

## Routine release

Create and push a SemVer tag whose version code is higher than every bundle
already uploaded to Play:

```bash
git tag android-v0.2.14
git push origin android-v0.2.14
```

The workflow derives `versionCode` as `major * 1,000,000 + minor * 1,000 +
patch`, runs Android unit tests, builds and verifies the signed APK and app
bundle, uploads the bundle to the completed internal track, and then continues
the existing GitHub/R2 APK release.

To confirm delivery, open **Test and release > Testing > Internal testing** and
check that the release shows the expected version name and code. Install or
update it through the tester opt-in link on both a phone and an Android TV or
Google TV device.
