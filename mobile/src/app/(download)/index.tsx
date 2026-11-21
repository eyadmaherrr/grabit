import { SegmentedControl } from '@expo/ui/community/segmented-control';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { shareAsync, useIncomingShare } from 'expo-sharing';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { extract, findUrl } from '@/lib/extract';
import { fileOf, type Entry } from '@/lib/library';
import { saveItem, type Progress, type SaveMode } from '@/lib/save';
import { toGrabError, type GrabError, type MediaInfo, type MediaItem } from '@/lib/types';
import { formatDuration } from '@/ui/format';
import { ActionButton, GlassCard, Notice, Page, ProgressBar, SectionLabel } from '@/ui/glass';
import { accent, colors, radius } from '@/ui/theme';

type State =
  | { step: 'idle' }
  | { step: 'loading' }
  | { step: 'ready'; info: MediaInfo }
  | { step: 'saving'; info: MediaInfo; progress: Progress; part?: string }
  | { step: 'done'; info: MediaInfo; entries: Entry[]; inPhotos: boolean; photosDenied: boolean }
  | { step: 'error'; error: GrabError; info?: MediaInfo };

const modeFor = (item: MediaItem): SaveMode => (item.kind === 'image' ? 'image' : item.kind === 'audio' ? 'audio' : 'video');

