import { timingSafeEqual } from "node:crypto";

export function bearerAuthorized(header: string | undefined, expected: string | undefined) {
  if (!header || !expected || !header.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const wanted = Buffer.from(expected);
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}
