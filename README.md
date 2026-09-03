# 第七号地下城主 · 视频驱动原型

这是依据 `rule.md` 实现的车载语音 D&D 5e 风格冒险原型。

## 已实现

- 主持人语音优先的 5 步创角：模组、角色概念、姓名、血统、动机。
- 自由描述映射到战士、游侠或法师的 1 级规则底盘。
- 自动生成六项属性、生命值、护甲等级、被动察觉、技能、职业特性和三名 NPC 队友。
- 支持任意浏览器可播放的本地视频；视频本身不上传，也不再校验文件名或时长。
- 不使用固定时间轴。玩家完成行动（或行动超时后触发被动察觉）起，视频继续播放约 20 秒；到达该位置后浏览器截取一张压缩画面，触发下一段剧情。
- 配置密钥后，主持人模型会根据角色、小队、已发生行动、骰子结果和该截图生成不同场景、NPC 反应及可选行动。截图仅随该次模型请求发送，不保存为文件。
- 主持人语音结束后才开始 20 秒行动窗口；超时使用被动察觉推进事件。
- 自由行动、技能检定、豁免、优势、角色卡查询、暂停/继续、自动存档。
- 最终遭遇包含简化回合制：先攻、动作、移动、附赠动作、反应提示和结束回合。

## 运行

本项目通过本地代理调用 OpenAI 的剧情、视觉理解与情感化语音能力。API 密钥只保存在启动服务的终端中，不会发送给浏览器。

```bash
# OpenAI：剧情生成、视频截图理解与情感化主持人语音
export OPENAI_API_KEY="你的 OpenAI API Key"

npm start
```

### 豆包语音合成 2.0 · 魅力苏菲

为让语音严格朗读剧情模型的原文，项目可使用豆包 HTTP Chunked 语音合成。该方案默认采用“魅力苏菲 2.0”音色 `zh_female_sophie_uranus_bigtts`：

```bash
export TTS_PROVIDER="doubao"
export VOLCENGINE_TTS_API_KEY="你的火山引擎 API Key"
# 以下均有默认值；只有切换时才需要设置：
export VOLCENGINE_TTS_RESOURCE_ID="seed-tts-2.0"
export VOLCENGINE_TTS_SPEAKER="zh_female_sophie_uranus_bigtts"
```

服务端调用 `https://openspeech.bytedance.com/api/v3/tts/unidirectional`，以 MP3 24 kHz 返回音频；密钥只存在于启动服务的终端中。

### 豆包端到端实时语音（可选）

实时语音浏览器连接的是本地代理 `ws://127.0.0.1:8081/api/realtime`，火山引擎密钥不会发送到浏览器。启动前在同一终端配置：

```bash
export VOLCENGINE_RT_APP_ID="控制台中的 APP ID"
export VOLCENGINE_RT_ACCESS_KEY="控制台中的 Access Token"
# 以下三项已有适合本项目的默认值，按需覆盖：
export VOLCENGINE_RT_VOICE_ID="zh_female_vv_jupiter_bigtts"
export VOLCENGINE_RT_MODEL="1.2.1.1"
```

本地 WebSocket 协议：先发送 `{"type":"start"}` 建立会话；随后连续发送 PCM 16 kHz、单声道、int16 小端序的二进制帧；可发送 `{"type":"end_turn"}`、`{"type":"interrupt"}`、`{"type":"finish"}` 控制会话。服务端以 JSON 转发识别/状态事件，并以二进制帧回传 `vv` 的 PCM 24 kHz 语音。

没有密钥时，页面仍可使用预置文字兜底剧情，但无法生成随选择和视频画面变化的内容，也没有主持人语音。

打开 `http://127.0.0.1:8081`，选择任意本地视频，再开始冒险。建议使用 Chrome 或 Safari 以获得中文语音识别支持。

地下城主剧情默认使用 `gpt-4o-mini`，可通过 `OPENAI_DM_MODEL` 覆盖；语音由 `gpt-4o-mini-tts` 的 `marin` 声线生成。服务端会为悬疑、战斗、结果和行动邀请附加不同的情感化语音指令；任何密钥都不会发送给浏览器。

## 发布为可分享网站（Render）

项目已包含 `render.yaml`，可以部署为一个带 HTTPS 的公开网站。公开部署时，剧情与语音请求仍经服务端转发，访问者无法看到你的 API Key；但所有访问者都会消耗部署账号对应的模型额度，建议仅把链接分享给受信任的体验者。

1. 将 `龙与地下城_new` 上传到一个新的 GitHub 仓库。不要上传 `.env`、真实 API Key 或 `node_modules`。
2. 登录 [Render](https://render.com)，选择 **New +** → **Blueprint**，连接刚创建的 GitHub 仓库并选中它。
3. Render 会读取 `render.yaml`。在部署表单中填入 `OPENAI_API_KEY`（剧情生成）和 `VOLCENGINE_TTS_API_KEY`（豆包语音合成 2.0 · 魅力苏菲）。
4. 点击 **Apply**，等待部署完成。Render 会给出类似 `https://seventh-dungeon-master.onrender.com` 的 HTTPS 链接，复制该链接即可分享。

> 免费实例闲置时可能休眠；第一次打开可能需要等待几十秒。每位体验者仍在自己的浏览器中选择本地视频，视频不会上传到 Render。

部署后可访问 `https://你的域名/api/health` 检查服务状态。Render 会自动提供 `PORT`，无需填写或修改端口。

## 范围说明

本原型采用原创“潮汐遗迹”剧情，不包含或复制商业模组文本。规则结构参考 `rule.md`；公开发行时应改用适用的开放授权 SRD 内容并完成许可证要求。
