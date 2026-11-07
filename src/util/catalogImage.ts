export function normalizeCatalogImage(image: unknown): string {
  const raw = typeof image === 'string' ? image.trim() : '';
  if (!raw || raw === '[object Object]') return '';
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  const compact = raw.replace(/\s+/g, '');
  if (compact.length > 80 && /^[A-Za-z0-9+/=]+$/.test(compact)) {
    return `data:image/jpeg;base64,${compact}`;
  }
  return '';
}
