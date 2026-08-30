import { createSign } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

const packageName = process.env.PLAYARR_APPLICATION_ID;
const credentialPath = process.env.GOOGLE_PLAY_JSON_KEY;
const bundlePath = process.env.PLAYARR_AAB;
const versionName = process.env.PLAYARR_VERSION_NAME;
const versionCode = process.env.PLAYARR_VERSION_CODE;
const releaseNotesVersion = process.env.PLAYARR_RELEASE_NOTES_VERSION;
const releaseTrack = process.env.PLAYARR_PLAY_TRACK ?? 'alpha';
const metadataRoot = process.env.PLAYARR_METADATA_ROOT ?? 'fastlane/metadata/android/en-US';
const releaseNotesRoot = process.env.PLAYARR_RELEASE_NOTES_ROOT ?? 'fastlane/metadata/android';
const metadataLocale = process.env.PLAYARR_METADATA_LOCALE ?? 'en-US';
const listingImagesOnly = process.env.PLAYARR_LISTING_IMAGES_ONLY === 'true';

if (
  !packageName ||
  !credentialPath ||
  (!listingImagesOnly && (!bundlePath || !versionName || !versionCode || !releaseNotesVersion))
) {
  throw new Error(
    listingImagesOnly
      ? 'PLAYARR_APPLICATION_ID and GOOGLE_PLAY_JSON_KEY are required'
      : 'PLAYARR_APPLICATION_ID, GOOGLE_PLAY_JSON_KEY, PLAYARR_AAB, PLAYARR_VERSION_NAME, PLAYARR_VERSION_CODE, and PLAYARR_RELEASE_NOTES_VERSION are required',
  );
}

const credential = JSON.parse(await readFile(credentialPath, 'utf8'));
if (credential.type !== 'service_account' || !credential.client_email || !credential.private_key) {
  throw new Error('GOOGLE_PLAY_JSON_KEY must contain a Google service-account credential');
}

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsignedAssertion = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
  iss: credential.client_email,
  scope: 'https://www.googleapis.com/auth/androidpublisher',
  aud: 'https://oauth2.googleapis.com/token',
  iat: now,
  exp: now + 3600,
})}`;
const signer = createSign('RSA-SHA256');
signer.update(unsignedAssertion);
signer.end();
const assertion = `${unsignedAssertion}.${signer.sign(credential.private_key).toString('base64url')}`;

async function fetchWithRetry(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      if (attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }
  throw lastError;
}

const tokenResponse = await fetchWithRetry('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  }),
});
const tokenBody = await tokenResponse.json();
if (!tokenResponse.ok || !tokenBody.access_token) {
  throw new Error(`Google OAuth token exchange failed (${tokenResponse.status})`);
}

async function request(url, options = {}) {
  const response = await fetchWithRetry(url, {
    ...options,
    headers: {
      authorization: `Bearer ${tokenBody.access_token}`,
      ...options.headers,
    },
  });

  const text = await response.text();
  let body;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text.slice(0, 500) };
    }
  }
  if (!response.ok) {
    const message = body?.error?.message ?? body?.message ?? 'request failed';
    throw new Error(`${options.method ?? 'GET'} ${url} failed (${response.status}): ${message}`);
  }
  return body;
}

const apiRoot = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}`;
const edit = await request(`${apiRoot}/edits`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
});
const editId = edit.id;

