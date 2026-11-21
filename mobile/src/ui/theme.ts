import { PlatformColor, type ColorValue } from 'react-native';

export const accent = '#0A84FF';

/** iOS system colours, so light and dark mode follow the phone's setting automatically. */
export const colors = {
  label: PlatformColor('label') as ColorValue,
  secondary: PlatformColor('secondaryLabel') as ColorValue,
  tertiary: PlatformColor('tertiaryLabel') as ColorValue,
  separator: PlatformColor('separator') as ColorValue,
  fill: PlatformColor('tertiarySystemFill') as ColorValue,
  green: PlatformColor('systemGreen') as ColorValue,
  red: PlatformColor('systemRed') as ColorValue,
  orange: PlatformColor('systemOrange') as ColorValue,
  blue: PlatformColor('systemBlue') as ColorValue,
};

/** Soft colour behind the glass. Liquid Glass needs something to refract to look right. */
export const backgrounds = {
  light:
    'radial-gradient(circle at 12% 8%, rgba(90,170,255,0.55) 0%, transparent 45%), radial-gradient(circle at 92% 30%, rgba(190,120,255,0.38) 0%, transparent 42%), radial-gradient(circle at 30% 95%, rgba(80,220,200,0.32) 0%, transparent 45%), linear-gradient(180deg, #EEF4FF 0%, #F6F2FF 100%)',
  dark:
    'radial-gradient(circle at 12% 8%, rgba(40,110,255,0.55) 0%, transparent 45%), radial-gradient(circle at 92% 30%, rgba(140,70,255,0.40) 0%, transparent 42%), radial-gradient(circle at 30% 95%, rgba(20,170,160,0.32) 0%, transparent 45%), linear-gradient(180deg, #050B1C 0%, #0B0717 100%)',
};

export const radius = { card: 28, inner: 18, thumb: 14 };
export const space = { page: 16, gap: 14 };
