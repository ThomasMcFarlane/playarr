/**
 * The Watchlist, Requests and Downloads pages (`clients/tv-web/web/src/pages/{Watchlist,Requests,Downloads}.tsx`): the page
 * header, the frosted panel and either the web's empty state or a list of rows.
 *
 * Downloads is the empty page here on purpose: this platform does not download for offline viewing, so its list is always
 * empty and there is nothing to manage (the web shows the same page where nothing has been downloaded).
 */
import React, {useCallback, useEffect, useState} from 'react';
import {Pressable, View} from 'react-native';
import {useNavigation, type NavigationProp, type ParamListBase} from '@amazon-devices/react-navigation__native';
import type {RequestView, WatchlistEntry} from '@playarr-tv/api-client';
import {useApiClient} from '../api/ApiClientProvider';
import {useLanguage} from '../i18n/LanguageProvider';
import {useTvBackNavigation} from '../navigation/backPolicy';
import {ROUTES} from '../navigation/routes';
import {mix} from '../theme/color';
import {useTheme} from '../theme/ThemeProvider';
import {EmptyState} from '../tv/EmptyState';
import {Box, T, u} from '../tv/kit';
import {PageHeader} from '../tv/PageHeader';
import {RailFrost, Stage} from '../tv/Stage';

type ListState<T> = {status: 'loading'} | {status: 'ready'; items: T[]} | {status: 'error'; message: string};

