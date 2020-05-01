import {RNG} from "./rng";
import {Joystick} from "./input";
import {Resources} from "./resources";
import {YouDeadScene} from "./dead.scene";
import {GenerateOptions} from "./dungeon.generator";
import {GenerateDungeonScene} from "./generate.scene";
import {DungeonScene} from "./dungeon.scene";
import {DungeonMap} from "./dungeon.map";
import {KeyBindScene} from "./keybind.scene";
import {SelectHeroScene} from "./select.hero.scene";
import {UpdateHeroScene} from "./update.hero.scene";
import {InventoryModalScene} from "./inventory.modal";
import {Hero} from "./hero";
import {PersistentState, SessionPersistentState} from "./persistent.state";
import {DialogManager, DialogModalScene} from "./dialog";
import {Npc} from "./npc";
import * as PIXI from "pixi.js";
import {DungeonBonfireDialogModal} from "./dungeon.bonfire";
import {SceneBanner, DungeonBannerOptions} from "./scene.banner";
import {
  BuyingInventoryActionsController,
  DefaultInventoryActionsController,
  SellingInventoryActionsController
} from "./inventory";

export interface Scene {
  init(): void;
  destroy(): void

  pause(): void;
  resume(): void;
}

export interface ModalScene {
  init(): void;
  destroy(): void
}

export class SceneController {
  readonly persistent: PersistentState;
  readonly rng: RNG;
  readonly joystick: Joystick;
  readonly dialogs: DialogManager;
  readonly resources: Resources;
  readonly app: PIXI.Application;
  readonly stage: PIXI.display.Stage;

  private mainScene: Scene | null = null;
  private modalScene: ModalScene | null = null;
  private banner: SceneBanner | null = null;

  constructor(
    resources: Resources,
    app: PIXI.Application,
    stage: PIXI.display.Stage,
  ) {
    this.persistent = new SessionPersistentState();
    this.rng = RNG.create();
    this.joystick = new Joystick();
    this.resources = resources;
    this.app = app;
    this.stage = stage;
    this.dialogs = new DialogManager(this);

    this.app.ticker.add(this.persistent.global.commit, this.persistent.global, PIXI.UPDATE_PRIORITY.LOW);
    this.app.ticker.add(this.persistent.session.commit, this.persistent.session, PIXI.UPDATE_PRIORITY.LOW);
  }

  private set scene(scene: Scene) {
    this.mainScene?.destroy();
    this.joystick.reset();
    this.mainScene = scene;
    this.mainScene.init();
  }

  keyBind(): void {
    this.scene = new KeyBindScene(this);
  }

  selectHero(): void {
    this.scene = new SelectHeroScene(this);
  }

  updateHero(hero: Hero, level: number): void {
    this.scene = new UpdateHeroScene(this, {
      level: level,
      hero: hero
    });
  }

  dead(): void {
    this.scene = new YouDeadScene(this);
  }

  generateDungeon(options: GenerateOptions): void {
    this.scene = new GenerateDungeonScene(this, options);
  }

  dungeon(hero: Hero, dungeon: DungeonMap): void {
    this.scene = new DungeonScene(this, hero, dungeon);
  }

  private modal(scene: ModalScene): void {
    PIXI.sound.play('text');

    this.mainScene?.pause();
    this.joystick.reset();
    this.modalScene = scene;
    this.modalScene.init();
  }

  closeModal(): void {
    this.modalScene?.destroy();
    this.joystick.reset();
    this.mainScene?.resume();
  }

  showInventory(hero: Hero): void {
    const actions = new DefaultInventoryActionsController(hero.inventory);
    this.modal(new InventoryModalScene(this, actions));
  }

  sellInventory(hero: Hero, npc: Npc): void {
    const actions = new SellingInventoryActionsController(hero, npc);
    this.modal(new InventoryModalScene(this, actions));
  }

  buyInventory(hero: Hero, npc: Npc): void {
    const actions = new BuyingInventoryActionsController(hero, npc);
    this.modal(new InventoryModalScene(this, actions));
  }

  showDialog(hero: Hero, npc: Npc): void {
    const dialog = this.dialogs.dialog(hero, npc);
    this.modal(new DialogModalScene(this, dialog));
  }

  showBonfire(hero: Hero): void {
    this.modal(new DungeonBonfireDialogModal(this, hero));
  }

  showBanner(options: DungeonBannerOptions): void {
    this.closeBanner();
    this.banner = new SceneBanner(this, options);
  }

  closeBanner(): void {
    this.banner?.destroy();
    this.banner = null;
  }
}