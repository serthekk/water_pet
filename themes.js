'use strict';
// Colour themes for the right-click menu and every window (Settings, Customize, info
// card, What's new). Main only: it sends the chosen theme's CSS variables to each
// window's preload, which sets them on <html> (see applyTheme in the preloads).
(function () {
  const THEMES = {
    cream: {
      label: 'Cream & Peach',
      vars: {
        bg: '#fff6ea', card: '#ffffff', ink: '#3b2f2f', muted: '#6b5a5a', line: '#ecdcc6',
        accent: '#b4621c', hover: '#f4a6b8', check: '#e8913a', soft: '#fde8c8',
        grad: 'linear-gradient(90deg, #e8913a, #f4a6b8, #f2c14e)',
      },
    },
    lavender: {
      label: 'Lavender Dream',
      vars: {
        bg: '#f4eefb', card: '#fffbff', ink: '#3e2a52', muted: '#6e5a80', line: '#ddd0ee',
        accent: '#8a4fc4', hover: '#f7c6dc', check: '#a56ad8', soft: '#ebe0f7',
        grad: 'linear-gradient(90deg, #a56ad8, #f29cc0, #ffe08a)',
      },
    },
    blossom: {
      label: 'Cherry Blossom',
      vars: {
        bg: '#fff0f4', card: '#ffffff', ink: '#4a2833', muted: '#7d5a66', line: '#f6d3dd',
        accent: '#d6457a', hover: '#ffe7a8', check: '#e9658f', soft: '#fde0e8',
        grad: 'linear-gradient(90deg, #e9658f, #f7b2c8, #ffe7a8)',
      },
    },
    sunflower: {
      label: 'Sunflower Field',
      vars: {
        bg: '#fffbe6', card: '#ffffff', ink: '#3d3418', muted: '#6e6440', line: '#f2e6a8',
        accent: '#a07800', hover: '#c9e7a5', check: '#e0b100', soft: '#fdf3c2',
        grad: 'linear-gradient(90deg, #f2c230, #ffe07a, #8fc46a)',
      },
    },
    matcha: {
      label: 'Matcha & Rose',
      vars: {
        bg: '#eef5ea', card: '#fbfef9', ink: '#2c3b2a', muted: '#5a6b57', line: '#d3e3cc',
        accent: '#4f7f3f', hover: '#f6c4cf', check: '#6a9a55', soft: '#dfeed8',
        grad: 'linear-gradient(90deg, #6a9a55, #b8d98f, #f6c4cf)',
      },
    },
    harvest: {
      label: 'Autumn Harvest',
      vars: {
        bg: '#fbeedd', card: '#fff8ee', ink: '#3d2416', muted: '#7a5a44', line: '#efd3b0',
        accent: '#b5471b', hover: '#f2c14e', check: '#d2691e', soft: '#f8dfc0',
        grad: 'linear-gradient(90deg, #b5471b, #e8913a, #f2c14e, #8a9a3b)',
      },
    },
    maple: {
      label: 'Cozy Maple',
      vars: {
        bg: '#f7e6dc', card: '#fffaf5', ink: '#40201a', muted: '#7a4f45', line: '#e8c7b6',
        accent: '#a33b20', hover: '#e9b949', check: '#b4532a', soft: '#f2d5c6',
        grad: 'linear-gradient(90deg, #8c2f1c, #c8553d, #e9b949)',
      },
    },
    plum: {
      label: 'Plum & Olive',
      vars: {
        bg: '#f1efe2', card: '#fffdf4', ink: '#33301f', muted: '#67634a', line: '#dcd8bc',
        accent: '#7b3f6e', hover: '#d4dc98', check: '#7d8a2e', soft: '#e6e3cc',
        grad: 'linear-gradient(90deg, #7b3f6e, #c06c84, #d4dc98, #7d8a2e)',
      },
    },
    twilight: {
      label: 'Autumn Twilight',
      dark: true,
      vars: {
        bg: '#2e2238', card: '#3b2d48', ink: '#f6eadf', muted: '#c8b7d1', line: '#5a4668',
        accent: '#f2b84b', hover: '#8e5ea8', check: '#f2b84b', soft: '#45344f',
        grad: 'linear-gradient(90deg, #8e5ea8, #e0709a, #f2b84b)',
      },
    },
  };
  const DEFAULT = 'cream';

  // "My colours": she picks 6 colours, the rest is mixed from them.
  const CUSTOM_KEYS = ['bg', 'card', 'ink', 'accent', 'hover', 'check'];
  const CUSTOM_LABELS = { bg: 'Background', card: 'Panels', ink: 'Text', accent: 'Titles & links', hover: 'Highlight', check: 'Ticks & sliders' };
  const HEX = /^#[0-9a-f]{6}$/;
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const hex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t)); // t = share of b
  const luminance = (h) => { const [r, g, b] = rgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
  // Valid custom colours (bad / missing ones fall back to Cream & Peach).
  function cleanCustom(c) {
    const out = {};
    for (const k of CUSTOM_KEYS) {
      const v = c && typeof c[k] === 'string' ? c[k].toLowerCase() : '';
      out[k] = HEX.test(v) ? v : THEMES[DEFAULT].vars[k];
    }
    return out;
  }
  function customTheme(c) {
    const v = cleanCustom(c);
    return {
      label: 'My colours',
      dark: luminance(v.bg) < 0.4,
      vars: {
        ...v,
        muted: mix(v.ink, v.bg, 0.35),
        line: mix(v.bg, v.ink, 0.15),
        soft: mix(v.bg, v.hover, 0.35),
        grad: `linear-gradient(90deg, ${v.check}, ${v.hover}, ${v.accent})`,
      },
    };
  }

  const IDS = [...Object.keys(THEMES), 'custom'];
  const get = (id, custom) => (id === 'custom' ? customTheme(custom) : THEMES[id] || THEMES[DEFAULT]);
  // What main sends to a window's preload ('theme'): it sets --bg, --card, ... on <html>.
  const payload = (id, custom) => {
    const t = get(id, custom);
    return { id: IDS.includes(id) ? id : DEFAULT, vars: t.vars, dark: !!t.dark };
  };
  const list = (custom) => IDS.map((id) => {
    const t = get(id, custom);
    return { id, label: t.label, vars: t.vars, dark: !!t.dark };
  });

  module.exports = { THEMES, IDS, DEFAULT, CUSTOM_KEYS, CUSTOM_LABELS, cleanCustom, get, payload, list };
})();