function useList<Item>(load: () => Promise<Item[]>, deps: unknown[]): [ListState<Item>, React.Dispatch<React.SetStateAction<ListState<Item>>>] {
  const [state, setState] = useState<ListState<Item>>({status: 'loading'});
  useEffect(() => {
    let cancelled = false;
    load()
      .then((items) => {
        if (!cancelled) setState({status: 'ready', items});
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({status: 'error', message: error instanceof Error ? error.message : String(error)});
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [state, setState];
}

function Page({title, detail, children}: {title: string; detail?: string; children: React.ReactNode}): React.ReactElement {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const {colour, scheme} = useTheme();
  useTvBackNavigation(ROUTES.home);
  return (
    <Stage>
      <PageHeader title={title} detail={detail} onBack={() => navigation.navigate(ROUTES.home)} />
      <RailFrost dark={scheme === 'dark'} soft={colour.surfaceSoft} strong={colour.surfaceStrong} />
      {children}
    </Stage>
  );
}

/** One `.tv-download-row`: a rounded translucent row with the title and its meta on the left and actions on the right. */
function Row({title, meta, note, actions, y}: {title: string; meta: string[]; note?: string | null; actions?: React.ReactNode; y: number}): React.ReactElement {
  const {colour} = useTheme();
  return (
    <View
      style={{
        position: 'absolute',
        left: u(787.2),
        top: u(y),
        width: u(1075.2),
        minHeight: u(78),
        borderRadius: u(14),
        paddingHorizontal: u(20),
        paddingVertical: u(16),
        backgroundColor: mix(colour.surfaceSoft, 0.45),
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <View style={{flex: 1}}>
        <T size={14.4} weight={650} lh={21} color={colour.ink} lines={1}>
          {title}
        </T>
        <View style={{flexDirection: 'row', marginTop: u(3)}}>
          {meta.map((entry, index) => (
            <View key={`${entry}-${index}`} style={{marginRight: u(12)}}>
              <T size={10.56} weight={400} lh={16} color={colour.inkMuted}>
                {entry}
              </T>
            </View>
          ))}
        </View>
        {note ? (
          <T size={10.56} weight={400} lh={16} color={colour.accent}>
            {note}
          </T>
        ) : null}
      </View>
      <View style={{flexDirection: 'row'}}>{actions}</View>
    </View>
  );
}

function RowButton({label, onPress, hasTVPreferredFocus}: {label: string; onPress: () => void; hasTVPreferredFocus?: boolean}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        height: u(44),
        marginLeft: u(12),
        paddingHorizontal: u(18),
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? colour.ink : mix(colour.surfaceStrong, 0.72),
        transform: [{scale: focused ? 1.06 : 1}],
      }}
    >
      <T size={11.136} weight={700} color={focused ? colour.bg : colour.ink}>
        {label}
      </T>
    </Pressable>
  );
}

const ROW_PITCH = 94;
const LIST_Y = 150;

export function WatchlistScreen(): React.ReactElement {
  const client = useApiClient();
  const {t} = useLanguage();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const [state, setState] = useList<WatchlistEntry>(() => client.listWatchlist().then((response) => response.items), [client]);
  const remove = useCallback(
    (entry: WatchlistEntry) => {
      client
        .removeFromWatchlist(entry.title.title_key)
        .then(() =>
          setState((current) => (current.status === 'ready' ? {status: 'ready', items: current.items.filter((item) => item.title.title_key !== entry.title.title_key)} : current)),
        )
        .catch(() => undefined);
    },
    [client, setState],
  );
  return (
    <Page title={t('pages.watchlist.title')}>
      {state.status === 'loading' ? (
        <Box x={787.2} y={LIST_Y} w={600}>
          <T size={12} weight={400} color="#887a82">
            {t('pages.watchlist.loading')}
          </T>
        </Box>
      ) : state.status === 'error' ? (
        <EmptyState y={89.6} title={t('pages.watchlist.errorTitle')} description={state.message} tone="error" />
      ) : state.items.length === 0 ? (
        <EmptyState y={89.6} title={t('pages.watchlist.emptyTitle')} description={t('pages.watchlist.emptyDescription')} />
      ) : (
        state.items.map((entry, index) => {
          const workId = entry.title.sources.find((source) => source.source === 'library' && source.work_id)?.work_id;
          return (
            <Row
              key={entry.title.title_key}
              y={LIST_Y + index * ROW_PITCH}
              title={entry.title.title}
              meta={entry.title.year ? [String(entry.title.year)] : []}
              actions={
                <>
                  {workId ? (
                    <RowButton
                      hasTVPreferredFocus={index === 0}
                      label={t('discovery.action.play')}
                      onPress={() => navigation.navigate(entry.title.kind === 'artist' ? ROUTES.musicDetail : ROUTES.workDetail, {workId, backTo: ROUTES.watchlist})}
                    />
                  ) : null}
                  <RowButton hasTVPreferredFocus={index === 0 && !workId} label={t('discovery.watchlist.remove')} onPress={() => remove(entry)} />
                </>
              }
            />
          );
        })
      )}
    </Page>
  );
}

export function RequestsScreen(): React.ReactElement {
  const client = useApiClient();
  const {t} = useLanguage();
  const [state] = useList<RequestView>(() => client.listRequests(), [client]);
  const statusLabel = (status: RequestView['status']): string => t(`pages.requests.status.${status}` as const);
  return (
    <Page title={t('pages.requests.title')}>
      {state.status === 'loading' ? (
        <Box x={787.2} y={LIST_Y} w={600}>
          <T size={12} weight={400} color="#887a82">
            {t('pages.requests.loading')}
          </T>
        </Box>
      ) : state.status === 'error' ? (
        <EmptyState y={89.6} title={t('pages.requests.errorTitle')} description={state.message} tone="error" />
      ) : state.items.length === 0 ? (
        <EmptyState y={89.6} title={t('pages.requests.emptyTitle')} description={t('pages.requests.emptyDescription')} />
      ) : (
        state.items.map((request, index) => (
          <Row
            key={request.id}
            y={LIST_Y + index * ROW_PITCH}
            title={request.title}
            meta={[
              ...(request.year ? [String(request.year)] : []),
              statusLabel(request.status),
              ...(request.requested_by ? [request.mine ? t('pages.requests.byYou') : t('pages.requests.by', {name: request.requested_by})] : []),
            ]}
            note={request.status_note}
          />
        ))
      )}
    </Page>
  );
}

export function DownloadsScreen(): React.ReactElement {
  const {t} = useLanguage();
  const {colour} = useTheme();
  // No offline engine on this platform: nothing is ever stored, so usage is always zero.
  const usage = t('pages.downloads.storageUsed', {used: '0 B', quota: '10.0 GB'});
  return (
    <Page title={t('pages.downloads.title')}>
      <Box x={226.6} y={111} w={247.3} h={1} bg={colour.lineStrong} />
      <Box x={226.6} y={112.1} w={400}>
        <T size={11.136} weight={680} ls={0.501} lh={24.1} color={colour.inkMuted} upper>
          {usage}
        </T>
      </Box>
      <Box x={787.2} y={57.6} w={1075.2}>
        <T size={10.88} weight={400} lh={16.3} color={colour.inkMuted}>
          {usage}
        </T>
      </Box>
      <Box x={787.2} y={81.9} w={1075.2} h={4} r={999} bg={colour.surfaceSoft} />
      <EmptyState y={139.9} title={t('pages.downloads.emptyTitle')} description={t('pages.downloads.emptyDescription')} />
    </Page>
  );
}
