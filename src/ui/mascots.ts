/** Elecia's small cast, built from one shape kit (leaf, petal, circle, curve) as light inline SVG. */

export function sprig(size = 120): string {
  return `<svg class="mascot sprig" width="${size}" viewBox="0 0 120 170" role="img" aria-label="Sprig, a friendly seedling">
  <g class="sway"><path d="M60 150 C58 120 62 100 60 78" stroke="var(--leaf)" stroke-width="7" fill="none" stroke-linecap="round"/>
  <path d="M60 96 C30 96 18 70 24 48 C50 50 62 70 60 96Z" fill="var(--leaf-soft)"/>
  <path d="M60 80 C90 82 104 56 98 32 C70 34 58 56 60 80Z" fill="var(--leaf)"/></g>
  <ellipse cx="60" cy="152" rx="34" ry="10" fill="var(--sun)"/>
  <circle cx="48" cy="146" r="2.6" fill="var(--ink)"/><circle cx="72" cy="146" r="2.6" fill="var(--ink)"/>
  <path d="M52 152 Q60 158 68 152" stroke="var(--ink)" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>`;
}

export function tally(size = 72): string {
  return `<svg class="mascot tally" width="${size}" viewBox="0 0 100 80" role="img" aria-label="Tally, a counting bee">
  <ellipse cx="38" cy="26" rx="18" ry="11" fill="var(--sky-soft)" transform="rotate(-20 38 26)"/>
  <ellipse cx="62" cy="26" rx="18" ry="11" fill="var(--sky-soft)" transform="rotate(20 62 26)"/>
  <ellipse cx="50" cy="48" rx="28" ry="22" fill="var(--sun)"/>
  <path d="M38 30 V66 M52 27 V69 M66 31 V65" stroke="var(--ink)" stroke-width="7" stroke-linecap="round"/>
  <circle cx="30" cy="44" r="3" fill="var(--ink)"/><circle cx="42" cy="44" r="3" fill="var(--ink)"/></svg>`;
}

export function dusk(size = 120): string {
  return `<svg class="mascot dusk" width="${size}" viewBox="0 0 120 140" role="img" aria-label="Dusk, a calm owl">
  <path d="M60 12 C30 12 16 40 18 76 C20 112 40 128 60 128 C80 128 100 112 102 76 C104 40 90 12 60 12Z" fill="var(--owl)"/>
  <path d="M60 76 C46 76 36 96 44 112 C52 122 68 122 76 112 C84 96 74 76 60 76Z" fill="var(--owl-belly)"/>
  <circle cx="44" cy="50" r="15" fill="var(--owl-belly)"/><circle cx="76" cy="50" r="15" fill="var(--owl-belly)"/>
  <circle cx="44" cy="52" r="6" fill="var(--ink)"/><circle cx="76" cy="52" r="6" fill="var(--ink)"/>
  <path d="M55 62 L60 72 L65 62Z" fill="var(--sun)"/>
  <path d="M26 20 L38 34 M94 20 L82 34" stroke="var(--owl)" stroke-width="8" stroke-linecap="round"/></svg>`;
}
