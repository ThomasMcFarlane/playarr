/** Add a title to one of the profile's own playlists (detail page and long-press actions). */
import React, {useState} from 'react';
import type {PlaylistResponse} from '@playarr-tv/api-client';
import {useAsyncData} from '@playarr-tv/api-client/react';
import {useApiClient} from '../api/ApiClientProvider';
import {useLanguage} from '../i18n/LanguageProvider';
import {useTheme} from '../theme/ThemeProvider';
import {T} from './kit';
import {Sheet, SheetOption} from './Sheet';

export function PlaylistSheet({workId, onClose, onAdded}: {workId: string; onClose: () => void; onAdded: (name: string) => void}): React.ReactElement {
  const client = useApiClient();
  const {t} = useLanguage();
  const {colour} = useTheme();
  const lists = useAsyncData<PlaylistResponse[]>(() => client.listPlaylists(), [client]);
  const [failed, setFailed] = useState(false);
  const own = lists.status === 'ready' ? lists.data.filter((list) => !list.is_system) : [];
  return (
    <Sheet title={t('components.mediaContextMenu.addToPlaylist')} onClose={onClose}>
      {own.map((list, index) => (
        <SheetOption
          key={list.id}
          label={list.name}
          hasTVPreferredFocus={index === 0}
          onPress={() => {
            client
              .addPlaylistItem(list.id, {work_id: workId})
              .then(() => onAdded(list.name))
              .catch(() => setFailed(true));
          }}
        />
      ))}
      {failed ? (
        <T size={12} weight={400} color={colour.accent}>
          {t('pages.workDetail.playbackOptionsLoadError')}
        </T>
      ) : null}
    </Sheet>
  );
}
