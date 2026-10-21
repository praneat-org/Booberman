# Asset credits

Audio is CC0 (Kenney). The sprite sheet is NOT free to use: it is ripped from NES Bomberman (Hudson Soft)
and is here for internal testing only, overriding D11 for this build. Do not ship it in a public release;
swap back to a CC0 sheet first.

## NES Bomberman sprite sheet

`public/tiles/tileset.png` is built from "NES - Bomberman - Miscellaneous - General Sprites" (ripped by
Black Squirrel and SuperJustinBros, https://www.spriters-resource.com/nes/bomberman/asset/7884/):
cropped to 224×368 (14×23 cells of 16px, no spacing), both background greens made transparent, cell 13
filled with the floor green and cell 27 replaced by a down-arrow player marker. Frame indices are in
`src/assets/sheetFrames.ts`.

## Audio (FE-18)

`public/audio/*.ogg` are unmodified copies of Kenney (CC0) sound effects from his official starter-kit repositories on
GitHub; `*.mp3` are re-encodes of the same files for browsers without Ogg Vorbis. Source repo, commit, path and sha256 of
every file, plus the license text those repositories ship, are in `public/audio/LICENSE.txt` (kept next to the files so
it is also deployed with them).
