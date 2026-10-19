import { describe, expect, it, vi } from 'vitest';
import { type ShareEnv, shareRoomLink, usesNativeShare } from './shareLink';

const URL_ = 'http://localhost:5173/room/abc123';

function env(over: Partial<ShareEnv> = {}): ShareEnv {
  return { preferShare: false, ...over };
}
const abort = () => Object.assign(new Error('closed'), { name: 'AbortError' });

describe('shareRoomLink', () => {
  it('phone with navigator.share: opens the share sheet with the link, no clipboard', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeClipboard = vi.fn();
    const out = await shareRoomLink(URL_, env({ preferShare: true, share, writeClipboard }));
    expect(out).toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 'Booberman', url: URL_ });
    expect(writeClipboard).not.toHaveBeenCalled();
  });

  it('calls navigator.share before any await (it needs the click gesture)', () => {
    const share = vi.fn().mockResolvedValue(undefined);
    void shareRoomLink(URL_, env({ preferShare: true, share }));
    expect(share).toHaveBeenCalledTimes(1); // synchronously, before the promise settles
  });

  it('desktop: copies to the clipboard even though navigator.share exists', async () => {
    const share = vi.fn();
    const writeClipboard = vi.fn().mockResolvedValue(undefined);
    const out = await shareRoomLink(URL_, env({ preferShare: false, share, writeClipboard }));
    expect(out).toBe('copied');
    expect(writeClipboard).toHaveBeenCalledWith(URL_);
    expect(share).not.toHaveBeenCalled();
  });

  it('phone without navigator.share: clipboard', async () => {
    const writeClipboard = vi.fn().mockResolvedValue(undefined);
    expect(await shareRoomLink(URL_, env({ preferShare: true, writeClipboard }))).toBe('copied');
  });

  it('closing the share sheet is "cancelled": no clipboard write behind the player\'s back', async () => {
    const writeClipboard = vi.fn();
    const share = vi.fn().mockRejectedValue(abort());
    const out = await shareRoomLink(URL_, env({ preferShare: true, share, writeClipboard }));
    expect(out).toBe('cancelled');
    expect(writeClipboard).not.toHaveBeenCalled();
  });

  it('a share that fails for another reason falls back to the clipboard', async () => {
    const share = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    const writeClipboard = vi.fn().mockResolvedValue(undefined);
    expect(await shareRoomLink(URL_, env({ preferShare: true, share, writeClipboard }))).toBe(
      'copied',
    );
  });

  it('canShare() false skips the sheet', async () => {
    const share = vi.fn();
    const writeClipboard = vi.fn().mockResolvedValue(undefined);
    const out = await shareRoomLink(
      URL_,
      env({ preferShare: true, share, canShare: () => false, writeClipboard }),
    );
    expect(out).toBe('copied');
    expect(share).not.toHaveBeenCalled();
  });

  it('clipboard refused → execCommand → manual', async () => {
    const writeClipboard = vi.fn().mockRejectedValue(new Error('denied'));
    const legacyCopy = vi.fn().mockReturnValue(true);
    expect(await shareRoomLink(URL_, env({ writeClipboard, legacyCopy }))).toBe('copied');
    expect(legacyCopy).toHaveBeenCalledWith(URL_);

    expect(await shareRoomLink(URL_, env({ writeClipboard, legacyCopy: () => false }))).toBe(
      'manual',
    );
    expect(
      await shareRoomLink(
        URL_,
        env({
          legacyCopy: () => {
            throw new Error('no');
          },
        }),
      ),
    ).toBe('manual');
    expect(await shareRoomLink(URL_, env())).toBe('manual');
  });
});

describe('usesNativeShare', () => {
  it('needs both a touch device and navigator.share', () => {
    const share = vi.fn();
    expect(usesNativeShare(env({ preferShare: true, share }))).toBe(true);
    expect(usesNativeShare(env({ preferShare: true }))).toBe(false);
    expect(usesNativeShare(env({ preferShare: false, share }))).toBe(false);
  });
});
