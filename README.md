# 💗 Pink Music

> 基于哔哩哔哩（B 站）公开接口的跨平台桌面音乐播放器 🎧🎶

非官方项目，与哔哩哔哩无任何官方关联或背书。

## ✨ 特色

- 🎼 支持登录 Bilibili 并获取收藏夹
- 🎧 高品质音频播放，优先拉取更高码率音频流
- 🔥 支持视频文件以及提取音频下载；支持收藏夹视频批量下载
- 🧩 轻量界面，内置浅色和深色主题，毛玻璃视觉效果与流畅动画
- 💿 系统托盘与最小化隐藏，便捷控制播放
- 🎨 多主题颜色切换（粉色、紫色、蓝色、绿色、橙色）
- 📂 本地歌单管理（创建、导入、导出）

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

在搜索框中输入关键词，点击搜索按钮或按回车键进行搜索。点击音乐卡片直接播放。

### 分P切换

当播放的视频包含多个分P时，点击右侧列表按钮查看并切换分P。

### 歌单管理

- 创建歌单：点击侧边栏「创建」按钮
- 导入歌单：点击「导入」按钮，选择导出的 JSON 文件
- 导出歌单：在歌单页面点击「导出」按钮

### 下载功能

在音乐卡片或歌单中点击下载按钮，音频将保存到下载目录，支持在设置中调整音质。

### 界面定制

右上角主题按钮可切换颜色主题和深色/浅色模式。

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
├── src/                   # 渲染进程（Vue 应用）
│   ├── App.vue
│   ├── main.js
│   ├── style.css
│   └── utils/
│       └── bilibili.js
├── package.json
└── vite.config.js
```

## 📄 许可证

本项目以 **PolyForm Noncommercial License 1.0.0**（非商业许可）发布，禁止任何商业用途。

SPDX: `PolyForm-Noncommercial-1.0.0` 

## ⚖️ 法律声明与使用限制

- 本项目**仅供学习与研究使用**，禁止任何形式的**商业用途**（包括但不限于销售、收费服务、广告变现、商业集成等）。
- 本项目与 **Bilibili 无任何官方关联或背书**，不使用其商标与标识；涉及的名称与商标归其权利人所有。
- 数据来源于用户调用的**公开接口**与个人账户授权；使用时需遵守 Bilibili 的《用户协议》《社区规则》及相关法律法规。
- **禁止绕过登录/会员权限、DRM/加密措施，或进行批量爬取、恶意抓取等违反平台规则的行为**。
- 如需商业授权或调整许可，请联系作者；如涉及权利或合规问题，请通过 Issues 反馈以便及时处理。


## 🤝 贡献

欢迎提交 Issue 和 Pull Request，一起让 Pink Music 变得更好～

> 如果这个项目对你有帮助，欢迎点个 ⭐ 支持一下～
