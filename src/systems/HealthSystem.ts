import { PLAYER } from "../game/Constants";

// Player hull: a 100 HP pool. Enemy gunfire chips it, missiles chunk it,
// jets slipping past the danger plane cost a mid-size hit (see PLAYER block).

export class HealthSystem {
  hp: number = PLAYER.MAX_HEALTH;
  /** Debug flag — set by DebugSystem's invincibility hotkey. */
  invincible = false;

  get fraction(): number {
    return this.hp / PLAYER.MAX_HEALTH;
  }

  /** Applies damage. Returns true when the player is dead. */
  damage(amount: number): boolean {
    if (this.invincible) return false;
    this.hp = Math.max(0, this.hp - amount);
    return this.hp === 0;
  }

  heal(amount: number): void {
    this.hp = Math.min(PLAYER.MAX_HEALTH, this.hp + amount);
  }

  reset(): void {
    this.hp = PLAYER.MAX_HEALTH;
  }
}
