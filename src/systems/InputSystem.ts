import { INPUT, JOYSTICK } from "../game/Constants";

// Adaptive controls (spec §8):
// - Mouse ("desktop") mode: the crosshair follows the mouse directly (the OS
//   cursor is hidden by the HUD), hold any button to fire. No joystick.
// - Touch mode: virtual joystick under the jet (DIRECT mapping — stick position
//   mirrors crosshair position, release recenters) OR drag anywhere (delta
//   control); holding either fires.
// The mode follows the last-used pointer type, so hybrid laptops switch live.

type PointerMode = "drag" | "joystick";

export class InputSystem {
  /** Smoothed crosshair position in CSS pixels (1:1 with render pixels). */
  x = 0;
  y = 0;
  firing = false;

  /** True when touch is driving the game (joystick shown); false = mouse mode. */
  touchMode: boolean;

  /** Joystick knob deflection in [-1, 1] per axis (0,0 when released). */
  joyX = 0;
  joyY = 0;
  joystickActive = false;

  /** Fired on every pointerdown — used to unlock audio on mobile. */
  onPointerDown: () => void = () => {};
  /** Fired when the control scheme flips between touch and mouse. */
  onModeChange: (touch: boolean) => void = () => {};

  private targetX = 0;
  private targetY = 0;
  private lastX = 0;
  private lastY = 0;
  private activePointer: number | null = null;
  private mode: PointerMode = "drag";

  constructor(canvas: HTMLCanvasElement) {
    // devices without hover + fine pointer start in touch mode
    this.touchMode = !window.matchMedia("(hover: hover) and (pointer: fine)").matches;

    canvas.addEventListener("pointerdown", (e) => {
      this.syncMode(e);
      if (this.activePointer !== null) return;
      this.activePointer = e.pointerId;
      this.firing = true;

      if (this.touchMode) {
        const { cx, cy } = this.joystickCenter();
        const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
        if (dist <= JOYSTICK.RADIUS * JOYSTICK.GRAB_FACTOR) {
          this.mode = "joystick";
          this.joystickActive = true;
          this.updateJoystick(e.clientX, e.clientY);
        } else {
          this.mode = "drag";
          this.lastX = e.clientX;
          this.lastY = e.clientY;
        }
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
      if (this.mode === "joystick") {
        this.updateJoystick(e.clientX, e.clientY);
        return;
      }
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
      this.releaseJoystick();
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
    if (!touch) this.releaseJoystick();
    this.onModeChange(touch);
  }

  private releaseJoystick(): void {
    if (this.joystickActive) {
      // direct mapping recenters on release — glide back to the anchor
      this.targetX = window.innerWidth / 2;
      this.targetY = window.innerHeight * 0.42;
    }
    this.joystickActive = false;
    this.joyX = 0;
    this.joyY = 0;
  }

  private followPointer(e: PointerEvent): void {
    this.targetX = e.clientX;
    this.targetY = e.clientY;
    this.clampTarget();
  }

  /** Joystick base center in CSS pixels — HUD renders the ring at the same spot. */
  joystickCenter(): { cx: number; cy: number } {
    return { cx: window.innerWidth / 2, cy: window.innerHeight - JOYSTICK.BOTTOM_OFFSET };
  }

  private updateJoystick(pointerX: number, pointerY: number): void {
    const { cx, cy } = this.joystickCenter();
    let dx = (pointerX - cx) / JOYSTICK.RADIUS;
    let dy = (pointerY - cy) / JOYSTICK.RADIUS;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    this.joyX = dx;
    this.joyY = dy;
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
    let smoothing: number = INPUT.CROSSHAIR_SMOOTHING;

    if (this.joystickActive) {
      // direct mapping: the crosshair sits where the stick points, instantly
      // proportional — anchored at the crosshair home position
      const anchorX = window.innerWidth / 2;
      const anchorY = window.innerHeight * 0.42;
      const reachX = anchorX - INPUT.EDGE_MARGIN;
      const reachY = anchorY - INPUT.EDGE_MARGIN;

      const len = Math.hypot(this.joyX, this.joyY);
      if (len > JOYSTICK.DEADZONE) {
        // expo curve on the deflection length: fine aim near center, full range at the rim
        const normalized = Math.min(1, (len - JOYSTICK.DEADZONE) / (1 - JOYSTICK.DEADZONE));
        const curved = Math.pow(normalized, JOYSTICK.EXPO);
        this.targetX = anchorX + (this.joyX / len) * curved * reachX;
        this.targetY = anchorY + (this.joyY / len) * curved * reachY;
      } else {
        this.targetX = anchorX;
        this.targetY = anchorY;
      }
      this.clampTarget();
      smoothing = JOYSTICK.SNAP;
    }

    const k = Math.min(1, smoothing * dt);
    this.x += (this.targetX - this.x) * k;
    this.y += (this.targetY - this.y) * k;
  }
}
