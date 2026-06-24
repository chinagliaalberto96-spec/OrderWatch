import { fallbackTokens } from "./tokens";

export function createTheme(theme = {}) {
  const tokens = { ...fallbackTokens, ...theme };

  return Object.entries(tokens).reduce((acc, [key, value]) => {
    const cssName = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    acc[`--color-${cssName}`] = value;
    return acc;
  }, {});
}
