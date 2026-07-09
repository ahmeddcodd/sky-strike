import "./style.css";
import { PlayablesSDK } from "./systems/PlayablesSDK";
import { GameApp } from "./game/GameApp";

// The Playables wrapper initializes before any game code so lifecycle signals
// (firstFrameReady / gameReady) fire at the right moments (spec §43).
const playables = new PlayablesSDK();
playables.init();

const canvas = document.getElementById("game") as HTMLCanvasElement;
try {
  new GameApp(canvas, playables).start();
} catch (e) {
  // never trap the user behind the loader if boot fails
  document.getElementById("loader")?.classList.add("done");
  throw e;
}
