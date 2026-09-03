const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocket, WebSocketServer } = require('ws');
const root = __dirname;
const port = Number(process.env.PORT || 8081);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };

function send(res, status, body, headers = {}) { res.writeHead(status, { 'Cache-Control': 'no-store', ...headers }); res.end(body); }

const realtimeDefaults = {
  url: 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue', resourceId: 'volc.speech.dialog', appKey: 'PlgvMymc7f3tQnJ6',
  speaker: 'zh_female_vv_jupiter_bigtts', model: '1.2.1.1'
};

function realtimeConfig() {
  return {
    url: process.env.VOLCENGINE_RT_URL || realtimeDefaults.url,
    appId: process.env.VOLCENGINE_RT_APP_ID,
    accessKey: process.env.VOLCENGINE_RT_ACCESS_KEY,
    resourceId: process.env.VOLCENGINE_RT_RESOURCE_ID || realtimeDefaults.resourceId,
    appKey: process.env.VOLCENGINE_RT_APP_KEY || realtimeDefaults.appKey,
    speaker: process.env.VOLCENGINE_RT_VOICE_ID || realtimeDefaults.speaker,
    model: process.env.VOLCENGINE_RT_MODEL || realtimeDefaults.model
  };
}

function realtimeMissing(config) { return ['VOLCENGINE_RT_APP_ID', 'VOLCENGINE_RT_ACCESS_KEY'].filter((key) => !config[key === 'VOLCENGINE_RT_APP_ID' ? 'appId' : 'accessKey']); }
function packInt(value) { const buffer = Buffer.alloc(4); buffer.writeInt32BE(value); return buffer; }
function packUInt(value) { const buffer = Buffer.alloc(4); buffer.writeUInt32BE(value); return buffer; }
function realtimeEvent(eventId, sessionId, payload = {}) {
  const json = Buffer.from(JSON.stringify(payload)); const session = Buffer.from(sessionId);
  return Buffer.concat([Buffer.from([0x11, 0x14, 0x10, 0x00]), packUInt(eventId), packUInt(session.length), session, packUInt(json.length), json]);
}
function realtimeAudio(sequence, sessionId, pcm, last = false) {
  const session = Buffer.from(sessionId); const frame = Buffer.from(pcm);
  // 协议示例的音频帧为 header + sequence + event(200) + session + PCM payload。
  return Buffer.concat([Buffer.from([0x11, 0x24, 0x00, 0x00]), packInt(last ? -1 : sequence), packUInt(200), packUInt(session.length), session, packUInt(frame.length), frame]);
}
function parseRealtimeFrame(data) {
  const frame = Buffer.from(data); if (frame.length < 8) return { type: 'unknown' };
  const messageType = frame[1] >> 4; let offset = 4; let sequence = null;
  // 文档中的 TTSResponse 音频帧携带 sequence；Full-server JSON 响应从 event_id 开始。
  if (messageType === 0x0b && frame.length >= 12) { sequence = frame.readInt32BE(offset); offset += 4; }
  if (offset + 4 > frame.length) return { type: 'unknown' };
  const eventId = frame.readUInt32BE(offset); offset += 4;
  if (offset + 4 > frame.length) return { type: 'unknown', eventId };
  const sessionLength = frame.readUInt32BE(offset); offset += 4 + sessionLength;
  if (offset + 4 > frame.length) return { type: 'unknown', eventId };
  const payloadLength = frame.readUInt32BE(offset); offset += 4;
  const payload = frame.subarray(offset, Math.min(offset + payloadLength, frame.length));
  if (messageType === 0x0b && eventId === 352) return { type: 'audio', eventId, sequence, payload };
  let json = null; try { json = JSON.parse(payload.toString('utf8')); } catch {}
  return { type: messageType === 0x0f ? 'error' : 'event', eventId, sequence, payload: json };
}

