/**
 * Field Executive — Design System
 * Modern professional palette: emerald green brand + slate neutrals.
 * Single source of truth for colors, spacing, radius, typography & shadows.
 */

export const colors = {
  // Brand (emerald green)
  primary: '#1E8A46',
  primaryDark: '#14612F',
  primaryDeep: '#0F4A25',
  primaryLight: '#3FB943',
  primarySoft: '#E8F6EC', // tinted surface
  primaryTint: 'rgba(30, 138, 70, 0.08)',

  // Gradient stops (brand)
  gradient: ['#1E8A46', '#3FB943'],
  gradientDark: ['#14612F', '#1E8A46'],

  // Neutrals (slate)
  ink: '#0F172A', // strongest headings
  text: '#334155', // body text
  muted: '#64748B', // secondary text
  faint: '#94A3B8', // placeholders / hints
  border: '#E2E8F0',
  divider: '#EEF2F6',

  // Surfaces
  bg: '#F1F5F9', // app background
  surface: '#FFFFFF',
  surfaceAlt: '#F8FAFC',

  // Semantic
  success: '#16A34A',
  successBg: '#ECFDF5',
  danger: '#EF4444',
  dangerBg: '#FEF2F2',
  warning: '#F59E0B',
  warningBg: '#FFFBEB',
  info: '#0EA5E9',
  infoBg: '#F0F9FF',

  white: '#FFFFFF',
  black: '#000000',
  overlay: 'rgba(15, 23, 42, 0.45)',
};

// Task Monitoring status colors
export const statusColors = {
  Approved: { fg: '#16A34A', bg: '#ECFDF5', dot: '#16A34A' },
  Pending: { fg: '#B45309', bg: '#FFFBEB', dot: '#F59E0B' },
  'Not Approved': { fg: '#DC2626', bg: '#FEF2F2', dot: '#EF4444' },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
};

export const typography = {
  // System font — reliable & crisp on both platforms
  h1: { fontSize: 24, fontWeight: '700' },
  h2: { fontSize: 20, fontWeight: '700' },
  h3: { fontSize: 17, fontWeight: '600' },
  title: { fontSize: 15, fontWeight: '600' },
  body: { fontSize: 14, fontWeight: '400' },
  label: { fontSize: 13, fontWeight: '500' },
  caption: { fontSize: 12, fontWeight: '400' },
  tiny: { fontSize: 10, fontWeight: '600' },
};

// Cross-platform elevation helper
export const shadow = {
  sm: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  md: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 5,
  },
  lg: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 10,
  },
  brand: {
    shadowColor: '#1E8A46',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
};

const theme = { colors, statusColors, spacing, radius, typography, shadow };
export default theme;
