import {DungeonMap, DungeonMapCell, DungeonObject, DungeonObjectOptions} from "../dungeon";
import {UsableDrop} from "../drop";
import {Weapon, WeaponAnimation} from "../weapon";
import {PathFinding, PathPoint} from "../pathfinding";
import {FiniteStateMachine} from "../fsm";
import {CharacterView} from "./CharacterView";
import {Animator} from "./Animator";
import {CharacterState} from "./CharacterState";

export const enum ScanDirection {
  LEFT = 1,
  RIGHT = 2,
  AROUND = 4
}

export interface CharacterOptions extends DungeonObjectOptions {
  readonly x: number;
  readonly y: number;
  readonly zIndex: number;
  readonly animation: string;
  readonly onPosition?: (x: number, y: number) => void;
}

export abstract class Character extends DungeonObject {
  readonly view: CharacterView;
  readonly animator: Animator;

  abstract readonly state: CharacterState;

  protected readonly _fsm: FiniteStateMachine<any>;
  protected readonly _dungeon: DungeonMap;
  private _x: number;
  private _y: number;
  private _newX: number = -1;
  private _newY: number = -1;

  get x(): number {
    return this._x;
  }

  get y(): number {
    return this._y;
  }

  get newX(): number {
    return this._newX;
  }

  get newY(): number {
    return this._newY;
  }

  protected constructor(dungeon: DungeonMap, options: CharacterOptions) {
    super(dungeon.registry, {
      static: false,
      interacting: options.interacting,
      height: options.height,
      width: options.width,
    });
    this._dungeon = dungeon;
    this._x = options.x;
    this._y = options.y;
    this.view = new CharacterView(
      dungeon.layer,
      dungeon.controller.resources,
      options.animation,
      options.zIndex,
      options.width,
      options.onPosition
    );
    this.animator = new Animator(this.view);
    this._fsm = this.fsm();
  }

  init(): void {
    this.setPosition(this._x, this._y);
    this.state.dead.subscribe(this.handleDead, this);
    this.state.inventory.equipment.weapon.item.subscribe(this.onWeaponUpdate, this);
    this._fsm.start();
    this._dungeon.ticker.add(this._fsm.update, this._fsm);
  }

  destroy(): void {
    super.destroy();
    this._dungeon.ticker.remove(this._fsm.update, this._fsm);
    this._fsm.stop();
    this.state.dead.unsubscribe(this.handleDead, this);
    this.state.inventory.equipment.weapon.item.unsubscribe(this.onWeaponUpdate, this);
    this._dungeon.remove(this._x, this._y, this);
    if (this._newX !== -1 && this._newY !== -1) {
      this._dungeon.remove(this._newX, this._newY, this);
    }
    this.view.destroy();
  }

  collide(object: DungeonObject): boolean {
    return this !== object;
  }

  private handleDead(dead: boolean): void {
    if (dead) {
      this.onDead();
    }
  }

  private onWeaponUpdate(weapon: UsableDrop | null): void {
    this.view.weapon.setWeapon(weapon as (Weapon | null));
  }

  protected abstract onDead(): void;

  setPosition(x: number, y: number): void {
    this.resetDestination();
    this._dungeon.remove(this._x, this._y, this);
    this._x = Math.floor(x);
    this._y = Math.floor(y);
    this._dungeon.set(this._x, this._y, this);
    this.view.setPosition(x, y);
  }

  setDestination(x: number, y: number): void {
    this.resetDestination();
    this._newX = x;
    this._newY = y;
    this._dungeon.set(this._newX, this._newY, this);
  }

  tryMove(dx: number, dy: number): boolean {
    return this.moveRel(dx, dy) ||
      this.moveRel(dx, 0) ||
      this.moveRel(0, dy)
  }

  moveRel(dx: number, dy: number): boolean {
    return this.move(this._x + dx, this._y + dy);
  }

