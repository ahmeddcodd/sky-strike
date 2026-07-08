import { INPUT } from "../game/Constants";

// Adaptive controls (spec §8):
// - Mouse ("desktop") mode: the crosshair follows the mouse directly (the OS
//   cursor is hidden by the HUD), hold any button to fire.
// - Touch mode: touch anywhere and drag — the crosshair moves with the finger's
//   delta (so the finger never covers the target); holding fires.
// The mode follows the last-used pointer type, so hybrid laptops switch live.

export class InputSystem {
  /** Smoothed crosshair position in CSS pixels (1:1 with render pixels). */
  x = 0;
  y = 0;
  firing = false;

  /** True when touch is driving the game; false = mouse mode. */
  touchMode: boolean;

  /** Fired on every pointerdown — used to unlock audio on mobile. */
  onPointerDown: () => void = () => {};
  /** Fired when the control scheme flips between touch and mouse. */
  onModeChange: (touch: boolean) => void = () => {};

  private targetX = 0;
  private targetY = 0;
  private lastX = 0;
  private lastY = 0;
  private activePointer: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    // devices without hover + fine pointer start in touch mode
    this.touchMode = !window.matchMedia("(hover: hover) and (pointer: fine)").matches;

    canvas.addEventListener("pointerdown", (e) => {
      this.syncMode(e);
      if (this.activePointer !== null) return;
      this.activePointer = e.pointerId;
      this.firing = true;
      if (this.touchMode) {
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      } else {
        this.followPointer(e);
      }
      this.onPointerDown();
    });

    // move/up on window so drags that leave the canvas aren't dropped
    window.addEventListener("pointermove", (e) => {
      this.syncMode(e);
      if (!this.touchMode) {
        this.followPointer(e); // mouse mode: crosshair tracks the cursor, button or not
        return;
      }
      if (e.pointerId !== this.activePointer) return;
      this.targetX += (e.clientX - this.lastX) * INPUT.DRAG_GAIN;
      this.targetY += (e.clientY - this.lastY) * INPUT.DRAG_GAIN;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.clampTarget();
    });

    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.activePointer) return;
      this.activePointer = null;
      this.firing = false;
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("resize", () => this.clampTarget());
  }

  /** Switches the control scheme to match the pointer that's actually in use. */
  private syncMode(e: PointerEvent): void {
    const touch = e.pointerType !== "mouse";
    if (touch === this.touchMode) return;
    this.touchMode = touch;
    this.onModeChange(touch);
  }

  private followPointer(e: PointerEvent): void {
    this.targetX = e.clientX;
    this.targetY = e.clientY;
    this.clampTarget();
  }

  center(): void {
    this.targetX = window.innerWidth / 2;
    this.targetY = window.innerHeight * 0.42;
    this.x = this.targetX;
    this.y = this.targetY;
  }

  private clampTarget(): void {
    const m = INPUT.EDGE_MARGIN;
    this.targetX = Math.min(Math.max(this.targetX, m), window.innerWidth - m);
    this.targetY = Math.min(Math.max(this.targetY, m), window.innerHeight - m);
  }

  update(dt: number): void {
    const k = Math.min(1, INPUT.CROSSHAIR_SMOOTHING * dt);
    this.x += (this.targetX - this.x) * k;
    this.y += (this.targetY - this.y) * k;
  }
}
