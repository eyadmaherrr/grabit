import { SegmentedControl } from '@expo/ui/community/segmented-control';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { shareAsync } from 'expo-sharing';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { MediaTools, type ProbeResult } from '../../../modules/media-tools';
import { convertFile, type ConvertTarget } from '@/lib/convert';
import { fileOf, getEntry, newId, type Entry } from '@/lib/library';
import { GrabError, toGrabError } from '@/lib/types';
import { formatDuration, formatSize, parseTime } from '@/ui/format';
import { ActionButton, GlassCard, Notice, Page, ProgressBar, SectionLabel } from '@/ui/glass';
import { accent, colors, radius } from '@/ui/theme';

type Source = { uri: string; name: string; size?: number; probe: ProbeResult | null; thumb?: string };
type Status =
  | { step: 'idle' }
  | { step: 'working'; fraction: number }
  | { step: 'done'; entry: Entry; inPhotos: boolean; photosDenied: boolean }
  | { step: 'error'; error: GrabError };

const TARGETS: ConvertTarget[] = ['video', 'audio', 'gif'];
const VIDEO_SIZES = [0, 1080, 720, 480];
const GIF_SIZES = [320, 480, 640];

export default function ConvertScreen() {
  const params = useLocalSearchParams<{ entry?: string }>();
  const [source, setSource] = useState<Source | null>(null);
  const [target, setTarget] = useState<ConvertTarget>('video');
  const [sizeIndex, setSizeIndex] = useState(2);
  const [gifIndex, setGifIndex] = useState(1);
  const [mute, setMute] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [status, setStatus] = useState<Status>({ step: 'idle' });

  // "Convert" tapped on a Library item or after a download.
  useEffect(() => {
    const entry = params.entry ? getEntry(params.entry) : undefined;
    if (entry) {
      const file = fileOf(entry);
      load({ uri: file.uri, name: entry.file, size: entry.size });
      router.setParams({ entry: undefined });
    }
  }, [params.entry]);

  async function load(file: { uri: string; name: string; size?: number }) {
    setStatus({ step: 'idle' });
    const probe = MediaTools ? await MediaTools.probe(file.uri).catch(() => null) : null;
    let thumb: string | undefined;
    if (probe?.hasVideo && MediaTools) {
      const out = new File(Paths.cache, `thumb-${newId()}.jpg`);
      thumb = await MediaTools.thumbnail(file.uri, out.uri, 300).catch(() => undefined);
    }
    setSource({ ...file, probe, thumb });
    setTarget(probe && !probe.hasVideo ? 'audio' : 'video');
    setStart('');
    setEnd('');
    setMute(false);
  }

  async function pickFromPhotos() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsEditing: false,
      // Keep the original file instead of letting iOS re-encode it first.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (asset) load({ uri: asset.uri, name: asset.fileName ?? 'Video.mov', size: asset.fileSize });
  }

  async function pickFromFiles() {
    const result = await DocumentPicker.getDocumentAsync({ type: ['video/*', 'audio/*'], copyToCacheDirectory: true });
    const asset = result.canceled ? null : result.assets[0];
    if (asset) load({ uri: asset.uri, name: asset.name, size: asset.size ?? undefined });
  }

  async function run() {
    if (!source) return;
    const from = parseTime(start);
    const to = parseTime(end);
    if (from === null || to === null) {
      setStatus({ step: 'error', error: new GrabError('invalid', 'Write times like 0:15 or 1:30, or leave them empty.') });
      return;
    }
    setStatus({ step: 'working', fraction: 0 });
    try {
      const result = await convertFile(
        source,
        { target, maxHeight: VIDEO_SIZES[sizeIndex], gifSize: GIF_SIZES[gifIndex], mute, start: from, end: to },
        (fraction) => setStatus({ step: 'working', fraction })
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStatus({ step: 'done', ...result });
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setStatus({ step: 'error', error: toGrabError(err) });
    }
  }

  const working = status.step === 'working';
  const hasVideo = source?.probe?.hasVideo ?? true;
  const hasAudio = source?.probe?.hasAudio ?? true;
  const probe = source?.probe;
  const details = [
    formatDuration(probe?.duration),
    probe?.hasVideo && probe.width ? `${Math.round(probe.width)}×${Math.round(probe.height)}` : probe && !probe.hasVideo ? 'Audio' : '',
    formatSize(source?.size),
  ]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <Page>
      {!source ? (
        <GlassCard>
          <Notice
            icon="arrow.triangle.2.circlepath"
            color={accent}
            title="Choose something to convert"
            body="Make a video smaller, take the sound out as audio, trim it, or turn it into a GIF. Everything happens on your iPhone."
          />
          <ActionButton prominent title="Choose from Photos" icon="photo.on.rectangle" onPress={pickFromPhotos} />
          <ActionButton title="Choose from Files" icon="folder" onPress={pickFromFiles} />
          <Text style={s.hint}>You can also tap Convert on anything in your Library.</Text>
        </GlassCard>
      ) : (
        <>
          <GlassCard>
            <View style={s.sourceRow}>
              <View style={s.sourceThumb}>
                {source.thumb ? (
                  <Image source={{ uri: source.thumb }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <SymbolView name={hasVideo ? 'film' : 'music.note'} tintColor={colors.secondary} size={24} style={s.icon24} />
                )}
              </View>
              <View style={s.flex}>
                <Text style={s.sourceName} numberOfLines={2}>
                  {source.name}
                </Text>
                <Text style={s.sourceMeta}>{details}</Text>
              </View>
            </View>
            <ActionButton title="Choose a different file" icon="arrow.uturn.backward" disabled={working} onPress={() => setSource(null)} />
          </GlassCard>

          <GlassCard>
            <SectionLabel>Turn it into</SectionLabel>
            <SegmentedControl
              values={['Video', 'Audio', 'GIF']}
              selectedIndex={TARGETS.indexOf(target)}
              onChange={(e) => setTarget(TARGETS[e.nativeEvent.selectedSegmentIndex])}
              enabled={!working && hasVideo}
            />

            {target === 'video' && (
              <>
                <SectionLabel>Size</SectionLabel>
                <SegmentedControl
                  values={['Original', '1080p', '720p', '480p']}
                  selectedIndex={sizeIndex}
                  onChange={(e) => setSizeIndex(e.nativeEvent.selectedSegmentIndex)}
                  enabled={!working}
                />
                <Text style={s.hint}>Smaller sizes make smaller files that are quicker to send. Saves as MP4.</Text>
                {hasAudio && (
                  <View style={s.switchRow}>
                    <Text style={s.switchLabel}>Remove sound</Text>
                    <Switch value={mute} onValueChange={setMute} disabled={working} />
                  </View>
                )}
              </>
            )}
            {target === 'audio' && (
              <Text style={s.hint}>
                {hasAudio
                  ? 'Saves the sound as M4A, the iPhone’s own audio format. It plays in Files, Music apps and WhatsApp.'
                  : 'This video has no sound to take out.'}
              </Text>
            )}
            {target === 'gif' && (
              <>
                <SectionLabel>Size</SectionLabel>
                <SegmentedControl
                  values={['Small', 'Medium', 'Large']}
                  selectedIndex={gifIndex}
                  onChange={(e) => setGifIndex(e.nativeEvent.selectedSegmentIndex)}
                  enabled={!working}
                />
                <Text style={s.hint}>GIFs have no sound and are limited to 20 seconds. Use Start and End to pick the moment.</Text>
              </>
            )}
          </GlassCard>

          <GlassCard>
            <SectionLabel>Trim (optional)</SectionLabel>
            <View style={s.trimRow}>
              <TimeField label="Start" value={start} onChange={setStart} placeholder="0:00" editable={!working} />
              <TimeField label="End" value={end} onChange={setEnd} placeholder={formatDuration(probe?.duration) || 'end'} editable={!working} />
            </View>
          </GlassCard>

          {status.step === 'working' ? (
            <GlassCard>
              <View style={s.progressHead}>
                <Text style={s.progressLabel}>Converting…</Text>
                <Text style={s.progressValue}>{Math.round(status.fraction * 100)}%</Text>
              </View>
              <ProgressBar fraction={status.fraction} />
            </GlassCard>
          ) : (
            <ActionButton
              prominent
              title="Convert"
              icon="arrow.triangle.2.circlepath"
              disabled={(target === 'audio' && !hasAudio) || (target !== 'audio' && !hasVideo)}
              onPress={run}
            />
          )}

          {status.step === 'error' && (
            <GlassCard>
              <Notice icon="exclamationmark.triangle.fill" color={colors.orange} title="Couldn’t convert" body={status.error.message} />
            </GlassCard>
          )}

          {status.step === 'done' && (
            <GlassCard>
              <Notice
                icon="checkmark.circle.fill"
                color={colors.green}
                title={status.inPhotos ? 'Saved to Photos' : 'Saved in GrabIt'}
                body={
                  status.entry.kind === 'audio'
                    ? 'It’s in the Library tab and in Files under On My iPhone › GrabIt.'
                    : status.photosDenied
                      ? 'To also save to Photos, allow it in Settings › GrabIt › Photos. It’s in the Library tab.'
                      : `${formatSize(status.entry.size)}. It’s also in the Library tab.`
                }
              />
              <ActionButton title="Share" icon="square.and.arrow.up" onPress={() => shareAsync(fileOf(status.entry).uri)} />
            </GlassCard>
          )}
        </>
      )}
    </Page>
  );
}