  move(newX: number, newY: number): boolean {
    const dx = newX - this._x;
    const dy = newY - this._y;
    if (dx === 0 && dy === 0) return false;
    if (dx > 0) this.view.isLeft = false;
    if (dx < 0) this.view.isLeft = true;
    if (this._dungeon.available(newX, newY, this)) {
      this.setDestination(newX, newY);
      return true;
    } else {
      return false;
    }
  }

  randomMove(): boolean {
    if (Math.random() < 0.1) {
      const moveX = Math.floor(Math.random() * 3) - 1;
      const moveY = Math.floor(Math.random() * 3) - 1;
      if (this.tryMove(moveX, moveY)) {
        return true;
      }
    }
    return false;
  }

  moveToDestination(): void {
    if (this._newX !== -1 && this._newY !== -1) {
      this.setPosition(this._newX, this._newY);
    }
  }

  resetDestination(): void {
    if (this._newX !== -1 && this._newY !== -1) {
      this._dungeon.remove(this._newX, this._newY, this);
      this._dungeon.set(this._x, this._y, this);
      this._newX = -1;
      this._newY = -1;
    }
  }

  lookAt(character: Character): void {
    if (character.x < this.x) this.view.isLeft = true;
    if (character.x > this.x) this.view.isLeft = false;
  }

