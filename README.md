# Ironhold · 铁壁灵城

浏览器里的类部落冲突策略小游戏：经营基地、布塔防守、进攻敌营、远征闯关、召唤英灵。

- 三大道统：中土·剑宗（御剑问道）、扶桑·阴阳寮（式神百鬼）、欧陆·圣庭（符文圣骑），兵种与英雄技能各不相同
- 建造矿场、灵塔、城墙，规划基地布局
- 军营训练兵种，主动进攻；演习模式检验防守
- 五关远征赢取召唤代币，在英灵殿召唤与强化英雄

技术栈：TypeScript · Phaser 4 · three.js · Vite。

## 运行

```bash
npm install
npm run dev     # 本地开发
npm test        # 单元测试
npm run build   # 产物输出到 dist/
```

## 目录

- `src/core` 经济、军队、远征、召唤等纯逻辑（含测试）
- `src/scenes` 各游戏场景
- `src/data` 阵营、兵种、地图数据
- `public/assets` 游戏运行所需的美术资源
- `scripts`、`tools` 素材处理脚本；依赖的原始素材（`assets-src/`）体积较大，未包含在仓库中

## 美术资源

美术资源为本项目使用 AI 工具生成，来源说明见 `public/assets/README-assets.txt`。

## License

[MIT](LICENSE)