const realtimeGateway = new WebSocketServer({ noServer: true });
realtimeGateway.on('connection', (client) => {
  let upstream = null; let sessionId = null; let sequence = 0; let started = false;
  const emit = (value) => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(value)); };
  const closeUpstream = () => { if (upstream && upstream.readyState === WebSocket.OPEN) upstream.close(); upstream = null; };
  client.on('message', (data, isBinary) => {
    if (isBinary) {
      if (!started || !upstream || upstream.readyState !== WebSocket.OPEN) return emit({ type: 'error', message: '实时语音会话尚未建立。' });
      upstream.send(realtimeAudio(sequence++, sessionId, data)); return;
    }
    let command; try { command = JSON.parse(data.toString()); } catch { return emit({ type: 'error', message: '本地实时语音控制消息必须为 JSON。' }); }
    if (command.type === 'start') {
      if (upstream) return;
      const config = realtimeConfig(); const missing = realtimeMissing(config);
      if (missing.length) return emit({ type: 'error', message: `未配置 ${missing.join('、')}。请在启动服务的终端中设置。` });
      sessionId = crypto.randomUUID(); const connectId = crypto.randomUUID();
      console.log(`[RT] 连接豆包实时语音 · speaker=${config.speaker} · model=${config.model} · connect_id=${connectId}`);
      upstream = new WebSocket(config.url, { headers: { 'X-Api-App-ID': config.appId, 'X-Api-Access-Key': config.accessKey, 'X-Api-Resource-Id': config.resourceId, 'X-Api-App-Key': config.appKey, 'X-Api-Connect-Id': connectId } });
      upstream.on('open', () => {
        const payload = { asr: { extra: { end_smooth_window_ms: 1500, enable_custom_vad: false, enable_asr_twopass: false } }, dialog: { bot_name: '第七号地下城主', system_role: String(command.systemRole || '你是第七号地下城主。用富有感染力的中文带领玩家进行原创奇幻冒险；只推进一个可行动步骤。'), speaking_style: String(command.speakingStyle || '沉稳、富有画面感、可被打断的地下城主口吻。'), dialog_id: '', extra: { strict_audit: true, input_mod: '', enable_music: false, enable_loudness_norm: false, enable_conversation_truncate: false, enable_user_query_exit: false, model: config.model } }, tts: { speaker: config.speaker, audio_config: { channel: 1, format: 'pcm_s16le', sample_rate: 24000 }, extra: { speech_rate: 0, loudness_rate: 0 } } };
        upstream.send(realtimeEvent(100, sessionId, payload)); started = true; emit({ type: 'connecting', sessionId });
      });
      upstream.on('message', (frame) => { const message = parseRealtimeFrame(frame); if (message.type === 'audio') { if (client.readyState === WebSocket.OPEN) client.send(message.payload, { binary: true }); } else emit(message); });
      upstream.on('error', (error) => { console.error(`[RT] 豆包连接异常 · ${error.message}`); emit({ type: 'error', message: '豆包实时语音连接失败，请检查 APP ID、Access Token 与服务开通状态。' }); });
      upstream.on('close', (code) => { console.log(`[RT] 豆包连接关闭 · code=${code}`); emit({ type: 'closed', code }); });
      return;
    }
    if (!upstream || upstream.readyState !== WebSocket.OPEN || !sessionId) return;
    if (command.type === 'end_turn') upstream.send(realtimeEvent(400, sessionId, {}));
    if (command.type === 'interrupt') upstream.send(realtimeEvent(515, sessionId, {}));
    if (command.type === 'finish') { upstream.send(realtimeEvent(102, sessionId, {})); setTimeout(closeUpstream, 1200); }
  });
  client.on('close', closeUpstream);
});

function tts2Config() {
  return {
    apiKey: process.env.VOLCENGINE_TTS_API_KEY || process.env.VOLCENGINE_API_KEY,
    url: process.env.VOLCENGINE_TTS_URL || 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
    resourceId: process.env.VOLCENGINE_TTS_RESOURCE_ID || 'seed-tts-2.0',
    speaker: process.env.VOLCENGINE_TTS_SPEAKER || 'zh_female_sophie_uranus_bigtts'
  };
}

function tts2Event(eventId, sessionId, payload = {}) {
  const json = Buffer.from(JSON.stringify(payload)); const chunks = [Buffer.from([0x11, 0x14, 0x10, 0x00]), packUInt(eventId)];
  if (sessionId) { const session = Buffer.from(sessionId); chunks.push(packUInt(session.length), session); }
  chunks.push(packUInt(json.length), json); return Buffer.concat(chunks);
}