  findPath(
    character: Character,
    maxDistance: number = 15,
    maxPathLength: number = 15,
  ): PathPoint[] {
    const dungeon = this._dungeon;
    const pf = new PathFinding(dungeon.width, dungeon.height);

    const minX = Math.max(0, this._x - maxDistance);
    const maxX = Math.min(dungeon.width - 1, this._x + this.width - 1 + maxDistance);

    const minY = Math.max(0, this._y - this.height - maxDistance);
    const maxY = Math.min(dungeon.width - 1, this._y + maxDistance);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const cell = dungeon.cell(x, y);
        const m = cell.object;
        if (cell.hasFloor && (!cell.collide(this) || m === character)) {
          pf.clear(x, y);
        } else {
          pf.mark(x, y);
        }
      }
    }

    const path = pf.find(this, character);
    if (path.length <= maxPathLength) {
      return path;
    } else {
      return [];
    }
  }

  /**
   * https://stackoverflow.com/questions/4449285/efficient-algorithm-for-shortest-distance-between-two-line-segments-in-1d
   *
   * <code>d = (s1 max s2 - e1 min e2) max 0</code>
   *
   * @param s1 first segment start
   * @param e1 first segment end
   * @param s2 second segment start
   * @param e2 second segment end
   * @return distance between two line segments in 1d
   */
  segmentDistance(s1: number, e1: number, s2: number, e2: number): number {
    return Math.max(0, Math.max(s1, s2) - Math.min(e1, e2));
  }

  distanceTo(that: Character): number {
    // Chebyshev distance
    const dx = this.segmentDistance(this.x, this.x + this.width - 1, that.x, that.x + that.width - 1);
    const dy = this.segmentDistance(this.y - this.height + 1, this.y, that.y - that.height + 1, that.y);
    return Math.max(dx, dy);
  }

  checkDirection(direction: ScanDirection, object: DungeonObject): boolean {
    const posX = this.x;
    const width = this.width;

    const scanLeft = direction === ScanDirection.AROUND || direction === ScanDirection.LEFT;
    const scanRight = direction === ScanDirection.AROUND || direction === ScanDirection.RIGHT;

    const aMin = scanLeft ? 0 : posX + (width - 1);
    const aMax = scanRight ? this._dungeon.width - 1 : posX + (width - 1);
    const bMin = object.x;
    const bMax = bMin + object.width - 1;

    // check distance as direction cast
    return this.segmentDistance(aMin, aMax, bMin, bMax) === 0;
  }

  metric(a: { readonly x: number; readonly y: number }): number {
    return Math.max(Math.abs(a.x - this._x), Math.abs(a.y - this._y)) +
      (a.y !== this._y ? 0.5 : 0) + // boost X
      (a.x === this._x && a.y === this._y ? 0 : 1) + // boost self
      (this.view.isLeft ? (a.x < this._x ? 0 : 1) : (a.x > this._x ? 0 : 0.5)); // boost side
  }

  scanCells(direction: ScanDirection, maxDistance: number, predicate: (cell: DungeonMapCell) => boolean): DungeonMapCell[] {
    const posX = this.x;
    const posY = this.y;
    const width = this.width;
    const height = this.height;

    const scanLeft = direction === ScanDirection.AROUND || direction === ScanDirection.LEFT;
    const scanRight = direction === ScanDirection.AROUND || direction === ScanDirection.RIGHT;

    const scanMinX = scanLeft ? Math.max(0, posX - maxDistance) : posX + (width - 1);
    const scanMaxX = scanRight ? Math.min(this._dungeon.width - 1, posX + (width - 1) + maxDistance) : posX;

    const scanMinY = Math.max(0, posY - height + 1 - maxDistance);
    const scanMaxY = Math.min(this._dungeon.height - 1, posY + maxDistance);

    const cells: DungeonMapCell[] = [];

    for (let scanY = scanMinY; scanY <= scanMaxY; scanY++) {
      for (let scanX = scanMinX; scanX <= scanMaxX; scanX++) {
        const cell = this._dungeon.cell(scanX, scanY);
        if (predicate(cell)) {
          cells.push(cell);
        }
      }
    }

    cells.sort((a: DungeonMapCell, b: DungeonMapCell) => this.metric(a) - this.metric(b));

    return cells;
  }

  findCell(maxDistance: number, predicate: (cell: DungeonMapCell) => boolean): DungeonMapCell | null {
    const [cell] = this.scanCells(ScanDirection.AROUND, maxDistance, predicate);
    return cell || null;
  }

  findDropCell(maxDistance: number = 5): (DungeonMapCell | null) {
    return this.findCell(maxDistance, cell => cell.hasFloor && !cell.hasObject && !cell.hasDrop);
  }

  findSpawnCell(maxDistance: number = 5): (DungeonMapCell | null) {
    return this.findCell(maxDistance, cell => cell.hasFloor && !cell.hasObject);
  }

  raycastIsVisible(object: DungeonObject): boolean {
    let x0 = this.x;
    let y0 = this.y;
    const x1 = object.x;
    const y1 = object.y;

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);

    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;

    let err = (dx > dy ? dx : -dy) / 2;

    for (; ;) {
      if (x0 === x1 && y0 === y1) break;

      const e2 = err;
      if (e2 > -dx) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dy) {
        err += dx;
        y0 += sy;
      }

      if (x0 === x1 && y0 === y1) break;

      const cell = this._dungeon.cell(x0, y0);
      if (!cell.hasFloor) return false;
      if (cell.collide(this) && cell.object !== object) return false;
    }

    return true;
  }

  protected abstract fsm(): FiniteStateMachine<any>;

  protected idle(): FiniteStateMachine<IdleState> {
    const animator = this.animator;
    const fsm = new FiniteStateMachine<IdleState>(IdleState.PLAY, [IdleState.PLAY, IdleState.COMPLETE]);
    fsm.state(IdleState.PLAY)
      .onEnter(() => {
        const speed = this.state.speed.get() * 0.2;
        animator.clear();
        animator.animateCharacter(speed, this.state.name + "_idle", 4);
        const weapon = this.state.weapon;
        if (weapon) {
          animator.animateWeapon(speed, weapon.animations.idle);
        }
        animator.start();
      })
      .onUpdate(deltaTime => animator.update(deltaTime))
      .onUpdate(() => this.state.regenStamina())
      .onExit(() => animator.stop())
      .transitionTo(IdleState.COMPLETE)
      .condition(() => !animator.isPlaying);
    return fsm;
  }

  protected run(): FiniteStateMachine<RunState> {
    const animator = this.animator;
    const fsm = new FiniteStateMachine<RunState>(RunState.PLAY, [RunState.PLAY, RunState.COMPLETE]);
    fsm.state(RunState.PLAY)
      .onEnter(() => {
        const speed = this.state.speed.get() * 0.2;
        animator.clear();
        animator.animateCharacter(speed, this.state.name + "_run", 4);
        animator.animateMove(speed, this);
        const weapon = this.state.weapon;
        if (weapon) {
          animator.animateWeapon(speed, weapon.animations.run);
        }
        animator.start();
      })
      .onExit(() => {
        if (animator.isPlaying) {
          this.resetDestination();
          animator.stop();
        } else {
          this.moveToDestination();
        }
      })
      .onUpdate(deltaTime => animator.update(deltaTime))
      .onUpdate(() => this.state.regenStamina())
      .transitionTo(RunState.COMPLETE)
      .condition(() => !animator.isPlaying);
    return fsm;
  }

  protected dash(): FiniteStateMachine<DashState> {
    const animator = this.animator;
    const fsm = new FiniteStateMachine<DashState>(DashState.PLAY, [DashState.PLAY, DashState.COMPLETE]);
    fsm.state(DashState.PLAY)
      .onEnter(() => this.state.spendStamina(this.state.dashStamina))
      .onEnter(() => {
        const speed = 1;
        animator.clear();
        animator.animateCharacter(speed, this.state.name + "_run", 4);
        animator.animateMove(speed, this);
        const weapon = this.state.weapon;
        if (weapon) {
          animator.animateWeapon(speed, weapon.animations.run);
        }
        animator.start();
      })
      .onExit(() => {
        if (animator.isPlaying) {
          this.resetDestination();
          animator.stop();
        } else {
          this.moveToDestination();
        }
      })
      .onUpdate(deltaTime => animator.update(deltaTime))
      .transitionTo(DashState.COMPLETE)
      .condition(() => !animator.isPlaying);
    return fsm;
  }

  protected hit(hitController: HitController): FiniteStateMachine<HitState> {
    const simple = this.simpleHit(hitController);
    const combo = this.comboHit(hitController);

    const fsm = new FiniteStateMachine<HitState>(HitState.INITIAL, [
      HitState.INITIAL,
      HitState.SIMPLE_HIT,
      HitState.COMBO_HIT,
      HitState.COMPLETE
    ]);

    fsm.state(HitState.INITIAL)
      .transitionTo(HitState.COMBO_HIT)
      .condition(() => this.state.weapon !== null)
      .condition(() => this.state.weapon!.animations.hit.length > 1);

    fsm.state(HitState.INITIAL)
      .transitionTo(HitState.SIMPLE_HIT);

    fsm.state(HitState.SIMPLE_HIT)
      .nested(simple)
      .transitionTo(HitState.COMPLETE)
      .condition(() => simple.isFinal);

    fsm.state(HitState.COMBO_HIT)
      .nested(combo)
      .transitionTo(HitState.COMPLETE)
      .condition(() => combo.isFinal);
    return fsm;
  }

  private simpleHit(hitController: HitController): FiniteStateMachine<SimpleHitState> {
    const animator = this.animator;
    const fsm = new FiniteStateMachine<SimpleHitState>(SimpleHitState.INITIAL, [SimpleHitState.INITIAL, SimpleHitState.PLAY, SimpleHitState.COMPLETE]);
    fsm.state(SimpleHitState.INITIAL)
      .onEnter(() => this.state.spendStamina(this.state.hitStamina))
      .onEnter(() => {
        const weapon = this.state.weapon;
        animator.clear();
        if (weapon) {
          const speed = weapon.speed * 0.2;
          animator.animateCharacter(speed, this.state.name + "_idle", 4);
          animator.animateWeapon(speed, weapon.animations.hit[0]);
        } else {
          const speed = this.state.speed.get() * 0.2;
          animator.animateCharacter(speed, this.state.name + "_idle", 4);
        }
        animator.start();
      })
      .transitionTo(SimpleHitState.PLAY);
    fsm.state(SimpleHitState.PLAY).onUpdate(deltaTime => animator.update(deltaTime));
    fsm.state(SimpleHitState.PLAY).transitionTo(SimpleHitState.COMPLETE).condition(() => !animator.isPlaying);
    fsm.state(SimpleHitState.COMPLETE).onEnter(() => hitController.onHit(1)).onEnter(() => animator.stop());
    return fsm;
  }

  private comboHit(hitController: HitController): FiniteStateMachine<ComboHitState> {
    const animator = this.animator;
    let hits = 0;
    let speed = 0;
    let combo: readonly WeaponAnimation[] = [];
    const fsm = new FiniteStateMachine<ComboHitState>(ComboHitState.FIRST_HIT, [ComboHitState.FIRST_HIT, ComboHitState.NEXT_HIT, ComboHitState.COMPLETE]);

    // first hit
    fsm.state(ComboHitState.FIRST_HIT)
      .onEnter(() => this.state.spendStamina(this.state.hitStamina))
      .onEnter(() => {
        const weapon = this.state.weapon!;
        combo = weapon.animations.hit;
        speed = weapon.speed * 0.2;
        hits = 0;
        animator.clear();
        animator.animateCharacter(speed, this.state.name + "_idle", 4);
        animator.animateWeapon(speed, combo[0]);
        animator.start();
        hits++
      })
      .onUpdate(deltaTime => animator.update(deltaTime))
      .onExit(() => hitController.onHit(hits));

    fsm.state(ComboHitState.FIRST_HIT)
      .transitionTo(ComboHitState.NEXT_HIT)
      .condition(() => !animator.isPlaying)
      .condition(() => hitController.continueCombo())
      .condition(() => this.state.hasStamina(this.state.hitStamina));

    fsm.state(ComboHitState.FIRST_HIT)
      .transitionTo(ComboHitState.COMPLETE)
      .condition(() => !animator.isPlaying);

    // next hit
    fsm.state(ComboHitState.NEXT_HIT)
      .onEnter(() => this.state.spendStamina(this.state.hitStamina))
      .onEnter(() => {
        animator.clear();
        animator.animateCharacter(speed, this.state.name + "_idle", 4);
        animator.animateWeapon(speed, combo[hits]);
        animator.start();
        hits++;
      })
      .onUpdate(deltaTime => animator.update(deltaTime))
      .onExit(() => hitController.onHit(hits));

    fsm.state(ComboHitState.NEXT_HIT)
      .transitionTo(ComboHitState.NEXT_HIT)
      .condition(() => !animator.isPlaying)
      .condition(() => hits < combo.length)
      .condition(() => hitController.continueCombo())
      .condition(() => this.state.hasStamina(this.state.hitStamina));

    fsm.state(ComboHitState.NEXT_HIT)
      .transitionTo(ComboHitState.COMPLETE)
      .condition(() => !animator.isPlaying);

    return fsm;
  }
}

export const enum IdleState {
  PLAY = 0,
  COMPLETE = 1,
}

export const enum RunState {
  PLAY = 0,
  COMPLETE = 1,
}

export const enum DashState {
  PLAY = 0,
  COMPLETE = 1,
}

export const enum HitState {
  INITIAL = 0,
  SIMPLE_HIT = 1,
  COMBO_HIT = 2,
  COMPLETE = 3,
}

export const enum SimpleHitState {
  INITIAL = 0,
  PLAY = 1,
  COMPLETE = 2,
}

export const enum ComboHitState {
  FIRST_HIT = 0,
  NEXT_HIT = 1,
  COMPLETE = 2,
}

export interface HitController {
  onHit(combo: number): void;
  continueCombo(): boolean;
}