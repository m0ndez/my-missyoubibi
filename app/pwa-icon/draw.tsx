// The app icon (the same drawing as icon.svg) as PNG, for places that need a bitmap: installable-app icons and the Apple touch icon.
// Satori (next/og) renders an <img> with an SVG data URI reliably, so the drawing is a string.
export function iconImage(px: number, maskable = false) {
  // A maskable icon is cropped to a shape by the OS: full-bleed background, drawing inside the central 60%.
  const glyph = maskable ? 0.6 : 0.88; // the drawing spans x 12-52, y 24-54: its centre is (32, 39), moved to the middle below
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="${maskable ? 0 : 14}" fill="#007374"/>
<g transform="translate(${32 - 32 * glyph} ${32 - 39 * glyph}) scale(${glyph})" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round">
<path d="M12 24h40v12H12zM20 44c0 6-4 6-4 10M32 44c0 6-4 6-4 10M44 44c0 6-4 6-4 10"/></g></svg>`;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- rendered by Satori, not shown in a page
    <img
      alt=""
      width={px}
      height={px}
      src={`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`}
    />
  );
}