function parseTts2Frame(data) {
  const frame = Buffer.from(data); if (frame.length < 8) return { type: 'unknown' };
  const messageType = frame[1] >> 4; let offset = 4; let sequence = null;
  if (messageType === 0x0b && frame.length >= 12) { sequence = frame.readInt32BE(offset); offset += 4; }
  if (offset + 4 > frame.length) return { type: 'unknown' };
  const eventId = frame.readUInt32BE(offset); offset += 4;
  // Connection 事件没有 session_id；Session 事件则携带 session_id_size + session_id。
  let payloadOffset = offset; const candidate = offset + 4 <= frame.length ? frame.readUInt32BE(offset) : -1;
  if (candidate >= 0 && candidate <= 128 && offset + 4 + candidate + 4 <= frame.length) {
    const possiblePayloadSize = frame.readUInt32BE(offset + 4 + candidate);
    if (offset + 4 + candidate + 4 + possiblePayloadSize <= frame.length) payloadOffset = offset + 4 + candidate;
  }
  if (payloadOffset + 4 > frame.length) return { type: 'unknown', eventId };
  const payloadLength = frame.readUInt32BE(payloadOffset); payloadOffset += 4;
  const payload = frame.subarray(payloadOffset, Math.min(payloadOffset + payloadLength, frame.length));
  if (messageType === 0x0b) return { type: 'audio', eventId, sequence, payload };
  let json = null; try { json = JSON.parse(payload.toString('utf8')); } catch {}
  return { type: messageType === 0x0f ? 'error' : 'event', eventId, payload: json };
}

