import '@/lib/polyfills';

import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { useColorScheme } from 'react-native';

import { accent } from '@/ui/theme';

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <NativeTabs tintColor={accent} minimizeBehavior="onScrollDown">
        <NativeTabs.Trigger name="(download)">
          <NativeTabs.Trigger.Label>Download</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: 'arrow.down.circle', selected: 'arrow.down.circle.fill' }} />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="convert">
          <NativeTabs.Trigger.Label>Convert</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="arrow.triangle.2.circlepath" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="library">
          <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: 'square.stack', selected: 'square.stack.fill' }} />
        </NativeTabs.Trigger>
      </NativeTabs>
    </ThemeProvider>
  );
}
