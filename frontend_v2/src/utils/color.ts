export function normalizeHexColor(color: string, fallback: string) {
    const normalized = color.trim();
    const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized;
    if (/^[0-9a-fA-F]{3}$/.test(hex) || /^[0-9a-fA-F]{6}$/.test(hex)) {
        return `#${hex}`;
    }
    return fallback;
}

export function colorWithAlpha(color: string, alpha: number, fallback: string) {
    const normalized = normalizeHexColor(color, fallback);
    const hex = normalized.slice(1);
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
        const [r, g, b] = hex.split('').map((part) => parseInt(part + part, 16));
        return `rgba(${r},${g},${b},${alpha})`;
    }
    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }
    return fallback;
}
