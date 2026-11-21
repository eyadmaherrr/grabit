import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { refreshLibrary, thumbOf, useLibrary, type Entry } from '@/lib/library';
import { formatDate, formatDuration, formatSize } from '@/ui/format';
import { GlassCard, Notice, Page } from '@/ui/glass';
import { accent, colors, radius } from '@/ui/theme';

const ICONS = { video: 'film', audio: 'music.note', image: 'photo', gif: 'sparkles.rectangle.stack' } as const;
const NAMES = { video: 'Video', audio: 'Audio', image: 'Photo', gif: 'GIF' } as const;

export default function LibraryScreen() {
  const entries = useLibrary();
  // Pick up files deleted in the Files app.
  useFocusEffect(useCallback(() => refreshLibrary(), []));

  return (
    <Page>
      {entries.length === 0 ? (
        <GlassCard>
          <Notice
            icon="square.stack"
            color={accent}
            title="Nothing here yet"
            body="Everything you download or convert shows up here. Files are also in the Files app under On My iPhone › GrabIt."
          />
        </GlassCard>
      ) : (
        entries.map((entry) => <Row key={entry.id} entry={entry} />)
      )}
    </Page>
  );
}

function Row({ entry }: { entry: Entry }) {
  const thumb = thumbOf(entry);
  const meta = [NAMES[entry.kind], formatDuration(entry.duration), formatSize(entry.size), formatDate(entry.createdAt)]
    .filter(Boolean)
    .join('  ·  ');
  return (
    <Pressable onPress={() => router.push({ pathname: '/library/[id]', params: { id: entry.id } })}>
      <GlassCard style={s.row} interactive>
        <View style={s.thumb}>
          {thumb?.exists ? (
            <Image source={{ uri: thumb.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <SymbolView name={ICONS[entry.kind]} tintColor={accent} size={24} style={s.icon} />
          )}
        </View>
        <View style={s.text}>
          <Text style={s.title} numberOfLines={2}>
            {entry.title}
          </Text>
          <Text style={s.meta} numberOfLines={1}>
            {meta}
          </Text>
        </View>
        <SymbolView name="chevron.right" tintColor={colors.tertiary} size={14} style={s.chevron} />
      </GlassCard>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: 24 },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: radius.thumb,
    overflow: 'hidden',
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { width: 26, height: 26 },
  text: { flex: 1, gap: 4 },
  title: { fontSize: 16, fontWeight: '600', color: colors.label },
  meta: { fontSize: 13, color: colors.secondary },
  chevron: { width: 14, height: 14 },
});
