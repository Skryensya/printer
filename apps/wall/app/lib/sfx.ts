// Central sound-effects palette for Ping. Every interaction routes through here
// so volumes stay coherent and the whole thing is muted in one place.
//
// Sounds are soundcn.xyz assets (https://soundcn.xyz), all Kenney CC0. Each is a
// tiny base64 data URI decoded lazily by the Web Audio engine. Calls are
// fire-and-forget and swallow errors — audio must never break an interaction,
// and the first one only lands once the user has gestured (audio-context unlock).

import { playSound } from "~/lib/sound-engine";
import type { SoundAsset } from "~/lib/sound-types";
import { select006Sound } from "~/lib/select-006";
import { select007Sound } from "~/lib/select-007";
import { switchOnSound } from "~/lib/switch-on";
import { switchOffSound } from "~/lib/switch-off";
import { errorBuzzSound } from "~/lib/error-buzz";
import { minimize001Sound } from "~/lib/minimize-001";

// Semantic name → asset + per-sound volume. Volumes are tuned low; these fire on
// every tap, so they sit under the UI rather than announce themselves.
const SFX = {
  tap:       { sound: select007Sound,  volume: 0.35 }, // generic clicks / taps
  send:      { sound: select006Sound,  volume: 0.5  }, // a ping leaves — the "ping"
  toggleOn:  { sound: switchOnSound,   volume: 0.35 }, // theme → dark
  toggleOff: { sound: switchOffSound,  volume: 0.35 }, // theme → light
  error:     { sound: errorBuzzSound,  volume: 0.4  }, // a send / sign-in failed
  remove:    { sound: minimize001Sound, volume: 0.4 }, // a slip leaves the view
} satisfies Record<string, { sound: SoundAsset; volume: number }>;

export type SfxName = keyof typeof SFX;

// Play a named effect. Fire-and-forget; ignores audio errors (no context yet,
// autoplay policy, decode failure — none of these should surface to the user).
export function playSfx(name: SfxName): void {
  const { sound, volume } = SFX[name];
  void playSound(sound.dataUri, { volume }).catch(() => { /* no audio */ });
}
