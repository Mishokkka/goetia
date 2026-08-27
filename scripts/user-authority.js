export function activeAuthoritativeGm() {
  const collection = game.users;
  const users = Array.isArray(collection?.contents)
    ? collection.contents
    : Array.isArray(collection)
      ? collection
      : Array.from(collection?.values?.() ?? []);
  return users
    .filter((user) => user?.active && user?.isGM)
    .sort((first, second) => String(first.id).localeCompare(String(second.id)))[0] ?? null;
}

export function isAuthoritativeGm() {
  const gm = activeAuthoritativeGm();
  return Boolean(game.user?.isGM && gm?.id === game.user.id);
}
