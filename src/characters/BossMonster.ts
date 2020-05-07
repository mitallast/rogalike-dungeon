import {DungeonMap, DungeonZIndexes} from "../dungeon";
import {MonsterCategory, Monster, MonsterType, MonsterHitController, MonsterAlarmEvent} from "./Monster";
import {Colors} from "../ui";
import {WeaponConfig, monsterWeapons, Weapon} from "../drop";
import {BossHealthView} from "./BossHealthView";
import {
  CharacterHitState,
  CharacterIdleState,
  CharacterRunState,
  CharacterState,
  CharacterStateMachine,
} from "./CharacterStateMachine";
import {HeroController} from "./Hero";
import {ScanDirection} from "./Character";
import {SpawningMonsterController} from "./SpawningMonster";

export interface BossConfig {
  readonly name: string;
  readonly category: MonsterCategory;
  readonly weapons: readonly WeaponConfig[];
}

export const bossMonsters: BossConfig[] = [
  {
    name: "big_zombie", category: MonsterCategory.ZOMBIE, weapons: [
      monsterWeapons.anime_sword,
      monsterWeapons.baton_with_spikes,
      monsterWeapons.big_hammer,
      monsterWeapons.cleaver,
      monsterWeapons.mace,
    ]
  },
  {name: "big_demon", category: MonsterCategory.DEMON, weapons: []},
  {
    name: "ogre", category: MonsterCategory.ORC, weapons: [
      monsterWeapons.anime_sword,
      monsterWeapons.baton_with_spikes,
      monsterWeapons.big_hammer,
      monsterWeapons.cleaver,
      monsterWeapons.mace,
    ]
  },
];

export class BossMonster extends Monster {
  constructor(config: BossConfig, level: number) {
    super({
      name: config.name,
      category: config.category,
      type: MonsterType.SUMMON,
      speed: 0.5,
      healthMax: 50 + Math.floor(level * 10),
      level: level,
      luck: 0.4,
      baseDamage: 5 + 0.5 * level,
      xp: 100 + 50 * level,
      spawn: 5,
    });
  }
}

export class BossMonsterController extends SpawningMonsterController {
  readonly character: BossMonster;
  readonly max_distance: number = 7;

  protected readonly _fsm: BossMonsterStateMachine;

  constructor(config: BossConfig, dungeon: DungeonMap, x: number, y: number) {
    super(dungeon, {
      width: 2,
      height: 2,
      x: x,
      y: y,
      zIndex: DungeonZIndexes.character
    });
    this.character = new BossMonster(config, dungeon.level);
    const weapon = Weapon.select(this.dungeon.rng, config.weapons);
    if (weapon) {
      this.character.inventory.equipment.weapon.set(weapon);
    }
    this._fsm = new BossMonsterStateMachine(this);
    this.init();

    const screen = dungeon.controller.app.screen;
    const healthView = new BossHealthView(this.character);
    healthView.zIndex = 13;
    healthView.position.set((screen.width >> 1), 64);
    dungeon.controller.stage.addChild(healthView);
  }

  protected onDead(): void {
    this.dungeon.controller.showBanner({
      text: this.dungeon.rng.boolean() ? "VICTORY ACHIEVED" : "YOU DEFEATED",
      color: Colors.uiYellow
    });
    for (let i = 0; i < 9; i++) {
      this.findDropCell()?.randomDrop();
    }
    this.destroy();
  }
}

export class BossMonsterStateMachine implements CharacterStateMachine {
  private readonly _controller: BossMonsterController;
  private readonly _patrolling: BossMonsterPatrollingState;
  private readonly _alarm: BossMonsterAlarmState;
  private readonly _attack: BossMonsterAttackState;

  private _currentState: BossMonsterPatrollingState | BossMonsterAlarmState | BossMonsterAttackState;

  constructor(controller: BossMonsterController) {
    this._controller = controller;
    this._patrolling = new BossMonsterPatrollingState(this, controller);
    this._alarm = new BossMonsterAlarmState(this, controller);
    this._attack = new BossMonsterAttackState(this, controller);
    this._currentState = this._patrolling;
  }

  start(): void {
    this._currentState = this._patrolling;
    this._currentState.onEnter();
  }

  stop(): void {
    this._currentState.stop();
  }

  private transition(state: BossMonsterPatrollingState | BossMonsterAlarmState | BossMonsterAttackState): void {
    this._currentState.onExit();
    this._currentState = state;
    this._currentState.onEnter();
  }

  patrolling(): void {
    this.transition(this._patrolling);
  }

  alarm(hero: HeroController | null): void {
    if (hero) {
      this._alarm.onAlarm(hero);
    }
    this.transition(this._alarm);
  }

  attack(hero: HeroController): void {
    this._attack.attack(hero);
    this.transition(this._attack);
  }

  onFinished(): void {
  }

  onEvent(event: any): void {
    this._currentState.onEvent(event);
  }

  onUpdate(deltaTime: number): void {
    if (this._controller.character.dead.get()) {
      this.stop();
      return;
    }
    this._currentState.onUpdate(deltaTime);
  }
}

export class BossMonsterPatrollingState implements CharacterState, CharacterStateMachine {
  private readonly _fsm: BossMonsterStateMachine;
  private readonly _controller: BossMonsterController;
  private readonly _idle: CharacterIdleState;
  private readonly _run: CharacterRunState;

  private _currentState: CharacterIdleState | CharacterRunState;

