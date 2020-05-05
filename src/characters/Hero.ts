import {BaseCharacterAI, Character, ScanDirection} from "./Character";
import {DungeonMap, DungeonZIndexes, DungeonMapCell} from "../dungeon";
import {UsableDrop, Weapon} from "../drop";
import {Observable, ObservableVar} from "../observable";
import {DigitKey, KeyBind} from "../input";
import {PersistentState} from "../persistent.state";
import {MonsterAI} from "./Monster";
import * as PIXI from "pixi.js";
import {HitAnimationController, IdleAnimationController} from "./AnimationController";

export const heroCharacterNames = [
  "elf_f",
  "elf_m",
  "knight_f",
  "knight_m",
  "wizard_f",
  "wizard_m",
];

export interface GlobalHeroState {
  readonly coins: number;
  readonly baseDamage: number;
  readonly level: number;
  readonly levelXp: number;
  readonly skillPoints: number;
  readonly xp: number;
  readonly healthMax: number;
  readonly speed: number;
}

const defaultGlobalState: GlobalHeroState = {
  coins: 0,
  baseDamage: 3,
  level: 1,
  levelXp: 0,
  skillPoints: 0,
  xp: 0,
  healthMax: 30,
  speed: 1,
};

export class Hero extends Character {
  private readonly _persistent: PersistentState;

  private readonly _level: ObservableVar<number>;
  private readonly _levelXp: ObservableVar<number>;
  private readonly _skillPoints: ObservableVar<number>;
  private readonly _xp: ObservableVar<number>;

  readonly dungeonSeeds = new Map<number, number>();
  readonly bonfires = new Set<number>();

  get level(): Observable<number> {
    return this._level;
  }

  get levelXp(): Observable<number> {
    return this._levelXp;
  }

  get skillPoints(): Observable<number> {
    return this._skillPoints;
  }

  get xp(): Observable<number> {
    return this._xp;
  }

  addXp(value: number): void {
    this._xp.update((v) => {
      let newXp = v + value;
      for (; ;) {
        const levelXp = this._levelXp.get();
        if (newXp >= levelXp) {
          newXp = newXp - levelXp;
          this._level.update((v) => v + 1);
          this._levelXp.update((v) => v + 1000);
          this._skillPoints.update((v) => v + 1);
        } else {
          break;
        }
      }
      return newXp;
    });
  }

  increaseHealth(): void {
    this._skillPoints.update((points) => {
      if (points > 0) {
        points--;
        this._healthMax.update((h) => h + 1);
        this._health.update((h) => h + 1);
      }
      return points;
    });
  }

  private constructor(name: string, state: GlobalHeroState, persistent: PersistentState) {
    super({
      name: name,
      speed: state.speed,
      healthMax: state.healthMax,
      baseDamage: state.baseDamage,
      coins: state.coins,
    });
    this._persistent = persistent;
    this._level = new ObservableVar(state.level);
    this._levelXp = new ObservableVar(state.levelXp);
    this._skillPoints = new ObservableVar(state.skillPoints);
    this._xp = new ObservableVar(state.xp);
    this.subscribe();
  }

  private subscribe(): void {
    this._coins.subscribe(this.save, this);
    this._baseDamage.subscribe(this.save, this);
    this._level.subscribe(this.save, this);
    this._levelXp.subscribe(this.save, this);
    this._skillPoints.subscribe(this.save, this);
    this._xp.subscribe(this.save, this);
    this._healthMax.subscribe(this.save, this);
    this._speed.subscribe(this.save, this);
  }

  private save(): void {
    this._persistent.global.save(this.name, this.state);
  }

  private get state(): GlobalHeroState {
    return {
      coins: this._coins.get(),
      baseDamage: this._baseDamage.get(),
      level: this._level.get(),
      levelXp: this._levelXp.get(),
      skillPoints: this._skillPoints.get(),
      xp: this._xp.get(),
      healthMax: this._healthMax.get(),
      speed: this._speed.get(),
    };
  }

  static load(name: string, persistent: PersistentState): Hero {
    const state: GlobalHeroState = persistent.global.load(name) || defaultGlobalState;
    return new Hero(name, state, persistent);
  }
}

export class HeroAI extends BaseCharacterAI {
  readonly character: Hero;
  readonly interacting: boolean = false;

  constructor(character: Hero, dungeon: DungeonMap, x: number, y: number) {
    super(dungeon, {
      x: x,
      y: y,
      width: 1,
      height: 1,
      zIndex: DungeonZIndexes.hero,
      onPosition: dungeon.camera.bind(dungeon),
    });
    this.character = character;
    this.init();
    this.character.inventory.drop.subscribe(this.onDrop, this);
  }

