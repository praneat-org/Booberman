import type { z } from 'zod';
import { ClientMessage, ServerMessage } from './messages';
import { PROTOCOL_VERSION } from './version';

/** Larger client frames are rejected before JSON.parse (anti-spam). */
export const MAX_CLIENT_MESSAGE_BYTES = 1024;
export const MAX_SERVER_MESSAGE_BYTES = 16 * 1024;

export type ParseError = {
  code: 'BAD_MESSAGE' | 'VERSION_MISMATCH' | 'INVALID_NICKNAME';
  message: string;
};
export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: ParseError };

function fail(code: ParseError['code'], message: string): { ok: false; error: ParseError } {
  return { ok: false, error: { code, message } };
}

function parseWith<T>(schema: z.ZodType<T>, raw: unknown, maxLength: number): ParseResult<T> {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > maxLength) return fail('BAD_MESSAGE', `message longer than ${maxLength}`);
    try {
      value = JSON.parse(raw);
    } catch {
      return fail('BAD_MESSAGE', 'not JSON');
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('BAD_MESSAGE', 'not an object');
  }
  const version = (value as { v?: unknown }).v;
  if (version !== PROTOCOL_VERSION) {
    return fail(
      'VERSION_MISMATCH',
      `expected v${PROTOCOL_VERSION}, got ${JSON.stringify(version)}`,
    );
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const reason = (issue?.code === 'custom' ? issue.params : undefined)?.nicknameReason;
    if (typeof reason === 'string') return fail('INVALID_NICKNAME', `nickname: ${reason}`);
    const path = issue?.path.join('.') || '(root)';
    return fail('BAD_MESSAGE', `${path}: ${issue?.message ?? 'invalid'}`);
  }
  return { ok: true, data: result.data };
}

/** Never throws. Accepts a raw WebSocket string or an already-parsed value. */
export function parseClientMessage(raw: unknown): ParseResult<ClientMessage> {
  return parseWith(ClientMessage, raw, MAX_CLIENT_MESSAGE_BYTES);
}

/** Never throws. Accepts a raw WebSocket string or an already-parsed value. */
export function parseServerMessage(raw: unknown): ParseResult<ServerMessage> {
  return parseWith(ServerMessage, raw, MAX_SERVER_MESSAGE_BYTES);
}
