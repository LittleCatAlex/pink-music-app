# 💗 Pink Music

> 基于 Electron + Vue 3 的桌面端音乐播放器，为喜欢 B 站音乐内容的你提供更纯粹的聆听体验。

## ✨ 特色

- 🎵 **智能搜索**：快速检索 B 站上的音乐相关内容，一键播放
- 🎶 **多种播放模式**：顺序播放、列表循环、单曲循环、随机播放
- 📂 **本地歌单管理**：自由创建、导入、导出个人歌单
- 🎨 **个性界面**：多套主题配色 + 深色/浅色模式，搭配毛玻璃视觉效果
- ⬇️ **离线保存**：支持将喜爱的音频保存到本地（仅限个人学习使用）
- 📑 **分P支持**：轻松切换多章节视频内容

## 🛠 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Electron | ^20.0.0 | 桌面应用框架 |
| Vue 3 | ^3.5.32 | 前端框架 |
| Vite | ^8.0.4 | 构建工具 |
| axios | ^1.15.2 | 网络请求 |

## 📦 安装与运行

```bash
# 克隆项目
git clone https://github.com/Rayson-Liu/pink-music-app.git

# 安装依赖
npm install

# 启动开发服务
npm run dev

# 启动 Electron 客户端
npm run electron:dev
```

## 🔨 构建

```bash
# 构建 macOS 版本
npm run electron:build

# 构建 Windows 版本
npm run electron:build -- --win
```

## 🎮 使用指南

### 搜索与播放

在搜索框输入关键词，回车或点击搜索即可获取相关内容。点击卡片即可开始播放。

### 分P切换

播放内容含多章节时，点击右侧列表按钮可自由切换。

### 歌单操作

- **新建歌单**：点击侧边栏「创建」按钮
- **导入歌单**：点击「导入」选择 JSON 文件
- **导出歌单**：在歌单页点击「导出」备份数据

### 下载功能

点击下载按钮可将音频保存至本地（macOS 用户请前往 `~/Library/Application Support/Pink Music/downloads/`）。

### 界面定制

右上角主题按钮可自由切换配色与深色/浅色模式。

## 📁 下载目录

| 平台 | 路径 |
|------|------|
| macOS | `~/Library/Application Support/Pink Music/downloads/` |
| Windows | `%APPDATA%\Pink Music\downloads\` |
| Linux | `~/.config/Pink Music/downloads/` |

## 📂 项目结构

```
pink-music/
├── electron/              # Electron 主进程
│   ├── main.js
│   └── preload.js
├── src/                   # Vue 3 渲染进程
│   ├── App.vue
│   ├── main.js
│   ├── style.css
│   └── utils/
│       └── bilibili.js
├── package.json
└── vite.config.js
```

## ⚠️ 免责声明

- 本项目**仅供个人学习、研究使用**，**严禁用于任何商业目的**。
- 本项目**非 B 站官方产品**，与哔哩哔哩公司无关。
- 所有搜索、播放的内容均来源于 B 站公开资源，**版权归原作者及 B 站所有**。
- 下载功能仅用于**个人离线学习**，请于 24 小时内删除，**不得传播、转载或二次分发**。
- 使用者应**自行承担**因使用本项目而产生的所有法律风险与责任。
- 若项目内容侵犯了您的合法权益，请通过 GitHub Issues 联系，我们会**第一时间处理**。

## 📄 License

[MIT](LICENSE)

## 🤝 贡献

欢迎提交 Issue 和 Pull Request，一起让 Pink Music 变得更好～

> 如果这个项目对你有帮助，欢迎点个 ⭐ 支持一下～
