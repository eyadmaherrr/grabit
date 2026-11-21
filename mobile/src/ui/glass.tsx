import { Button, Host, Label } from '@expo/ui/swift-ui';
import { buttonStyle, controlSize, disabled as disabledModifier, frame, tint } from '@expo/ui/swift-ui/modifiers';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, useColorScheme, View, type StyleProp, type ViewStyle } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { accent, backgrounds, colors, radius, space } from './theme';

const liquidGlass = isLiquidGlassAvailable();

/** Full-screen scrolling page over the soft gradient, with room for the large title and the tab bar. */
export function Page({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const scheme = useColorScheme();
  const backgroundImage = scheme === 'dark' ? backgrounds.dark : backgrounds.light;
  return (
    <View style={[styles.page, { backgroundImage }]}>
      {scroll ? (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}>
          {children}
        </ScrollView>
      ) : (
        children
      )}
    </View>
  );
}

/** A Liquid Glass panel (iOS 26), or a frosted card on older iOS. */
export function GlassCard({
  children,
  style,
  interactive,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  interactive?: boolean;
}) {
  if (liquidGlass) {
    return (
      <GlassView glassEffectStyle="regular" isInteractive={interactive} style={[styles.card, style]}>
        {children}
      </GlassView>
    );
  }
  return <View style={[styles.card, styles.cardFallback, style]}>{children}</View>;
}

/** A native SwiftUI button: glass on iOS 26, bordered on older iOS. Fills the available width. */
export function ActionButton({
  title,
  icon,
  onPress,
  prominent = false,
  disabled = false,
  color,
}: {
  title: string;
  icon?: SFSymbol;
  onPress: () => void;
  prominent?: boolean;
  disabled?: boolean;
  color?: string;
}) {
  const style = prominent ? (liquidGlass ? 'glassProminent' : 'borderedProminent') : liquidGlass ? 'glass' : 'bordered';
  return (
    <Host matchContents={{ vertical: true }} style={styles.buttonHost}>
      <Button
        onPress={onPress}
        modifiers={[buttonStyle(style), controlSize('large'), tint(color ?? accent), disabledModifier(disabled)]}>
        <Label title={title} systemImage={icon} modifiers={[frame({ maxWidth: Infinity })]} />
      </Button>
    </Host>
  );
}

export function ProgressBar({ fraction }: { fraction: number | null }) {
  const pct = fraction === null ? 0.35 : Math.max(0.02, Math.min(1, fraction));
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${pct * 100}%`, opacity: fraction === null ? 0.5 : 1 }]} />
    </View>
  );
}

export function Notice({
  icon,
  color,
  title,
  body,
}: {
  icon: SFSymbol;
  color: string | import('react-native').ColorValue;
  title: string;
  body?: string;
}) {
  return (
    <View style={styles.notice}>
      <SymbolView name={icon} tintColor={color} size={28} style={styles.noticeIcon} />
      <View style={styles.flex}>
        <Text style={styles.noticeTitle}>{title}</Text>
        {body ? <Text style={styles.noticeBody}>{body}</Text> : null}
      </View>
    </View>
  );
}

export function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { flex: 1 },
  content: { padding: space.page, paddingBottom: 140, gap: space.gap },
  card: { borderRadius: radius.card, padding: 18, gap: 14, overflow: 'hidden' },
  cardFallback: {
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  buttonHost: { alignSelf: 'stretch' },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.fill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4, backgroundColor: accent },
  notice: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  noticeIcon: { width: 28, height: 28 },
  noticeTitle: { fontSize: 17, fontWeight: '600', color: colors.label },
  noticeBody: { fontSize: 15, color: colors.secondary, marginTop: 3, lineHeight: 20 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: -4,
  },
});
