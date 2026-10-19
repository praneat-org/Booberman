/** What happened when the player pressed "copy / share link". */
export type ShareOutcome =
  /** The OS share sheet took it (`navigator.share`). */
  | 'shared'
  /** The link is on the clipboard. */
  | 'copied'
  /** The player closed the share sheet; not an error, say nothing. */
  | 'cancelled'
  /** Nothing could write the clipboard; the UI must show the link for the player to copy by hand. */
  | 'manual';

/** The browser features the share button uses, as plain functions so tests can pass fakes. */
export interface ShareEnv {
  /** `navigator.share` bound, when present. */
  share?: (data: { title: string; url: string }) => Promise<void>;
  /** `navigator.canShare` bound, when present. */
  canShare?: (data: { title: string; url: string }) => boolean;
  /** True on a phone / tablet (primary pointer is a finger). Desktop browsers have `navigator.share` too, but copying is what people expect there. */
  preferShare: boolean;
  /** `navigator.clipboard.writeText` bound; absent on insecure origins (plain http on a LAN IP). */
  writeClipboard?: (text: string) => Promise<void>;
  /** Old `execCommand('copy')` route; returns whether it worked. */
  legacyCopy?: (text: string) => boolean;
}

const SHARE_TITLE = 'Booberman';

/** Whether pressing the button opens the OS share sheet (so the label can say "share"). */
export function usesNativeShare(env: ShareEnv): boolean {
  return env.preferShare && typeof env.share === 'function';
}

function isAbort(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
  );
}

/**
 * Phone: the share sheet (`navigator.share`), falling back to the clipboard if it is unavailable or
 * fails. Desktop: the clipboard, then `execCommand`, then `manual` (UI shows the link to select).
 *
 * `navigator.share` needs a user gesture, so it is called before the first `await`: call this
 * straight from the click handler.
 */
export async function shareRoomLink(url: string, env: ShareEnv): Promise<ShareOutcome> {
  if (usesNativeShare(env)) {
    const data = { title: SHARE_TITLE, url };
    try {
      if (!env.canShare || env.canShare(data)) {
        await env.share?.(data);
        return 'shared';
      }
    } catch (err) {
      if (isAbort(err)) return 'cancelled';
      // any other failure: fall through to the clipboard
    }
  }
  try {
    if (env.writeClipboard) {
      await env.writeClipboard(url);
      return 'copied';
    }
  } catch {
    // permission denied / document not focused: try the old way
  }
  try {
    if (env.legacyCopy?.(url)) return 'copied';
  } catch {
    // nothing left to try
  }
  return 'manual';
}

/** `document.execCommand('copy')` through a throw-away textarea; works where `navigator.clipboard` does not. */
function execCommandCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.append(area);
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } finally {
    area.remove();
  }
}

/** The real browser, with every lookup guarded: any of these accessors can throw in odd embeds. */
export function browserShareEnv(): ShareEnv {
  const env: ShareEnv = { preferShare: false };
  try {
    const nav = navigator;
    if (typeof nav.share === 'function') env.share = (d) => nav.share(d);
    if (typeof nav.canShare === 'function') env.canShare = (d) => nav.canShare(d);
    if (typeof nav.clipboard?.writeText === 'function') {
      env.writeClipboard = (text) => nav.clipboard.writeText(text);
    }
  } catch {
    // leave what we found so far
  }
  try {
    env.preferShare = window.matchMedia('(pointer: coarse)').matches;
  } catch {
    // no matchMedia: treat as desktop
  }
  if (typeof document !== 'undefined') env.legacyCopy = execCommandCopy;
  return env;
}
