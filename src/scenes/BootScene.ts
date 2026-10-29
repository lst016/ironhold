import Phaser from 'phaser';
import { preloadSprites } from './sprites';

export class BootScene extends Phaser.Scene {
  constructor() { super('boot'); }
  preload() { preloadSprites(this); }
  create() { this.scene.start('menu'); }
}
