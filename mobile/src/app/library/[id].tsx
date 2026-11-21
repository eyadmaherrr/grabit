import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { shareAsync } from 'expo-sharing';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { fileOf, getEntry, removeEntry, updateEntry, type Entry } from '@/lib/library';
import { saveToPhotos } from '@/lib/save';
import { formatDate, formatDuration, formatSize } from '@/ui/format';
import { ActionButton, GlassCard, Notice } from '@/ui/glass';
import { colors, radius } from '@/ui/theme';

export default function EntryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const entry = id ? getEntry(id) : undefined;
  if (!entry) {
    return (
      <View style={s.missing}>
        <Notice icon="questionmark.folder" color={colors.secondary} title="This file is gone" body="It may have been deleted in the Files app." />
      </View>
    );
  }
  return <EntryDetail entry={entry} />;
}

function EntryDetail({ entry }: { entry: Entry }) {
  const file = fileOf(entry);
  const playable = entry.kind === 'video' || entry.kind === 'audio';
  const player = useVideoPlayer(playable ? file.uri : null, (p) => {
    p.loop = false;
  });
  const [photos, setPhotos] = useState<'idle' | 'saved' | 'denied' | 'failed'>(entry.inPhotos ? 'saved' : 'idle');

  async function addToPhotos() {
    const result = await saveToPhotos(file);
    if (result.ok) {
      updateEntry(entry.id, { inPhotos: true });
      setPhotos('saved');
    } else {
      setPhotos(result.denied ? 'denied' : 'failed');
    }
  }

  function confirmDelete() {
    Alert.alert('Delete from GrabIt?', entry.inPhotos ? 'The copy in your Photos stays.' : undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          removeEntry(entry.id);
          router.back();
        },
      },
    ]);
  }

  const meta = [entry.siteName, formatDuration(entry.duration), formatSize(entry.size), formatDate(entry.createdAt)]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <ScrollView contentContainerStyle={s.content} contentInsetAdjustmentBehavior="automatic">
      <Stack.Screen options={{ title: '' }} />
      <View style={[s.media, entry.kind === 'audio' && s.audioMedia]}>
        {playable ? (
          <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls contentFit="contain" />
        ) : (
          <Image source={{ uri: file.uri }} style={StyleSheet.absoluteFill} contentFit="contain" autoplay />
        )}
      </View>

      <View style={s.textBlock}>
        <Text style={s.title}>{entry.title}</Text>
        <Text style={s.meta}>{meta}</Text>
      </View>

      <GlassCard>
        {entry.kind !== 'audio' &&
          (photos === 'saved' ? (
            <Notice icon="checkmark.circle.fill" color={colors.green} title="In your Photos" />
          ) : (
            <ActionButton prominent title="Save to Photos" icon="photo.badge.plus" onPress={addToPhotos} />
          ))}
        {photos === 'denied' && (
          <Text style={s.hint}>GrabIt isn’t allowed to add to Photos. Turn it on in Settings › GrabIt › Photos › Add Photos Only.</Text>
        )}
        {photos === 'failed' && <Text style={s.hint}>Photos didn’t accept this file. You can still share it.</Text>}
        <ActionButton prominent={entry.kind === 'audio'} title="Share" icon="square.and.arrow.up" onPress={() => shareAsync(file.uri)} />
        {entry.kind !== 'image' && (
          <ActionButton
            title="Convert"
            icon="arrow.triangle.2.circlepath"
            onPress={() => {
              router.back();
              router.navigate({ pathname: '/convert', params: { entry: entry.id } });
            }}
          />
        )}
        <ActionButton title="Delete" icon="trash" color="#FF3B30" onPress={confirmDelete} />
      </GlassCard>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  missing: { flex: 1, padding: 24, justifyContent: 'center' },
  media: { width: '100%', aspectRatio: 1, borderRadius: radius.card, overflow: 'hidden', backgroundColor: '#000' },
  audioMedia: { aspectRatio: 2.2 },
  textBlock: { gap: 4 },
  title: { fontSize: 20, fontWeight: '700', color: colors.label },
  meta: { fontSize: 14, color: colors.secondary },
  hint: { fontSize: 14, color: colors.secondary, lineHeight: 19 },
});
