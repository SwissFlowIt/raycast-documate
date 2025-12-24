export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function parseSearchText(input: string): {
  phrases: string[];
  terms: string[];
} {
  const phrases: string[] = [];
  const re = /"([^"]+)"/g;

  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    const phrase = (match[1] ?? "").trim();
    if (phrase) phrases.push(phrase);
  }

  const withoutPhrases = input.replace(re, " ");
  const terms = withoutPhrases
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  return { phrases, terms };
}
