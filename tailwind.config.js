/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./services/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeInDown: {
          '0%': { opacity: '0', transform: 'translateY(-16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(24px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        popIn: {
          '0%': { opacity: '0', transform: 'scale(0.85)' },
          '50%': { transform: 'scale(1.03)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        wiggle: {
          '0%, 100%': { transform: 'rotate(0deg)' },
          '25%': { transform: 'rotate(-3deg)' },
          '75%': { transform: 'rotate(3deg)' },
        },
        breathe: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.8' },
          '50%': { transform: 'scale(1.05)', opacity: '1' },
        },
        iconSpin: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        borderGlow: {
          '0%, 100%': { borderColor: 'rgba(56, 189, 248, 0.2)' },
          '50%': { borderColor: 'rgba(56, 189, 248, 0.6)' },
        },
      },
      animation: {
        fadeIn: 'fadeIn 0.3s ease-out',
        fadeInUp: 'fadeInUp 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        fadeInDown: 'fadeInDown 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        slideUp: 'slideUp 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        popIn: 'popIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        shimmer: 'shimmer 2s ease-in-out infinite',
        float: 'float 3s ease-in-out infinite',
        wiggle: 'wiggle 1s ease-in-out',
        breathe: 'breathe 3s ease-in-out infinite',
        iconSpin: 'iconSpin 8s linear infinite',
        borderGlow: 'borderGlow 2s ease-in-out infinite',
      },
      transitionTimingFunction: {
        'bounce-in': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        'smooth-out': 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
}