export default function DownloadScreen() {
  const [text, setText] = useState('');
  const [state, setState] = useState<State>({ step: 'idle' });
  const [quality, setQuality] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const abort = useRef<AbortController | null>(null);
  const { sharedPayloads, clearSharedPayloads } = useIncomingShare();

  // Links shared to GrabIt from another app (Share › GrabIt).
  useEffect(() => {
    const shared = sharedPayloads.find((p) => p.shareType === 'url' || p.shareType === 'text');
    if (!shared?.value) return;
    clearSharedPayloads();
    const url = findUrl(shared.value);
    if (url) lookup(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedPayloads]);

  async function lookup(value = text) {
    const url = findUrl(value) ?? value.trim();
    if (!url) return;
    setText(url);
    setState({ step: 'loading' });
    try {
      const info = await extract(url);
      setQuality(0);
      setSelected(info.items.map((_, i) => i));
      setState({ step: 'ready', info });
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setState({ step: 'error', error: toGrabError(err) });
    }
  }

  async function pasteFallback() {
    const value = (await Clipboard.getUrlAsync()) ?? (await Clipboard.getStringAsync());
    if (value) lookup(value);
  }

  async function save(info: MediaInfo, items: { item: MediaItem; mode: SaveMode }[], height: number | null) {
    const controller = new AbortController();
    abort.current = controller;
    const entries: Entry[] = [];
    let inPhotos = true;
    let photosDenied = false;
    try {
      for (let i = 0; i < items.length; i++) {
        const { item, mode } = items[i];
        const part = items.length > 1 ? `${i + 1} of ${items.length}` : undefined;
        const suffix = items.length > 1 ? ` (${i + 1})` : '';
        setState({ step: 'saving', info, part, progress: { fraction: 0, label: 'Starting…' } });
        const result = await saveItem(
          info,
          item,
          mode,
          height,
          (progress) => setState({ step: 'saving', info, part, progress }),
          controller.signal,
          suffix
        );
        entries.push(result.entry);
        if (result.entry.kind !== 'audio') inPhotos &&= result.inPhotos;
        photosDenied ||= result.photosDenied;
      }
      if (entries.every((e) => e.kind === 'audio')) inPhotos = false;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setState({ step: 'done', info, entries, inPhotos, photosDenied });
    } catch (err) {
      const error = toGrabError(err);
      if (error.code === 'cancelled') {
        setState({ step: 'ready', info });
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setState({ step: 'error', error, info });
    } finally {
      abort.current = null;
    }
  }

  function reset() {
    setText('');
    setState({ step: 'idle' });
  }

  const busy = state.step === 'loading' || state.step === 'saving';

  return (
    <Page>
      <GlassCard>
        <View style={s.inputRow}>
          <SymbolView name="link" tintColor={colors.secondary} size={20} style={s.inputIcon} />
          <TextInput
            value={text}
            onChangeText={setText}
            onSubmitEditing={() => lookup()}
            placeholder="Paste a link to a video or post"
            placeholderTextColor={colors.tertiary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            clearButtonMode="while-editing"
            editable={!busy}
            style={s.input}
          />
        </View>
        {Clipboard.isPasteButtonAvailable ? (
          <Clipboard.ClipboardPasteButton
            style={s.pasteButton}
            acceptedContentTypes={['url', 'plain-text']}
            displayMode="iconAndLabel"
            cornerStyle="capsule"
            backgroundColor={accent}
            foregroundColor="#FFFFFF"
            onPress={(data) => {
              if (data.type === 'text' && !busy) lookup(data.text);
            }}
          />
        ) : (
          <ActionButton prominent title="Paste link" icon="doc.on.clipboard" onPress={pasteFallback} disabled={busy} />
        )}
        {text.trim() && state.step === 'idle' ? (
          <ActionButton title="Find video" icon="magnifyingglass" onPress={() => lookup()} />
        ) : null}
      </GlassCard>

      {state.step === 'idle' && <HowTo />}

      {state.step === 'loading' && (
        <GlassCard>
          <Notice icon="hourglass" color={accent} title="Reading the link…" body="This takes a few seconds." />
          <ProgressBar fraction={null} />
        </GlassCard>
      )}

      {state.step === 'error' && (
        <GlassCard>
          <Notice icon="exclamationmark.triangle.fill" color={colors.orange} title="Couldn’t save this" body={state.error.message} />
          <ActionButton title="Try again" icon="arrow.clockwise" onPress={() => (state.info ? setState({ step: 'ready', info: state.info }) : lookup())} />
        </GlassCard>
      )}

      {(state.step === 'ready' || state.step === 'saving') && (
        <MediaCard
          info={state.info}
          quality={quality}
          onQuality={setQuality}
          selected={selected}
          onToggle={(i) => setSelected((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort((a, b) => a - b)))}
          saving={state.step === 'saving'}
          onSave={(items, height) => save(state.info, items, height)}
        />
      )}

      {state.step === 'saving' && (
        <GlassCard>
          <View style={s.progressHead}>
            <Text style={s.progressLabel}>{state.progress.label}</Text>
            <Text style={s.progressValue}>
              {state.part ? `${state.part} · ` : ''}
              {state.progress.fraction !== null ? `${Math.round(state.progress.fraction * 100)}%` : ''}
            </Text>
          </View>
          <ProgressBar fraction={state.progress.fraction} />
          <ActionButton title="Cancel" icon="xmark" onPress={() => abort.current?.abort()} color="#8E8E93" />
        </GlassCard>
      )}

      {state.step === 'done' && <DoneCard state={state} onAnother={reset} />}
    </Page>
  );
}

function HowTo() {
  const steps: { icon: any; title: string; body: string }[] = [
    { icon: 'square.and.arrow.up', title: 'Copy the link', body: 'In Instagram, TikTok, YouTube, Facebook or X, tap Share, then Copy link.' },
    { icon: 'doc.on.clipboard', title: 'Tap Paste', body: 'GrabIt finds the video or photos.' },
    { icon: 'arrow.down.circle', title: 'Save', body: 'Videos and photos go straight to your Photos.' },
  ];
  return (
    <GlassCard>
      {steps.map((step) => (
        <Notice key={step.title} icon={step.icon} color={accent} title={step.title} body={step.body} />
      ))}
      <Text style={s.tip}>Tip: you can also tap Share › GrabIt inside those apps. If GrabIt isn’t in the list, tap More and turn it on once.</Text>
    </GlassCard>
  );
}

function MediaCard({
  info,
  quality,
  onQuality,
  selected,
  onToggle,
  saving,
  onSave,
}: {
  info: MediaInfo;
  quality: number;
  onQuality: (i: number) => void;
  selected: number[];
  onToggle: (i: number) => void;
  saving: boolean;
  onSave: (items: { item: MediaItem; mode: SaveMode }[], height: number | null) => void;
}) {
  const single = info.items.length === 1 ? info.items[0] : null;
  const variants = single?.variants ?? [];
  const heights = variants.map((v) => v.height).filter((h) => h > 0);
  const showQuality = heights.length > 1;
  const height = showQuality ? heights[quality] ?? null : null;
  const meta = [info.siteName, info.author, formatDuration(info.duration)].filter(Boolean).join('  ·  ');
  const aspect = single?.width && single?.height ? Math.max(single.width / single.height, 0.8) : 16 / 9;

  return (
    <GlassCard>
      {single ? (
        <Thumb uri={single.thumbnail ?? info.thumbnail} headers={single.thumbnailHeaders} aspect={aspect} kind={single.kind} />
      ) : (
        <View style={s.grid}>
          {info.items.map((item, i) => {
            const on = selected.includes(i);
            return (
              <Pressable key={i} onPress={() => onToggle(i)} disabled={saving} style={s.gridCell}>
                <Thumb uri={item.thumbnail} headers={item.thumbnailHeaders} aspect={1} kind={item.kind} small />
                <View style={[s.check, on && s.checkOn]}>
                  {on ? <SymbolView name="checkmark" tintColor="#FFFFFF" size={13} style={s.checkIcon} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={s.metaBlock}>
        <Text style={s.title} numberOfLines={3}>
          {info.title}
        </Text>
        <Text style={s.meta} numberOfLines={1}>
          {meta}
        </Text>
      </View>

      {showQuality && (
        <View style={s.qualityBlock}>
          <SectionLabel>Quality</SectionLabel>
          <SegmentedControl
            values={heights.map((h, i) => (i === 0 ? `Best (${h}p)` : `${h}p`))}
            selectedIndex={quality}
            onChange={(e) => onQuality(e.nativeEvent.selectedSegmentIndex)}
            enabled={!saving}
          />
        </View>
      )}

      {single?.kind === 'video' && (
        <>
          <ActionButton prominent title="Save video" icon="arrow.down.circle.fill" disabled={saving} onPress={() => onSave([{ item: single, mode: 'video' }], height)} />
          <ActionButton title="Save audio only" icon="music.note" disabled={saving} onPress={() => onSave([{ item: single, mode: 'audio' }], height)} />
        </>
      )}
      {single?.kind === 'image' && (
        <ActionButton prominent title="Save photo" icon="arrow.down.circle.fill" disabled={saving} onPress={() => onSave([{ item: single, mode: 'image' }], null)} />
      )}
      {single?.kind === 'audio' && (
        <ActionButton prominent title="Save audio" icon="music.note" disabled={saving} onPress={() => onSave([{ item: single, mode: 'audio' }], null)} />
      )}
      {!single && (
        <ActionButton
          prominent
          title={selected.length === info.items.length ? `Save all ${info.items.length}` : `Save ${selected.length} selected`}
          icon="arrow.down.circle.fill"
          disabled={saving || selected.length === 0}
          onPress={() => onSave(selected.map((i) => ({ item: info.items[i], mode: modeFor(info.items[i]) })), null)}
        />
      )}
    </GlassCard>
  );
}

function Thumb({
  uri,
  headers,
  aspect,
  kind,
  small,
}: {
  uri?: string;
  headers?: Record<string, string>;
  aspect: number;
  kind: MediaItem['kind'];
  small?: boolean;
}) {
  return (
    <View style={[s.thumb, { aspectRatio: aspect }, small && s.thumbSmall]}>
      {uri ? (
        <Image source={{ uri, headers }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
      ) : (
        <SymbolView name={kind === 'audio' ? 'music.note' : kind === 'image' ? 'photo' : 'film'} tintColor={colors.secondary} size={small ? 22 : 34} style={s.thumbIcon} />
      )}
      {kind === 'video' && small ? (
        <View style={s.badge}>
          <SymbolView name="play.fill" tintColor="#FFFFFF" size={10} style={s.badgeIcon} />
        </View>
      ) : null}
    </View>
  );
}

function DoneCard({ state, onAnother }: { state: Extract<State, { step: 'done' }>; onAnother: () => void }) {
  const first = state.entries[0];
  const count = state.entries.length;
  const allAudio = state.entries.every((e) => e.kind === 'audio');
  const title = state.inPhotos ? (count > 1 ? `${count} items saved to Photos` : 'Saved to Photos') : 'Saved in GrabIt';
  const body = allAudio
    ? 'Find it in the Library tab, or in the Files app under On My iPhone › GrabIt. Tap Share to send it or save it somewhere else.'
    : state.photosDenied
      ? 'GrabIt isn’t allowed to add to Photos. To turn it on: Settings › GrabIt › Photos › Add Photos Only. It’s in the Library tab meanwhile.'
      : state.inPhotos
        ? 'Open the Photos app to see it. It’s also in the Library tab.'
        : 'Photos didn’t accept this file, but it’s in the Library tab.';
  return (
    <GlassCard>
      <Notice icon="checkmark.circle.fill" color={colors.green} title={title} body={body} />
      {count === 1 && <ActionButton prominent={allAudio} title="Share" icon="square.and.arrow.up" onPress={() => shareAsync(fileOf(first).uri)} />}
      {count === 1 && first.kind !== 'image' && (
        <ActionButton
          title="Convert"
          icon="arrow.triangle.2.circlepath"
          onPress={() => router.navigate({ pathname: '/convert', params: { entry: first.id } })}
        />
      )}
      <ActionButton title="Download another" icon="plus" onPress={onAnother} />
    </GlassCard>
  );
}

const s = StyleSheet.create({
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  inputIcon: { width: 22, height: 22 },
  input: { flex: 1, fontSize: 17, color: colors.label, paddingVertical: 8 },
  pasteButton: { height: 50, alignSelf: 'stretch' },
  tip: { fontSize: 14, color: colors.secondary, lineHeight: 19 },
  metaBlock: { gap: 4 },
  title: { fontSize: 19, fontWeight: '700', color: colors.label, lineHeight: 24 },
  meta: { fontSize: 14, color: colors.secondary },
  qualityBlock: { gap: 10 },
  thumb: {
    width: '100%',
    maxHeight: 420,
    borderRadius: radius.inner,
    overflow: 'hidden',
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbSmall: { borderRadius: 12 },
  thumbIcon: { width: 36, height: 36 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gridCell: { width: '31.5%' },
  check: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: accent },
  checkIcon: { width: 13, height: 13 },
  badge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeIcon: { width: 10, height: 10 },
  progressHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  progressLabel: { fontSize: 17, fontWeight: '600', color: colors.label },
  progressValue: { fontSize: 15, color: colors.secondary, fontVariant: ['tabular-nums'] },
});
