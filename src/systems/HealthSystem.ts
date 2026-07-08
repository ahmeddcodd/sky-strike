import { PLAYER } from "../game/Constants";

export class HealthSystem {
  hp: number = PLAYER.MAX_HEALTH;
  /** Debug flag — set by DebugSystem's invincibility hotkey. */
  invincible = false;

  /** Applies one point of damage. Returns true when the player is dead. */
  damage(): boolean {
    if (this.invincible) return false;
    this.hp = Math.max(0, this.hp - 1);
    return this.hp === 0;
  }

  reset(): void {
    this.hp = PLAYER.MAX_HEALTH;
  }
}