async function doubaoWebSocketSpeech(req, res) {
  const config = tts2Config();
  if (!config.apiKey) return send(res, 503, JSON.stringify({ error: '未配置 VOLCENGINE_TTS_API_KEY。' }), { 'Content-Type': 'application/json; charset=utf-8' });
  let raw = ''; for await (const chunk of req) raw += chunk;
  let body; try { body = JSON.parse(raw); } catch { return send(res, 400, JSON.stringify({ error: '请求格式无效' }), { 'Content-Type': 'application/json; charset=utf-8' }); }
  const input = String(body.input || '').trim().slice(0, 4096); if (!input) return send(res, 400, JSON.stringify({ error: '缺少文本' }), { 'Content-Type': 'application/json; charset=utf-8' });
  const connectId = crypto.randomUUID(); const sessionId = crypto.randomUUID(); const audio = []; let socket;
  const waitFor = (eventId) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待豆包事件 ${eventId} 超时`)), 15000);
    const listener = (message) => { if (message.type === 'event' && message.eventId === eventId) { clearTimeout(timer); socket.off('message', listener); resolve(message); } if (message.type === 'error') { clearTimeout(timer); socket.off('message', listener); reject(new Error('豆包语音合成返回错误')); } };
    socket.on('message', (frame) => listener(parseTts2Frame(frame)));
  });
  try {
    console.log(`[TTS] 请求豆包 · resource=${config.resourceId} · speaker=${config.speaker} · chars=${input.length} · connect_id=${connectId}`);
    socket = new WebSocket(config.url, { headers: { 'X-Api-Key': config.apiKey, 'X-Api-Resource-Id': config.resourceId, 'X-Api-Connect-Id': connectId, 'X-Control-Require-Usage-Tokens-Return': '*' }, maxPayload: 10 * 1024 * 1024 });
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    socket.send(tts2Event(1, null, {})); await waitFor(50);
    const base = { req_params: { speaker: config.speaker, audio_params: { format: 'mp3', sample_rate: 24000 } } };
    socket.send(tts2Event(100, sessionId, { ...base, event: 100 })); await waitFor(150);
    const finished = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等待豆包语音合成完成超时')), 30000);
      socket.on('message', function collect(frame) { const message = parseTts2Frame(frame); if (message.type === 'audio') audio.push(message.payload); if (message.type === 'event' && message.eventId === 152) { clearTimeout(timer); socket.off('message', collect); resolve(); } if (message.type === 'error') { clearTimeout(timer); socket.off('message', collect); reject(new Error('豆包语音合成返回错误')); } });
    });
    for (const character of input) { socket.send(tts2Event(200, sessionId, { ...base, event: 200, req_params: { ...base.req_params, text: character } })); await new Promise((resolve) => setTimeout(resolve, 5)); }
    socket.send(tts2Event(102, sessionId, {})); await finished;
    socket.send(tts2Event(2, null, {})); socket.close();
    const output = Buffer.concat(audio); if (!output.length) throw new Error('豆包未返回音频数据');
    console.log(`[TTS] 豆包成功 · bytes=${output.length} · connect_id=${connectId}`); send(res, 200, output, { 'Content-Type': 'audio/mpeg' });
  } catch (error) { console.error(`[TTS] 豆包调用异常 · ${error.message} · connect_id=${connectId}`); if (socket) socket.close(); send(res, 502, JSON.stringify({ error: error.message }), { 'Content-Type': 'application/json; charset=utf-8' }); }
}

async function doubaoHttpSpeech(req, res) {
  const config = tts2Config();
  if (!config.apiKey) return send(res, 503, JSON.stringify({ error: '未配置 VOLCENGINE_TTS_API_KEY。' }), { 'Content-Type': 'application/json; charset=utf-8' });
  let raw = ''; for await (const chunk of req) raw += chunk;
  let body; try { body = JSON.parse(raw); } catch { return send(res, 400, JSON.stringify({ error: '请求格式无效' }), { 'Content-Type': 'application/json; charset=utf-8' }); }
  const input = String(body.input || '').trim().slice(0, 4096); if (!input) return send(res, 400, JSON.stringify({ error: '缺少文本' }), { 'Content-Type': 'application/json; charset=utf-8' });
  const mood = String(body.mood || '沉浸的奇幻叙述'); const requestId = crypto.randomUUID();
  try {
    console.log(`[TTS] 请求豆包语音合成 2.0 · speaker=${config.speaker} · chars=${input.length} · request_id=${requestId}`);
    const response = await fetch(config.url, { method: 'POST', headers: { 'X-Api-Key': config.apiKey, 'X-Api-Resource-Id': config.resourceId, 'Content-Type': 'application/json' }, body: JSON.stringify({ user: { uid: 'seventh-dungeon-master' }, namespace: 'BidirectionalTTS', req_params: { text: input, speaker: config.speaker, audio_params: { format: 'mp3', sample_rate: 24000 }, additions: JSON.stringify({ context_texts: `你是第七号地下城主。${mood}。请忠实朗读原文，不添加内容。` }) } }) });
    if (!response.ok || !response.body) { const detail = await response.text(); console.warn(`[TTS] 豆包返回 ${response.status} · ${detail.slice(0, 600)}`); return send(res, response.status || 502, JSON.stringify({ error: detail || '豆包语音合成服务不可用' }), { 'Content-Type': 'application/json; charset=utf-8' }); }
    const reader = response.body.getReader(); const decoder = new TextDecoder(); const audio = []; const events = []; let pending = '';
    const consume = (line) => {
      const source = line.trim().replace(/^data:\s*/, ''); if (!source || source === '[DONE]') return;
      let message; try { message = JSON.parse(source); } catch { events.push({ raw: source.slice(0, 180) }); return; }
      const data = message.data && typeof message.data === 'object' ? message.data : message;
      events.push({ event: message.event ?? data.event ?? null, code: message.code ?? data.code ?? null, message: message.message ?? data.message ?? data.error ?? null, dataType: typeof message.data, dataLength: typeof message.data === 'string' ? message.data.length : null, keys: Object.keys(message) });
      const encodedAudio = typeof message.data === 'string' ? message.data : message.audio || data.audio || message.payload?.audio || data.payload?.audio;
      if (encodedAudio) audio.push(Buffer.from(encodedAudio, 'base64'));
      if (message.event === 'error' || data.event === 'error' || message.error || data.error) throw new Error(String(message.message || data.message || data.error || '豆包语音合成返回错误'));
    };
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      pending += decoder.decode(value, { stream: true }); const lines = pending.split(/\r?\n/); pending = lines.pop();
      for (const line of lines) consume(line);
    }
    if (pending.trim()) consume(pending);
    const output = Buffer.concat(audio); if (!output.length) throw new Error(`豆包未返回音频数据 · events=${JSON.stringify(events.slice(0, 8))}`);
    console.log(`[TTS] 豆包语音合成成功 · speaker=${config.speaker} · bytes=${output.length} · request_id=${requestId}`); send(res, 200, output, { 'Content-Type': 'audio/mpeg' });
  } catch (error) { console.error(`[TTS] 豆包语音合成异常 · ${error.message} · request_id=${requestId}`); send(res, 502, JSON.stringify({ error: error.message }), { 'Content-Type': 'application/json; charset=utf-8' }); }
}

async function speech(req, res) {
  if ((process.env.TTS_PROVIDER || '').toLowerCase() === 'doubao' || process.env.VOLCENGINE_TTS_API_KEY || process.env.VOLCENGINE_API_KEY) return doubaoHttpSpeech(req, res);
  return openAISpeech(req, res);
}

async function openAISpeech(req, res) {
  if (!process.env.OPENAI_API_KEY) { console.warn('[TTS] 未调用 OpenAI：OPENAI_API_KEY 未配置'); return send(res, 503, JSON.stringify({ error: '未配置 OPENAI_API_KEY。' }), { 'Content-Type': 'application/json; charset=utf-8' }); }
  let raw = ''; for await (const chunk of req) raw += chunk;
  let body; try { body = JSON.parse(raw); } catch { return send(res, 400, JSON.stringify({ error: '请求格式无效' }), { 'Content-Type': 'application/json' }); }
  const input = String(body.input || '').trim().slice(0, 4096);
  if (!input) return send(res, 400, JSON.stringify({ error: '缺少文本' }), { 'Content-Type': 'application/json' });
  const mood = String(body.mood || '沉浸的奇幻叙述');
  const voice = process.env.OPENAI_TTS_VOICE || 'marin';
  // 加快叙述节奏，同时为紧张和悬疑场景保留不同的情绪起伏。
  const speed = /战斗|攻击|紧张|危险/.test(mood) ? 1.14 : /悬疑|不安|阴影|雾/.test(mood) ? 1.03 : 1.08;
  const instructions = `使用自然、清晰、有感染力的普通话。你是资深 D&D 地下城主。${mood}。句间停顿短而自然，重音落在危险、发现、选择与结果上；避免机械播报和拖沓尾音。在玩家行动前留出一拍期待感。不要添加原文没有的句子。`;
  try {
    console.log(`[TTS] 请求 OpenAI · model=gpt-4o-mini-tts · voice=${voice} · speed=${speed} · chars=${input.length}`);
    const response = await fetch('https://api.openai.com/v1/audio/speech', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice, input, instructions, response_format: 'mp3', speed }) });
    const requestId = response.headers.get('x-request-id') || '无';
    if (!response.ok) {
      const detail = await response.text();
      console.warn(`[TTS] OpenAI 返回 ${response.status} · request_id=${requestId} · ${detail.slice(0, 600)}`);
      return send(res, response.status, JSON.stringify({ error: detail }), { 'Content-Type': 'application/json; charset=utf-8' });
    }
    const audio = Buffer.from(await response.arrayBuffer());
    console.log(`[TTS] OpenAI 成功 · request_id=${requestId} · bytes=${audio.length}`);
    send(res, 200, audio, { 'Content-Type': 'audio/mpeg' });
  } catch (error) { console.error(`[TTS] 调用异常 · ${error.message}`); send(res, 502, JSON.stringify({ error: error.message }), { 'Content-Type': 'application/json; charset=utf-8' }); }
}

const dmInstructions = `你是“第七号地下城主”，一位专业、资深、情感细腻的 D&D 5e 主持人。严格遵循 5e 的能力检定、豁免、优势劣势、行动经济和回合制原则。绝不展示思考过程；只用故事口吻描述已经发生的事。每次只推进一个可行动步骤。失败必须推动故事而非堵死剧情。现实道路信息只能作为奇幻叙事锚点，绝不能鼓励真实驾驶操作。当输入包含视频截图时，仔细观察其中可见的环境、天气、道路、地貌、建筑和光线，并把它们转译为原创奇幻线索；不要声称知道实际地点，也不要依据不可见内容编造细节。不要使用受保护的经典模组剧情或设定原文；只创作原创内容。choices 是你每一轮必须重新创作的 2 到 3 个行动建议：它们必须具体回应最新场景、玩家上一项行动和骰子结果，彼此采用不同策略；不要重复通用的“观察周围”“查看周围”“调查环境”或“与队友商议”。玩家永远可以自由描述未列出的行动。只有重要冲突、直接危险、有明确代价或结果真正不确定的行动才 requiresRoll=true，并以 5e 方式设定 dc；普通交谈、接受委托、移动、使用已取得的线索、无压力的小决定必须 requiresRoll=false、dc=0，直接叙述其结果，绝不掷骰。为保持车内语音节奏，narration 必须是 35 到 65 字、2 到 3 句的中文叙述，只写新出现的关键变化，并以自然悬念、环境变化或人物反应收束；不要说“行动权归你”“轮到你”或任何规则化交接语。返回严格 JSON，不加 Markdown：{"title":"不超过18字","narration":"35到65字、2到3句中文叙述，以自然悬念收束","choices":[{"text":"具体行动建议","check":"能力或技能检定；免掷骰时写直接结果","dc":"需掷骰时10到17，否则0","requiresRoll":"是否需要虚拟d20","eventType":"战斗、社交、探索、危机或抉择"}],"passiveDC":10到17,"mood":"语音情绪指令","characterClass":"仅角色映射时填写标准职业，其他请求为空字符串","characterRace":"仅角色映射时填写种族，其他请求为空字符串","characterTalent":"仅角色映射时填写天赋，其他请求为空字符串"}。`;

const dmContinuityInstructions = '输入中的 previousScene 是刚刚结束的一幕，playerAction、check、result 是其结算，visualAnchor 和截图是紧接着发生的新环境。玩家的上一项选择与其成功、失败或直接结果，是下一幕最重要的因果；必须先让玩家清楚感到“因为我刚才这样做，所以现在发生了这件事”，再决定是否借用当前截图。不得用新风景覆盖、重置或稀释玩家造成的任务进度、人物关系、已知线索、资源或危险。只有当前截图出现了显著且与剧情有关的新物体、地貌、光线、天气或运动变化时，才描写视觉；若没有明显变化，严禁再次描述相同画面，应改为推进人物反应、时间压力、线索后果或任务进度。';
const dmEventInstructions = '输入中的 event、impact、resultNarration 和 eventState 是规则层已经结算的事实。必须让它们影响 NPC 反应、场景风险、线索、关系与后续难度；不能推翻骰子结果或临时状态。角色的当前生命、临时生命、线索、信任、威胁与 effects 均为已发生的数值事实：在叙事中自然呈现它们的后果，绝不可无故抹除。不要复述骰子点数、总值、难度或“检定”字样。每次结算后的 narration 必须把刚刚的成功或失败当作下一幕的直接起因：成功带来可利用的机会、线索或关系变化；失败带来代价、延误、暴露或新的危险，但仍可推进。choices 必须是该结果下的不同策略，叙述以场景自然停顿收束，不使用行动权交接语。';
const dmVisualInstructions = '当 requestType 为 opening_name 时，必须依据视频第一帧的显著可见特征创作开场：先用 1 到 2 句描绘真正可见的主体、光线、道路、地貌或天气，并把它们化为奇幻场景；再取一个原创地名，以“欢迎来到XX，亲爱的旅人，请告诉我你的名字”自然收束。choices 是 2 到 3 个有世界观气息的名字建议，choice.check 固定为“确定名字”，dc 为 0，requiresRoll 为 false。绝不解释创建步骤或出现幕后用语。其他带截图的场景，先判断画面相较于已知场景是否有明显变化；只有存在明显变化时才借用最多两个新视觉特征，且只能作为前一选择后果的舞台或触发器，不能取代因果。车辆继续行驶可以转化为世界时间流逝与地图区域跳转；建筑、树林、河流、路牌、羊群、废弃房屋、隧道、红绿灯、加油站、远山、乌云、日落、暴雨、行人、广告牌等可见事物，均可转译为异世界地标、NPC、遭遇或线索，但只使用实际可见且与剧情相关的元素。变化不明显时，完全不要重复描述风景，改用剧情后果推进。剧情和 choices 要具体、有想象力、策略差异明显，至少提供一种大胆行动、一种谨慎行动或一种社交/机智行动；不得回退为通用观察或商议。';
const dmAdventureInstructions = '创作要参考 D&D 5e 玩家手册的角色、背景、技能、装备、法术和冒险规则精神，而不是照抄任何受保护的模组文本。主线与支线应自然轮换战斗、社交、追逐/危机、道具抉择、探索和短暂休整；整体节奏每 2 到 3 幕至少发生一次高张力事件（敌对生物突袭、倒计时危机、危险谈判、追逐或仪式失控），避免连续两幕把“查看、观察、调查”作为主要选择。NPC 必须有动机、秘密、可交流信息和会随信任变化的态度；道具应有可立即使用的价值、风险或代价。战斗只在局势合适时发生并遵循回合制，choice.eventType 使用“战斗”；谈判、欺骗、表演、威吓或结盟使用“社交”；解除陷阱、追逐、坍塌和仪式失控使用“危机”。每组 choices 至少有一个明确推动局面的动作，而不是被动查看。requestType 为 main_quest_options 时，基于场景、角色和动机提供三条可选原创主线任务，不进入实际遭遇。requestType 为 main_quest_commit 时，将 selectedQuest 发展为适合 1 级四人小队的正式主线，简洁交代目标、迫近后果和第一步行动，不剧透结局。之后所有场景必须维护输入 mainQuest 的目标和进度，让每轮结果确实影响主线。';
const dmCharacterCreationInstructions = 'requestType 为 character_creation 时，你是主持人而不是表单。仅围绕 creationStage 询问一个信息，并使用 creationAnswers 中已经确立的内容延续语气。问题要短而有故事感，不解释步骤功能。character 步骤应先对玩家名字作一句富有温度的回应，例如“XX，真是有趣的名字”，再邀请其用一句话描述种族、职业、来历、性格与天赋。此步骤 choices 必须恰好给出三条完整、可直接选择的人物设定事例：每条都必须同时包含来历、种族、职业，及至少一项性格或天赋；例如“来自地底、擅长蛊惑人心的矮人巫师”。绝不能只给职业、种族或单个标签；严禁输出“完善角色设定”“选择背景故事”“继续创建角色”等流程性选项。motivation 步骤自然询问“你为什么来到这里”。choices 只是灵感，绝不能限制玩家。若玩家提出罕见职业、非典型血统、奇异身份或天马行空背景，都要欢迎并在后续内容中承接。choice.check 使用“角色创建”，dc 为 0。不得提前代替玩家决定角色。';
const dmProfessionInstructions = '当 requestType 为 resolve_character 时，读取 characterDescription，提取或合理推断角色种族、最鲜明天赋和职业。characterClass 必须且只能是：战士、游侠、法师、野蛮人、吟游诗人、牧师、德鲁伊、武僧、圣武士、游荡者、术士、邪术师。characterRace 保留玩家的具体种族或合理推断的种族；characterTalent 用不超过20字概括最鲜明的天赋。此请求时 narration 可用一句简短确认，choices 给出任意两个“继续创建角色”，check 为“角色创建”，dc 为 0。所有其他 requestType 的 characterClass、characterRace、characterTalent 必须返回空字符串。';

async function dm(req, res) {
  if (!process.env.OPENAI_API_KEY) { console.warn('[DM] 未调用 OpenAI：OPENAI_API_KEY 未配置'); return send(res, 503, JSON.stringify({ error: '未配置 OPENAI_API_KEY。' }), { 'Content-Type': 'application/json; charset=utf-8' }); }
  let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 4_000_000) return send(res, 413, JSON.stringify({ error: '画面数据过大' }), { 'Content-Type': 'application/json' }); }
  let context; try { context = JSON.parse(raw); } catch { return send(res, 400, JSON.stringify({ error: '请求格式无效' }), { 'Content-Type': 'application/json' }); }
  try {
    const image = typeof context.videoFrame === 'string' && /^data:image\/(jpeg|png);base64,/.test(context.videoFrame) ? context.videoFrame : null;
    delete context.videoFrame;
    const content = [{ type: 'input_text', text: `请按要求返回 json 对象，不要 Markdown。\n${JSON.stringify(context)}` }];
    if (image) content.push({ type: 'input_image', image_url: image });
    console.log(`[DM] 请求 OpenAI · model=${process.env.OPENAI_DM_MODEL || 'gpt-4o-mini'} · image=${image ? 'yes' : 'no'} · request=${context.requestType || 'scene'}`);
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_DM_MODEL || 'gpt-4o-mini', instructions: `${dmInstructions}\n${dmContinuityInstructions}\n${dmEventInstructions}\n${dmVisualInstructions}\n${dmAdventureInstructions}\n${dmCharacterCreationInstructions}\n${dmProfessionInstructions}`, input: [{ role: 'user', content }], text: { format: { type: 'json_schema', name: 'dungeon_scene', strict: true, schema: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, narration: { type: 'string' }, choices: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' }, check: { type: 'string' }, dc: { type: 'number' }, requiresRoll: { type: 'boolean' }, eventType: { type: 'string', enum: ['战斗', '社交', '探索', '危机', '抉择'] } }, required: ['text', 'check', 'dc', 'requiresRoll', 'eventType'] } }, passiveDC: { type: 'number' }, mood: { type: 'string' }, characterClass: { type: 'string', enum: ['', '战士', '游侠', '法师', '野蛮人', '吟游诗人', '牧师', '德鲁伊', '武僧', '圣武士', '游荡者', '术士', '邪术师'] }, characterRace: { type: 'string' }, characterTalent: { type: 'string' } }, required: ['title', 'narration', 'choices', 'passiveDC', 'mood', 'characterClass', 'characterRace', 'characterTalent'] } } }, max_output_tokens: 700, store: false })
    });
    const requestId = response.headers.get('x-request-id') || '无';
    if (!response.ok) { const detail = await response.text(); console.warn(`[DM] OpenAI 返回 ${response.status} · request_id=${requestId} · ${detail.slice(0, 600)}`); return send(res, response.status, JSON.stringify({ error: detail }), { 'Content-Type': 'application/json; charset=utf-8' }); }
    const result = await response.json();
    const outputText = result.output_text || result.output?.flatMap((item) => item.content || []).find((item) => item.type === 'output_text')?.text;
    const output = JSON.parse(outputText);
    if (!output.title || !output.narration || !Array.isArray(output.choices)) throw new Error('主持人未返回完整剧情对象');
    console.log(`[DM] OpenAI 成功 · request_id=${requestId} · title=${output.title} · choices=${output.choices.length}`);
    send(res, 200, JSON.stringify(output), { 'Content-Type': 'application/json; charset=utf-8' });
  } catch (error) { console.error(`[DM] 调用异常 · ${error.message}`); send(res, 502, JSON.stringify({ error: error.message }), { 'Content-Type': 'application/json; charset=utf-8' }); }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/api/health') { const config = realtimeConfig(); const doubaoTts = (process.env.TTS_PROVIDER || '').toLowerCase() === 'doubao' || Boolean(process.env.VOLCENGINE_TTS_API_KEY || process.env.VOLCENGINE_API_KEY); const tts = tts2Config(); return send(res, 200, JSON.stringify({ service: '第七号地下城主', ttsProtocolRevision: 'doubao-http-data-base64-20260903', openaiKeyConfigured: Boolean(process.env.OPENAI_API_KEY), ttsModel: doubaoTts ? 'seed-tts-2.0' : 'gpt-4o-mini-tts', ttsSpeaker: doubaoTts ? tts.speaker : process.env.OPENAI_TTS_VOICE || 'marin', dmModel: process.env.OPENAI_DM_MODEL || 'gpt-4o-mini', realtimeSpeech: { configured: realtimeMissing(config).length === 0, url: config.url, speaker: config.speaker, model: config.model } }), { 'Content-Type': 'application/json; charset=utf-8' }); }
  if (req.method === 'POST' && req.url === '/api/speech') return speech(req, res);
  if (req.method === 'POST' && req.url === '/api/dm') return dm(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
  const relative = req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not Found');
  send(res, 200, req.method === 'HEAD' ? undefined : fs.readFileSync(file), { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
});

server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`).pathname;
  if (pathname !== '/api/realtime') { socket.destroy(); return; }
  realtimeGateway.handleUpgrade(req, socket, head, (client) => realtimeGateway.emit('connection', client, req));
});

server.listen(port, '0.0.0.0', () => console.log(`第七号地下城主正在 http://127.0.0.1:${port} 运行 · 实时语音 WS: ws://127.0.0.1:${port}/api/realtime`));