try {
  const [details, existingListings] = await Promise.all([
    request(`${apiRoot}/edits/${editId}/details`),
    request(`${apiRoot}/edits/${editId}/listings`),
  ]);
  const listingLocales = [
    ...new Set([
      ...(listingImagesOnly ? [] : [metadataLocale, details.defaultLanguage]),
      ...(existingListings.listings ?? []).map((listing) => listing.language),
    ].filter(Boolean)),
  ];
  if (listingLocales.length === 0) {
    throw new Error('Google Play has no existing listing locales to update');
  }

  if (!listingImagesOnly) {
    const releaseNotes = await Promise.all(
      listingLocales.map(async (locale) => {
        const text = (
          await readFile(`${releaseNotesRoot}/${locale}/changelogs/${releaseNotesVersion}.txt`, 'utf8')
        ).trim();
        if (text.length === 0 || text.length > 500) {
          throw new Error(
            `${locale} release notes for ${releaseNotesVersion} must contain 1 to 500 characters`,
          );
        }
        return { language: locale, text };
      }),
    );
    const bundle = await request(
      `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${packageName}/edits/${editId}/bundles?uploadType=media`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: await readFile(bundlePath),
      },
    );
    console.log(`Uploaded AAB versionCode=${bundle.versionCode}`);
    if (String(bundle.versionCode) !== String(versionCode)) {
      throw new Error(`Uploaded AAB versionCode=${bundle.versionCode}; expected ${versionCode}`);
    }

    await request(`${apiRoot}/edits/${editId}/tracks/${encodeURIComponent(releaseTrack)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        track: releaseTrack,
        releases: [
          {
            name: `Playarr ${versionName}`,
            versionCodes: [String(bundle.versionCode)],
            status: 'completed',
            releaseNotes,
          },
        ],
      }),
    });

    const [title, shortDescription, fullDescription] = await Promise.all([
      readFile(`${metadataRoot}/title.txt`, 'utf8'),
      readFile(`${metadataRoot}/short_description.txt`, 'utf8'),
      readFile(`${metadataRoot}/full_description.txt`, 'utf8'),
    ]);
    const textLocales = [...new Set([metadataLocale, details.defaultLanguage].filter(Boolean))];
    for (const locale of textLocales) {
      await request(`${apiRoot}/edits/${editId}/listings/${locale}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          shortDescription: shortDescription.trim(),
          fullDescription: fullDescription.trim(),
        }),
      });
    }
  }

  const screenshotTypes = ['phoneScreenshots', 'tvScreenshots'];
  const imagePaths = listingImagesOnly
    ? []
    : [
        ['icon', `${metadataRoot}/images/icon.png`],
        ['featureGraphic', `${metadataRoot}/images/featureGraphic.png`],
        ['tvBanner', `${metadataRoot}/images/tvBanner.png`],
      ];
  for (const imageType of screenshotTypes) {
    const filenames = (await readdir(`${metadataRoot}/images/${imageType}`)).sort();
    for (const filename of filenames) {
      imagePaths.push([imageType, `${metadataRoot}/images/${imageType}/${filename}`]);
    }
  }

  for (const locale of listingLocales) {
    for (const imageType of [...new Set(imagePaths.map(([type]) => type))]) {
      await request(`${apiRoot}/edits/${editId}/listings/${locale}/${imageType}`, {
        method: 'DELETE',
      });
    }
    for (const [imageType, path] of imagePaths) {
      await request(
        `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${packageName}/edits/${editId}/listings/${locale}/${imageType}?uploadType=media`,
        {
          method: 'POST',
          headers: { 'content-type': 'image/png' },
          body: await readFile(path),
        },
      );
    }
    if (listingImagesOnly) {
      for (const imageType of screenshotTypes) {
        const expectedCount = imagePaths.filter(([type]) => type === imageType).length;
        const uploaded = await request(`${apiRoot}/edits/${editId}/listings/${locale}/${imageType}`);
        if ((uploaded.images ?? []).length !== expectedCount) {
          throw new Error(
            `${locale} ${imageType} verification failed: expected ${expectedCount}, got ${(uploaded.images ?? []).length}`,
          );
        }
      }
    }
  }

  if (listingImagesOnly) {
    await request(`${apiRoot}/edits/${editId}:commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW`, {
      method: 'POST',
    });
    console.log(`Published Google Play listing screenshots for ${listingLocales.join(', ')}`);
  } else {
    await request(`${apiRoot}/edits/${editId}:commit`, { method: 'POST' });
    console.log(
      `Published Playarr ${versionName} to Google Play ${releaseTrack} with assets for ${listingLocales.join(', ')}`,
    );

    const verificationEdit = await request(`${apiRoot}/edits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    try {
      const publishedTrack = await request(
        `${apiRoot}/edits/${verificationEdit.id}/tracks/${encodeURIComponent(releaseTrack)}`,
      );
      const publishedRelease = (publishedTrack.releases ?? []).find((release) =>
        (release.versionCodes ?? []).includes(String(versionCode)),
      );
      if (!publishedRelease || publishedRelease.status !== 'completed') {
        throw new Error(
          `Google Play ${releaseTrack} verification did not find completed versionCode ${versionCode}`,
        );
      }
      const publishedLanguages = new Set(
        (publishedRelease.releaseNotes ?? []).map((releaseNote) => releaseNote.language),
      );
      const missingLanguages = listingLocales.filter((locale) => !publishedLanguages.has(locale));
      if (missingLanguages.length > 0) {
        throw new Error(
          `Google Play ${releaseTrack} verification is missing release notes for ${missingLanguages.join(', ')}`,
        );
      }
      console.log(
        `Verified Google Play ${releaseTrack} versionCode=${versionCode}, status=completed, releaseNotes=${listingLocales.join(',')}`,
      );
    } finally {
      await request(`${apiRoot}/edits/${verificationEdit.id}`, { method: 'DELETE' }).catch(() => {});
    }
  }
} catch (error) {
  await request(`${apiRoot}/edits/${editId}`, { method: 'DELETE' }).catch(() => {});
  throw error;
}
