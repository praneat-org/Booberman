import type Phaser from 'phaser';
import { cardRect, type HudCard, type HudView } from '../view/hudView';
import { CANVAS_WIDTH_PX } from '../view/layout';
import { CURSE_COLOR } from './CurseFrames';

const FONT = { fontFamily: 'monospace', fontSize: '8px' };
const STATUS_LABEL = { alive: 'ALIVE', dead: 'DEAD', cursed: 'CURSE' } as const;
const STATUS_COLOR = { alive: '#7CFC7C', dead: '#808080', cursed: '#D58BFF' } as const;
const CARD_TOP = 14;
const MAX_CARDS = 4;

interface Slot {
  bg: Phaser.GameObjects.Rectangle;
  swatch: Phaser.GameObjects.Rectangle;
  name: Phaser.GameObjects.Text;
  status: Phaser.GameObjects.Text;
}

/** HUD strip: round time on top, one card per player below (name, colour, status, curse seconds). */
export class Hud {
  private readonly time: Phaser.GameObjects.Text;
  private readonly slots: Slot[] = [];

  constructor(scene: Phaser.Scene) {
    this.time = scene.add
      .text(CANVAS_WIDTH_PX / 2, 7, '--:--', { ...FONT, fontSize: '10px', color: '#ffffff' })
      .setOrigin(0.5);
    for (let i = 0; i < MAX_CARDS; i++) {
      const r = cardRect(i, CANVAS_WIDTH_PX, CARD_TOP);
      const bg = scene.add.rectangle(r.x, r.y, r.w, r.h, 0x2a2a48).setOrigin(0, 0);
      const swatch = scene.add.rectangle(r.x + 3, r.y + 6, 6, 6, 0xffffff).setOrigin(0, 0);
      const name = scene.add.text(r.x + 12, r.y + r.h / 2, '', { ...FONT, color: '#ffffff' });
      name.setOrigin(0, 0.5);
      const status = scene.add.text(r.x + r.w - 3, r.y + r.h / 2, '', FONT).setOrigin(1, 0.5);
      this.slots.push({ bg, swatch, name, status });
    }
    this.update({ time: '--:--', cards: [] });
  }

  update(view: HudView): void {
    this.time.setText(view.time);
    this.slots.forEach((slot, i) => {
      const card = view.cards[i];
      const shown = card !== undefined;
      for (const o of [slot.bg, slot.swatch, slot.name, slot.status]) o.setVisible(shown);
      if (card) this.paint(slot, card);
    });
  }

  private paint(slot: Slot, card: HudCard): void {
    const dead = card.status === 'dead';
    slot.swatch.setFillStyle(card.color).setAlpha(dead ? 0.4 : 1);
    slot.name.setText(card.name).setAlpha(dead ? 0.5 : 1);
    slot.bg.setStrokeStyle(
      1,
      card.status === 'cursed' ? CURSE_COLOR : card.isSelf ? 0xffffff : 0x2a2a48,
    );
    const label =
      card.status === 'cursed'
        ? `${STATUS_LABEL.cursed} ${card.curseSeconds}s`
        : STATUS_LABEL[card.status];
    slot.status.setText(label).setColor(STATUS_COLOR[card.status]);
  }
}