function TimeField({
  label,
  value,
  onChange,
  placeholder,
  editable,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  editable: boolean;
}) {
  return (
    <View style={s.timeField}>
      <Text style={s.timeLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.tertiary}
        keyboardType="numbers-and-punctuation"
        returnKeyType="done"
        editable={editable}
        style={s.timeInput}
      />
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  hint: { fontSize: 14, color: colors.secondary, lineHeight: 19 },
  sourceRow: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  sourceThumb: {
    width: 72,
    height: 72,
    borderRadius: radius.thumb,
    overflow: 'hidden',
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon24: { width: 26, height: 26 },
  sourceName: { fontSize: 16, fontWeight: '600', color: colors.label },
  sourceMeta: { fontSize: 14, color: colors.secondary, marginTop: 3 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchLabel: { fontSize: 17, color: colors.label },
  trimRow: { flexDirection: 'row', gap: 12 },
  timeField: { flex: 1, gap: 6 },
  timeLabel: { fontSize: 14, color: colors.secondary },
  timeInput: {
    fontSize: 17,
    color: colors.label,
    backgroundColor: colors.fill,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontVariant: ['tabular-nums'],
  },
  progressHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  progressLabel: { fontSize: 17, fontWeight: '600', color: colors.label },
  progressValue: { fontSize: 15, color: colors.secondary, fontVariant: ['tabular-nums'] },
});
