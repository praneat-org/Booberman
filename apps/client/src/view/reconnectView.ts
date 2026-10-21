export const RECONNECTING_TITLE = 'กำลังเชื่อมต่อใหม่…';

/** Whole seconds left until `deadline` (rounded up, never below 0). */
export function secondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** The line under the title; says what is happening and how long we keep trying. */
export function reconnectingText(seconds: number): string {
  return `การเชื่อมต่อขาด กำลังพาเข้าห้องเดิม ลองต่ออีกไม่เกิน ${seconds} วินาที`;
}
