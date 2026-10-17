const LIMIT = 2_147_483_647;
let nextIndex = Math.floor(Date.now() % LIMIT);

/** Generate a bounded client order index rather than reusing a fixed market ID. */
export function nextClientOrderIndex(): number {
  const result = nextIndex;
  nextIndex = (nextIndex + 1) % LIMIT;
  return result;
}