  destroy(): void {
    super.destroy();
    this.character.inventory.drop.unsubscribe(this.onDrop, this);
  }

  interact(): void {
  }

  protected onKilledBy(by: Character): void {
    this.dungeon.log(`${this.character.name} killed by ${by.name}`);
  }

  protected onDead(): void {
    this.dungeon.controller.dead();
  }

  private onDrop(event: [UsableDrop, number]): void {
    const [drop] = event;
    const cell = this.findDropCell();
    if (cell) {
      cell.dropItem = drop;
    }
  }

  action(finished: boolean): boolean {
    if (!this.character.dead.get()) {

      const idle = this.animation instanceof IdleAnimationController;
      const hit = this.animation instanceof HitAnimationController;

      if (finished) {
        if (hit) {
          this.scanHit();
        }
        this.scanDrop();
      }

      const joystick = this.dungeon.controller.joystick;

      if (idle && joystick.inventory.once()) {
        this.dungeon.controller.showInventory(this.character);
        this.idle();
        return true;
      }

      for (let d = 0; d <= 9; d++) {
        const digit = (d + 1) % 10;
        if (joystick.digit(digit as DigitKey).once()) {
          const cell = this.character.inventory.belt.cell(d);
          const item = cell.item.get();
          if (item && (item instanceof Weapon || idle)) {
            cell.use();
          }
        }
      }

      if (idle && joystick.drop.once()) {
        this.character.inventory.equipment.weapon.drop();
      }

      if (idle || finished) {
        const triggered = joystick.hit.triggered;
        const once = joystick.hit.once();

        if (once) {
          const direction = this.view.isLeft ? ScanDirection.LEFT : ScanDirection.RIGHT;
          const [object] = this.scanInteracting(direction, 1);
          if (object) {
            joystick.hit.reset();
            this.idle();
            object.interact(this);
            return true;
          }
        }

        if (triggered || once) {
          this.lookAtMonsters();
          this.hit();
          return true;
        }
      }

      if (idle || finished) {
        const velocityX = HeroAI.delta(joystick.moveLeft, joystick.moveRight);
        const velocityY = HeroAI.delta(joystick.moveUp, joystick.moveDown);

        if (velocityX !== 0 || velocityY !== 0) {
          if (this.move(velocityX, velocityY)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private static delta(a: KeyBind, b: KeyBind): number {
    if (a.triggered) {
      return -1;
    } else if (b.triggered) {
      return 1;
    } else {
      return 0;
    }
  }

  private scanDrop(): void {
    const cell = this.dungeon.cell(this.x, this.y);
    if (cell.drop?.pickedUp(this.character)) {
      PIXI.sound.play('fruit_collect');
    }
  }

  private scanHit(): void {
    const weapon = this.character.weapon;
    const distance = weapon?.distance || 1;
    const direction = this.view.isLeft ? ScanDirection.LEFT : ScanDirection.RIGHT;
    const monsters = this.scanMonsters(direction, distance);
    for (const monster of monsters) {
      monster.character.hitDamage(this.character, this.character.damage);
    }
    if (monsters.length > 0) {
      PIXI.sound.play('hit_damage', {speed: weapon?.speed || 1});
    }
  }

  protected lookAtMonsters(): void {
    const weapon = this.character.weapon;
    const distance = weapon?.distance || 1;
    const leftHealthSum = this.monstersHealth(ScanDirection.LEFT, distance);
    const rightHealthSum = this.monstersHealth(ScanDirection.RIGHT, distance);
    if (leftHealthSum > 0 && leftHealthSum > rightHealthSum) {
      this.view.isLeft = true;
    } else if (rightHealthSum > 0 && rightHealthSum > leftHealthSum) {
      this.view.isLeft = false;
    }
  }

  protected scanInteracting(direction: ScanDirection, maxDistance: number): DungeonMapCell[] {
    return this.scanCells(direction, maxDistance, c => c.interacting);
  }

  protected scanMonsters(direction: ScanDirection, maxDistance: number): MonsterAI[] {
    return this.scanObjects(direction, maxDistance, c => c instanceof MonsterAI) as MonsterAI[];
  }

  protected monstersHealth(direction: ScanDirection, maxDistance: number): number {
    return this.scanMonsters(direction, maxDistance).map(m => m.character.health.get()).reduce((a, b) => a + b, 0);
  }
}

