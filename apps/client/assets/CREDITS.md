# Asset credits

All art and audio must be CC0 (D11) — Kenney (https://kenney.nl/assets) preferred. Never use sprites ripped from other games.

## Tiny Dungeon (FE-26)

`public/tiles/tileset.png` is the original 203×186 tilemap from Kenney's Tiny Dungeon pack
(https://kenney.nl/assets/tiny-dungeon), used at its native 16×16 tile size with 1px spacing.
The game renders the source tiles directly: floor 50, wall 14, player 84, crate 63, barrel 66,
torch frames 106–107, curse skull 19, boot 125, and player marker 60. The Phaser client uses a
single sprite sheet so no placeholder or hand-drawn art is generated.

The pack's license is included in `LICENSE-kenney-tiny-dungeon.txt`.

## Audio (FE-18)

`public/audio/*.ogg` are unmodified copies of Kenney (CC0) sound effects from his official starter-kit repositories on
GitHub; `*.mp3` are re-encodes of the same files for browsers without Ogg Vorbis. Source repo, commit, path and sha256 of
every file, plus the license text those repositories ship, are in `public/audio/LICENSE.txt` (kept next to the files so
it is also deployed with them).
