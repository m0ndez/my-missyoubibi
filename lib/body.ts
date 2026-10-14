// Request bodies in this app are tiny. Refuse a larger one before parsing it, so one request from anything on the LAN (the login
// route is open to all of it) can't make the server buffer megabytes.
export const MAX_BODY = 8 * 1024;

// The body as text, or null if it is bigger than `max` bytes. Reads as a stream, so a missing or lying Content-Length doesn't help.
export async function readText(req: Request, max = MAX_BODY): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? 0) > max) return null;
  const reader = req.body?.getReader();
  if (!reader) return "";
  const dec = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    text += dec.decode(value, { stream: true });
  }
  return text + dec.decode();
}

// Parsed JSON, or null when the body is too big or isn't JSON.
// Typed `any` like Request.json(): every route validates the shape itself.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJson(req: Request, max = MAX_BODY): Promise<any> {
  const text = await readText(req, max);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// A form post (what the login page sends), or null when the body is too big.
export async function readForm(req: Request): Promise<URLSearchParams | null> {
  const text = await readText(req);
  return text === null ? null : new URLSearchParams(text);
}