  constructor(fsm: BossMonsterStateMachine, controller: BossMonsterController) {
    this._fsm = fsm;
    this._controller = controller;
    this._idle = new CharacterIdleState(this, controller);
    this._run = new CharacterRunState(this, controller);
    this._currentState = this._idle;
  }

  start(): void {
  }

  stop(): void {
    this._currentState.onExit();
  }

  private transition(state: CharacterIdleState | CharacterRunState): void {
    this._currentState.onExit();
    this._currentState = state;
    this._currentState.onEnter();
  }

  onEnter(): void {
    this._currentState = this._idle;
    this._currentState.onEnter();
  }

  onExit(): void {
  }

  onUpdate(deltaTime: number): void {
    this._currentState.onUpdate(deltaTime);
  }

  onEvent(event: any): void {
    if (event instanceof MonsterAlarmEvent) {
      this._fsm.alarm(event.hero);
    }
  }

  onFinished(): void {
    const [hero] = this._controller.scanHero(ScanDirection.AROUND);
    if (hero) {
      this._controller.sendAlarm(hero);
      this._fsm.attack(hero);
      return;
    }
    if (this._controller.randomMove()) {
      this.transition(this._run);
      return;
    }
    this.transition(this._idle);
  }
}

export class BossMonsterAlarmState implements CharacterState, CharacterStateMachine {
  private readonly _fsm: BossMonsterStateMachine;
  private readonly _controller: BossMonsterController;
  private readonly _idle: CharacterIdleState;
  private readonly _run: CharacterRunState;

  private _currentState: CharacterIdleState | CharacterRunState;
  private _alarmCountDown = 0;

  constructor(fsm: BossMonsterStateMachine, controller: BossMonsterController) {
    this._fsm = fsm;
    this._controller = controller;
    this._idle = new CharacterIdleState(this, controller);
    this._run = new CharacterRunState(this, controller);
    this._currentState = this._idle;
  }

  onAlarm(hero: HeroController): void {
    this._controller.lookAt(hero);
    this._controller.startMoveTo(hero);
  }

  start(): void {
  }

  stop(): void {
    this._currentState.onExit();
  }

  private transition(state: CharacterIdleState | CharacterRunState): void {
    this._currentState.onExit();
    this._currentState = state;
    this._currentState.onEnter();
  }

  onEnter(): void {
    this._alarmCountDown = 10;
    this._currentState = this._idle;
    this._currentState.onEnter();

    this.decision();
  }

  onUpdate(deltaTime: number): void {
    this._currentState.onUpdate(deltaTime);
  }

  onExit(): void {
  }

  onEvent(_: any): void {
  }

  onFinished(): void {
    this.decision();
  }

  private decision(): void {
    const [hero] = this._controller.scanHero(ScanDirection.AROUND);
    if (hero) {
      this._fsm.attack(hero);
      return;
    }
    if (this._controller.startMoveByPath()) {
      this.transition(this._run);
      return;
    }
    this._alarmCountDown--;
    if (this._alarmCountDown > 0) {
      this.transition(this._idle);
    } else {
      this._fsm.patrolling();
    }
  }
}

export class BossMonsterAttackState implements CharacterState, CharacterStateMachine {
  private readonly _fsm: BossMonsterStateMachine;
  private readonly _controller: BossMonsterController;
  private readonly _idle: CharacterIdleState;
  private readonly _run: CharacterRunState;
  private readonly _hit: CharacterHitState;

  private _currentState: CharacterIdleState | CharacterRunState | CharacterHitState;
  private _hero: HeroController | null = null;

  constructor(fsm: BossMonsterStateMachine, controller: BossMonsterController) {
    this._fsm = fsm;
    this._controller = controller;
    this._idle = new CharacterIdleState(this, controller);
    this._run = new CharacterRunState(this, controller);
    this._hit = new CharacterHitState(this, controller, new MonsterHitController(controller));
    this._currentState = this._idle;
  }

  attack(hero: HeroController): void {
    this._controller.lookAt(hero);
    this._hero = hero;
  }

  start(): void {
  }

  stop(): void {
    this._currentState.onExit();
  }

  private transition(state: CharacterIdleState | CharacterRunState | CharacterHitState): void {
    this._currentState.onExit();
    this._currentState = state;
    this._currentState.onEnter();
  }

  onEnter(): void {
    if (!this._hero || this._hero.character.dead.get()) {
      this._fsm.patrolling();
      return;
    }

    this._controller.lookAt(this._hero);
    this._currentState = this._idle;
    this._currentState.onEnter();

    this.decision();
  }

  onUpdate(deltaTime: number): void {
    this._currentState.onUpdate(deltaTime);
  }

  onExit(): void {
    this._hero = null;
  }

  onEvent(_: any): void {
  }

  onFinished(): void {
    this.decision();
  }

  private decision(): void {
    if (!this._hero || this._hero.character.dead.get()) {
      this._fsm.alarm(null);
      return;
    }

    const distance = this._controller.distanceTo(this._hero);

    if (distance > this._controller.max_distance) {
      this._fsm.alarm(null);
      return;
    }

    this._controller.lookAt(this._hero);

    if (distance > 0) {
      if (this._controller.spawnMinions()) {
        this.transition(this._idle);
        return;
      }
      if (this._controller.startMoveTo(this._hero)) {
        this.transition(this._run);
        return;
      }
      if (this._controller.startMoveByPath()) {
        this.transition(this._run);
        return;
      }
      this.transition(this._idle);
    } else {
      if (this._controller.character.luck < this._controller.dungeon.rng.float()) {
        this.transition(this._hit);
        return;
      }
      this.transition(this._idle);
    }
  }
}