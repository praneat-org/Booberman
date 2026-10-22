import { describe, expect, it } from 'vitest';
import { type NoticeKind, noticeFor, SERVER_REJECTED_NICKNAME_MESSAGE } from './entryNotice';

const KINDS: NoticeKind[] = [
  'NOT_FOUND',
  'ROOM_FULL',
  'CONNECT_FAILED',
  'VERSION_MISMATCH',
  'CONNECTION_LOST',
];

describe('noticeFor', () => {
  it('every dead end has a title, a message, one primary button and a way home', () => {
    for (const kind of KINDS) {
      for (const canCreate of [true, false]) {
        const n = noticeFor(kind, 'abc123', canCreate);
        expect(n.title, kind).not.toBe('');
        expect(n.message, kind).not.toBe('');
        expect(
          n.actions.filter((a) => a.primary),
          kind,
        ).toHaveLength(1);
        expect(n.actions[0]?.primary, kind).toBe(true);
        expect(
          n.actions.some((a) => a.id === 'home'),
          kind,
        ).toBe(true);
      }
    }
  });

  it('room full: says it is full, names the room and the limit, offers a new room first', () => {
    const n = noticeFor('ROOM_FULL', 'abc123', true);
    expect(n.title).toBe('ห้องเต็มแล้ว');
    expect(n.message).toContain('abc123');
    expect(n.message).toContain('4 คน');
    expect(n.message).toContain('สร้างห้องใหม่');
    expect(n.actions.map((a) => a.id)).toEqual(['create', 'retry', 'home']);
  });

  it('not found: offers "create" only when we have a name to create with', () => {
    expect(noticeFor('NOT_FOUND', undefined, true).actions.map((a) => a.id)).toEqual([
      'create',
      'home',
    ]);
    const noName = noticeFor('NOT_FOUND', undefined, false);
    expect(noName.actions.map((a) => a.id)).toEqual(['home']);
    expect(noName.message).toContain('ใส่ชื่อ');
  });

  it('connection problems offer a retry; a version problem offers a reload', () => {
    expect(noticeFor('CONNECT_FAILED', 'abc123', true).actions[0]?.id).toBe('retry');
    expect(noticeFor('CONNECTION_LOST', 'abc123', true).actions[0]?.id).toBe('retry');
    expect(noticeFor('VERSION_MISMATCH', 'abc123', true).actions[0]?.id).toBe('reload');
  });

  it('the server-rejected-name hint repeats the rules', () => {
    expect(SERVER_REJECTED_NICKNAME_MESSAGE).toContain('12');
  });
});
