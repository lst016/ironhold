import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { BaseScene } from './scenes/BaseScene';
import { BattleScene } from './scenes/BattleScene';
import { RES, VIEW, watchView } from './scenes/common';
import { MenuScene } from './scenes/MenuScene';
import { ProgressScene } from './scenes/ProgressScene';
import { ExpeditionScene } from './scenes/ExpeditionScene';
import { SummonScene } from './scenes/SummonScene';
import { TrainScene } from './scenes/TrainScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  // the canvas is the landscape VIEW times RES pixels; each scene camera zooms by RES (stageCamera)
  width: VIEW.w * RES,
  height: VIEW.h * RES,
  backgroundColor: '#14161c',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, MenuScene, BaseScene, BattleScene, ProgressScene, ExpeditionScene, SummonScene, TrainScene],
});
watchView(game);
