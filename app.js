const $ = (selector) => document.querySelector(selector);
const video = $('#video');
const state = {
  phase: 'welcome', module: null, creationStep: 0, character: null, party: [],
  videoReady: false, paused: false,
  decisionTimer: null, decisionSeconds: 60, speaking: false, generating: false, combat: null, currentAudio: null, audioUnlocked: false, audioContext: null, speechRequest: 0,
  history: [], currentScene: null, moduleScene: null, creationScene: null, questScene: null, resolvedClass: null, resolvedRace: null, mainQuest: null, lastChoicePrompt: -1, eventState: { clues: 0, trust: 0, threat: 0, effects: [], recentEvents: [] }
};

const modules = [
  { id: 'tide', name: '潮汐遗迹', tone: '标准奇幻', hook: '退潮后显露的古老阶梯，正通往一座不该存在的海底神殿。' },
  { id: 'lighthouse', name: '失灯塔', tone: '悬疑探索', hook: '一座熄灭百年的灯塔，在海雾深处重新亮起了第七盏灯。' },
  { id: 'echo', name: '雾港回声', tone: '轻松冒险', hook: '海港的钟声每晚少响一次，最后一声似乎被一只会说话的海鸥偷走了。' }
];

const classData = {
  战士: { hitDie: 10, ac: 16, saves: ['力量', '体质'], skills: ['运动', '察觉'], feature: '回气：每次短休或长休后可恢复一次。', stats: [15, 12, 14, 10, 13, 8] },
  游侠: { hitDie: 10, ac: 14, saves: ['力量', '敏捷'], skills: ['察觉', '求生', '调查'], feature: '自然探索者：在荒野追踪与辨路时特别可靠。', stats: [12, 15, 13, 10, 14, 8] },
  法师: { hitDie: 6, ac: 12, saves: ['智力', '感知'], skills: ['奥秘', '调查'], feature: '奥术回想：短休时可恢复部分已消耗的法术位。', stats: [8, 13, 14, 15, 12, 10] },
  野蛮人: { hitDie: 12, ac: 14, saves: ['力量', '体质'], skills: ['运动', '察觉'], feature: '狂暴：以凶猛意志抵御伤害、强化近战。', stats: [15, 14, 15, 8, 10, 8] },
  吟游诗人: { hitDie: 8, ac: 13, saves: ['敏捷', '魅力'], skills: ['表演', '游说', '洞悉'], feature: '诗人激励：以言语或旋律鼓舞同伴。', stats: [8, 14, 13, 12, 10, 15] },
  牧师: { hitDie: 8, ac: 16, saves: ['感知', '魅力'], skills: ['洞悉', '宗教'], feature: '神圣感知：能从信仰与仪式中辨认异象。', stats: [12, 10, 14, 10, 15, 13] },
  德鲁伊: { hitDie: 8, ac: 13, saves: ['智力', '感知'], skills: ['自然', '察觉'], feature: '德鲁伊语：掌握自然秘社留下的隐语与记号。', stats: [8, 14, 13, 12, 15, 10] },
  武僧: { hitDie: 8, ac: 14, saves: ['力量', '敏捷'], skills: ['运动', '洞悉'], feature: '武艺：徒手与简易武器都能化为精确招式。', stats: [10, 15, 13, 10, 14, 8] },
  圣武士: { hitDie: 10, ac: 16, saves: ['感知', '魅力'], skills: ['运动', '洞悉'], feature: '圣疗：以信念为同伴带来有限的疗愈。', stats: [15, 10, 14, 8, 12, 14] },
  游荡者: { hitDie: 8, ac: 14, saves: ['敏捷', '智力'], skills: ['隐匿', '调查', '察觉'], feature: '偷袭：趁敌人分神时造成额外伤害。', stats: [8, 15, 13, 12, 10, 14] },
  术士: { hitDie: 6, ac: 12, saves: ['体质', '魅力'], skills: ['奥秘', '游说'], feature: '术法起源：血脉或异象赐予你不稳定的魔力。', stats: [8, 14, 13, 12, 10, 15] },
  邪术师: { hitDie: 8, ac: 12, saves: ['感知', '魅力'], skills: ['奥秘', '威吓'], feature: '契约魔法：一份代价未明的契约回应你的呼唤。', stats: [8, 14, 14, 10, 10, 15] }
};

const ancestryBonus = {
  人类: [1, 1, 1, 1, 1, 1], 精灵: [0, 2, 0, 0, 0, 0], 矮人: [0, 0, 2, 0, 0, 0]
};

const names = ['岚', '伊莱恩', '索拉', '梅芙', '凯恩'];
// 剧情不再由固定时间轴或预置场景驱动；每段新剧情都由行动后的当前视频画面触发。

const actionKeywords = {
  '运动': '力量', '隐匿': '敏捷', '调查': '智力', '奥秘': '智力', '历史': '智力', '自然': '智力', '宗教': '智力',
  '察觉': '感知', '求生': '感知', '洞悉': '感知', '游说': '魅力', '威吓': '魅力', '表演': '魅力'
};

function mod(score) { return Math.floor((score - 10) / 2); }
function signed(value) { return value >= 0 ? `+${value}` : String(value); }
function randomDie() { return 1 + Math.floor(Math.random() * 20); }
function setDMState(label, active = true) { $('#dmState').textContent = label; $('#dmPulse').style.opacity = active ? '1' : '.25'; }
function setNarration(text) { $('#narration').textContent = text; }
function clearSuggestions() { $('#suggestions').innerHTML = ''; }
function stopDecision() { clearInterval(state.decisionTimer); state.decisionTimer = null; $('#countdown').classList.add('hidden'); }
function save() { localStorage.setItem('dnd-drive-session', JSON.stringify({ character: state.character, party: state.party, module: state.module, mainQuest: state.mainQuest, eventState: state.eventState })); }

function moodFor(text) {
  if (/战斗|攻击|浪刃|守卫/.test(text)) return '紧张、沉稳、节奏略快，像在战斗边缘压低声音。';
  if (/失败|危险|雾|阴影/.test(text)) return '压低声音，带有悬疑和不安，停顿清晰。';
  if (/成功|尾声|平静|盟友/.test(text)) return '温暖、克制且带有完成冒险后的余韵。';
  if (/选择|怎么做|轮到你/.test(text)) return '清晰、邀请式、略带期待，结尾留出自然行动停顿。';
  return '富有画面感的奇幻叙述，沉稳、亲切、带少量神秘感。';
}

function speechSpeedFor(mood) {
  if (/战斗|攻击|紧张|危险/.test(mood)) return { speed: 1.14, label: '战斗节奏' };
  if (/悬疑|不安|阴影|雾/.test(mood)) return { speed: 1.03, label: '悬疑节奏' };
  return { speed: 1.08, label: '叙述节奏' };
}

async function unlockAudioPlayback() {
  // 在真实点击中唤醒音频上下文，避免异步返回的模型音频被 Safari/Chrome 自动播放策略拦截。
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) { state.audioUnlocked = true; return; }
    state.audioContext ||= new AudioContext();
    if (state.audioContext.state !== 'running') await state.audioContext.resume();
    const oscillator = state.audioContext.createOscillator(); const gain = state.audioContext.createGain();
    gain.gain.value = 0; oscillator.connect(gain).connect(state.audioContext.destination); oscillator.start(); oscillator.stop(state.audioContext.currentTime + 0.01);
    state.audioUnlocked = state.audioContext.state === 'running';
  } catch { state.audioUnlocked = false; }
}

async function speak(text, after = null, moodOverride = null, updateNarration = true) {
  stopDecision(); state.speaking = true; setDMState('地下城主正在叙述'); if (updateNarration) setNarration(text);
  const voiceMood = moodOverride || moodFor(text); const voiceSpeed = speechSpeedFor(voiceMood);
  $('#voiceSpeed').textContent = `${voiceSpeed.label} ${voiceSpeed.speed.toFixed(2)}×`;
  const requestNumber = ++state.speechRequest;
  const finish = () => {
    state.speaking = false;
    after?.();
  };
  if ($('#soundBtn').dataset.on !== 'true') { finish(); return; }
  try {
    state.currentAudio?.pause();
    const response = await fetch('/api/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: text, mood: voiceMood }) });
    if (!response.ok) {
      let message = '模型语音暂不可用';
      try {
        const payload = await response.json();
        const detail = typeof payload.error === 'string' ? payload.error : '';
        message = detail ? `语音接口返回 ${response.status}：${detail.slice(0, 120)}` : `语音接口返回 ${response.status}`;
      } catch { message = `语音接口返回 ${response.status}`; }
      throw new Error(message);
    }
    // 当剧情快速推进时，旧旁白即使后返回也不应覆盖或打断最新一段。
    if (requestNumber !== state.speechRequest || $('#soundBtn').dataset.on !== 'true') return;
    const url = URL.createObjectURL(await response.blob());
    const audio = new Audio(url); audio.preload = 'auto'; audio.volume = 1; audio.muted = false; state.currentAudio = audio;
    audio.onended = () => { URL.revokeObjectURL(url); if (state.currentAudio === audio) state.currentAudio = null; finish(); };
    audio.onplay = () => { setDMState('地下城主正在说话'); $('#listenLabel').textContent = '正在播放模型语音…'; };
    audio.onerror = () => { URL.revokeObjectURL(url); setDMState('语音播放失败 · 请检查系统输出设备', false); $('#listenLabel').textContent = '语音已生成，但浏览器未能播放'; finish(); };
    await audio.play();
  } catch (error) {
    if (requestNumber !== state.speechRequest) return;
    const message = error?.message || '模型语音暂不可用';
    const diagnostic = error?.name === 'NotAllowedError' ? '浏览器阻止播放 · 请点击右上角「声」启用音频' : `语音不可用 · ${message}`;
    console.error('[语音诊断]', error);
    setDMState(diagnostic, false); $('#listenLabel').textContent = diagnostic; finish();
  }
}

function renderSuggestions(choices) {
  const detail = (check, dc, eventType, requiresRoll) => state.phase === 'creation' ? '也可以自由描述' : state.phase === 'quest_selection' ? '选定后展开故事' : (requiresRoll ?? Number(dc) > 0) ? `${eventType || '抉择'} · ${check} · DC ${dc}` : `${eventType || '抉择'} · 直接结算`;
  $('#suggestions').innerHTML = choices.map(([text, check, dc, eventType, requiresRoll], index) => `<button data-index="${index}"><b>${index + 1}. ${text}</b><small>${detail(check, dc, eventType, requiresRoll)}</small></button>`).join('');
  [...$('#suggestions').querySelectorAll('button')].forEach((button) => button.addEventListener('click', () => {
    const choice = choices[Number(button.dataset.index)];
    if (state.phase === 'creation') handleCreationAnswer(choice); else if (state.phase === 'quest_selection') handleQuestSelection(choice); else handleAction(choice);
  }));
}

function beginDecision(choices, passiveDC = 13, renderChoices = true) {
  if (renderChoices) renderSuggestions(choices);
  state.decisionSeconds = 60; $('#countdown').classList.remove('hidden');
  $('#listenLabel').textContent = '轮到你行动了'; setDMState('等待玩家行动', false);
  const render = () => { $('#countdown b').textContent = state.decisionSeconds; $('#countdown i').style.transform = `scaleX(${state.decisionSeconds / 60})`; };
  render();
  state.decisionTimer = setInterval(() => {
    state.decisionSeconds -= 1; render();
    if (state.decisionSeconds <= 0) { stopDecision(); passiveEvent(passiveDC); }
  }, 1000);
}

function selectedAbility(check) {
  if (!state.character) return '感知';
  if (check.includes('攻击检定')) return state.character.className === '战士' ? '力量' : state.character.className === '游侠' ? '敏捷' : '智力';
  return ['力量', '敏捷', '体质', '智力', '感知', '魅力'].find((name) => check.includes(name)) || actionKeywords[Object.keys(actionKeywords).find((key) => check.includes(key))] || '感知';
}

function classifyEvent(action, check, declaredType = '') {
  if (['战斗', '社交', '探索', '危机', '抉择'].includes(declaredType)) return declaredType;
  if (/攻击|挥剑|射箭|法术|突袭|格挡/.test(`${action} ${check}`)) return '战斗';
  if (/游说|威吓|表演|魅力|交谈|询问|欺骗/.test(`${action} ${check}`)) return '社交';
  if (/察觉|调查|奥秘|历史|求生|观察|寻找/.test(`${action} ${check}`)) return '探索';
  return '危机';
}

function activeEffects(ability) { return (state.eventState?.effects || []).filter((effect) => effect.ability === ability); }
function consumeEffects(ids) { if (ids?.length) state.eventState.effects = state.eventState.effects.filter((effect) => !ids.includes(effect.id)); }
function applyEventImpact(event, result) {
  const effect = (name, ability, bonus, narration, changes = {}) => ({ id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, name, ability, bonus, narration, changes });
  if (result.simple) {
    const impact = effect('选择改变局势', '', 0, '你的决定已改变队伍接下来的处境。');
    state.eventState.recentEvents = [...(state.eventState.recentEvents || []), `${event}直接推进`].slice(-4);
    return impact;
  }
  const pc = state.character;
  const hurt = (amount) => {
    if (!pc) return 0;
    const absorbed = Math.min(pc.tempHp || 0, amount); pc.tempHp = Math.max(0, (pc.tempHp || 0) - absorbed);
    const damage = amount - absorbed; pc.hp = Math.max(0, pc.hp - damage); return damage;
  };
  let impact;
  if (result.success && event === '探索') { state.eventState.clues += 1; impact = effect('发现线索', '感知', 1, '你发现了可利用的线索；下一次感知检定获得 +1。'); }
  else if (result.success && event === '社交') { state.eventState.trust += 1; impact = effect('赢得信任', '魅力', 1, '你的言辞赢得信任；下一次魅力检定获得 +1。', { trust: 1 }); }
  else if (result.success && event === '战斗') { state.eventState.threat = Math.max(0, state.eventState.threat - 1); pc.tempHp = Math.min(6, (pc.tempHp || 0) + 2); impact = effect('战意高涨', result.ability, 1, `你在交锋中站稳了脚跟，获得 2 点临时生命；下一次${result.ability}检定获得 +1。`, { tempHp: 2, threat: -1 }); }
  else if (result.success && event === '危机') { state.eventState.threat = Math.max(0, state.eventState.threat - 1); impact = effect('化险为夷', result.ability, 1, `危机被你化解；下一次${result.ability}检定获得 +1。`, { threat: -1 }); }
  else if (!result.success && (event === '战斗' || event === '危机')) { state.eventState.threat += 1; const damage = hurt(1 + Math.floor(Math.random() * 4)); impact = effect(damage ? '擦伤与压力' : '护盾承伤', '感知', -1, damage ? `冲击穿过防线，你失去 ${damage} 点生命；下一次感知检定承受 -1。` : '临时生命挡下了冲击；下一次感知检定承受 -1。', { hp: -damage, threat: 1 }); }
  else if (!result.success && event === '社交') { state.eventState.trust = Math.max(0, state.eventState.trust - 1); impact = effect('疑虑未消', '魅力', -1, '对方的疑虑尚未消散；下一次魅力检定承受 -1。', { trust: -1 }); }
  else impact = effect('险中得讯', '感知', 1, '挫折留下了可利用的警讯；下一次感知检定获得 +1。');
  state.eventState.effects.push(impact);
  state.eventState.recentEvents = [...(state.eventState.recentEvents || []), `${event}${result.success ? '成功' : '受挫'}`].slice(-4);
  return impact;
}

function resultNarration(event, action, result, impact) {
  const outcome = result.simple ? '顺利落定' : result.success ? '成功了' : '没有完全如愿';
  return `你的行动${outcome}。${impact.narration}`;
}

function choiceVoice(choices, context = 'game') {
  const items = choices.map(([text]) => text.replace(/[。！？!?]+$/g, '')).filter(Boolean);
  const [first = '向前一步', second = '暂且等待', third = '另寻出路'] = items;
  if (context === 'character') return `在这片土地的传说里，或许会出现${first}；也可能是${second}；又或者，是${third}。哪一种身影更接近真正的你？`;
  if (context === 'name') return items.length === 1 ? `这个名字会先被风带走，再被同伴记住。你愿意接受${first}吗？` : `人们可以称你为${first}，也可以称你为${second}${third ? `，或是${third}` : ''}。哪一个名字会回应你的脚步？`;
  if (context === 'motivation') return `也许你是为了${first}；也许是为了${second}${third ? `；又或者，是为了${third}` : ''}。说说，究竟是什么把你带到这里？`;
  if (context === 'quest') return `三条委托正等待被揭开：${first}、${second}${third ? `，以及${third}` : ''}。你愿意让哪一条成为这趟旅程的主线？`;
  const prompts = [
    `眼前有几种可行的尝试：${first}；${second}${third ? `；或是${third}` : ''}。同伴正等着你的判断。`,
    `若你愿意，可以${first}；也可以${second}${third ? `；必要时还可${third}` : ''}。故事会随你的决定转向。`,
    `时间悄然流过。${first}、${second}${third ? `与${third}` : ''}，每一条路都可能留下不同的回声。`
  ];
  let index = Math.floor(Math.random() * prompts.length);
  if (prompts.length > 1 && index === state.lastChoicePrompt) index = (index + 1) % prompts.length;
  state.lastChoicePrompt = index;
  return prompts[index];
}

function speakScene(scene, prefix = '') {
  const narrateScene = () => speak(scene.narration, () => {
    const prompt = choiceVoice(scene.choices);
    setDMState('地下城主正在给出选择');
    // 选项属于独立引导：不写入剧情框，并从播报开始时就显示给玩家。
    renderSuggestions(scene.choices); $('#listenLabel').textContent = '主持人正在介绍可选行动';
    speak(prompt, () => beginDecision(scene.choices, scene.passiveDC, false), '清晰、邀请式、略带期待，像在桌前等待玩家作出决定。', false);
  }, scene.mood);
  // 检定/危机结算是独立播报：保留语音与骰子动画，但不污染下一幕的剧情文字。
  if (prefix) speak(prefix, narrateScene, '清晰、克制地播报检定结果与事件影响。', false);
  else narrateScene();
}

function rollCheck(check, dc, advantage = false) {
  const ability = selectedAbility(check); const skill = Object.keys(actionKeywords).find((key) => check.includes(key));
  const proficient = state.character.skills.includes(skill) || (check.includes('豁免') && state.character.saves.includes(ability));
  const rolls = advantage ? [randomDie(), randomDie()] : [randomDie()];
  const chosenIndex = advantage ? (rolls[1] > rolls[0] ? 1 : 0) : 0;
  const die = rolls[chosenIndex]; const abilityMod = mod(state.character.scores[ability]); const effects = activeEffects(ability); const eventBonus = effects.reduce((sum, effect) => sum + effect.bonus, 0); const proficiency = proficient ? 2 : 0;
  const bonus = abilityMod + proficiency + eventBonus; const total = die + bonus;
  return { ability, rolls, chosenIndex, die, abilityMod, proficiency, eventBonus, appliedEffectIds: effects.map((effect) => effect.id), bonus, total, dc, success: total >= dc };
}

function renderRoll(check, result) {
  const score = state.character.scores[result.ability];
  const dice = result.rolls.map((value, index) => `<div class="d20 ${index === result.chosenIndex ? 'chosen' : 'discarded'} rolling" style="--roll-delay:${index * 90}ms"><span>d20</span><b data-final="${value}">?</b>${result.rolls.length > 1 ? `<small>${index === result.chosenIndex ? '采用' : '舍弃'}</small>` : ''}</div>`).join('');
  const modifierDice = Array.from({ length: Math.max(1, Math.min(3, Math.ceil(Math.abs(result.abilityMod) / 2) || 1)) }, (_, index) => `<i class="modifier-die ${result.abilityMod < 0 ? 'negative' : ''} rolling" style="--roll-delay:${index * 70}ms">${index === 0 ? signed(result.abilityMod) : '·'}</i>`).join('');
  $('#roll').classList.remove('hidden');
  $('#roll').innerHTML = `<div class="roll-heading"><span>${check}</span><b class="${result.success ? 'success' : 'failure'}">${result.success ? '检定成功' : '检定失败'}</b></div><div class="dice-tray"><div class="check-dice"><small>${result.rolls.length === 2 ? '优势检定 · 取较高值' : '能力检定 · 掷 1 枚 d20'}</small><div class="dice-row">${dice}</div></div><div class="roll-divider">+</div><div class="attribute-dice"><small>${result.ability} ${score} · 属性修正${result.eventBonus ? ` · 事件 ${signed(result.eventBonus)}` : ''}</small><div class="dice-row">${modifierDice}</div></div>${result.proficiency ? `<div class="roll-divider">+</div><div class="proficiency-token"><small>熟练加值</small><b>+${result.proficiency}</b></div>` : ''}<div class="roll-divider">=</div><div class="roll-total"><small>对抗 DC ${result.dc}</small><b id="rollTotal" data-final="${result.total}">?</b></div></div>`;
  setTimeout(() => { document.querySelectorAll('#roll [data-final]').forEach((die) => { die.textContent = die.dataset.final; }); document.querySelectorAll('#roll .rolling').forEach((die) => die.classList.remove('rolling')); }, 700);
}

function modelContext(extra = {}) {
  return {
    module: state.module, mainQuest: state.mainQuest, character: state.character, party: state.party,
    videoTime: Math.floor(video.currentTime || 0), sceneHistory: state.history.slice(-8), eventState: state.eventState,
    combat: state.combat ? { round: state.combat.round, resources: state.combat.resources } : null,
    ...extra
  };
}

function normalizeScene(scene, fallback) {
  if (!scene?.narration || !Array.isArray(scene.choices)) return fallback;
  return { title: scene.title || fallback.title, narration: scene.narration, mood: scene.mood, characterClass: scene.characterClass || '', characterRace: scene.characterRace || '', characterTalent: scene.characterTalent || '', passiveDC: Number(scene.passiveDC) || 13, choices: scene.choices.slice(0, 3).map((choice) => { const requiresRoll = Boolean(choice.requiresRoll) && Number(choice.dc) > 0; return [choice.text, choice.check || '直接结算', requiresRoll ? Math.max(5, Math.min(30, Number(choice.dc))) : 0, ['战斗', '社交', '探索', '危机', '抉择'].includes(choice.eventType) ? choice.eventType : '抉择', requiresRoll]; }) };
}

function firstFrameAnchor() {
  const frame = captureVideoFrame(); const capturedAt = Math.round(video.currentTime || 0);
  return { frame, visualAnchor: { capturedAt, description: '这是视频第一帧。先辨认画面中最显著的 2 到 4 个可见特征，例如主体、地貌、道路、建筑、天气、光线、颜色或运动方向；不要猜测真实地点。将至少两个特征分别转译进三个彼此风格不同的原创冒险模组：探索、悬疑和英雄行动各一个。' } };
}

function waitForVideoFrame() {
  if (video.videoWidth && video.videoHeight && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    video.addEventListener('loadeddata', done, { once: true });
    setTimeout(done, 1200);
  });
}

async function askDM(extra, fallback) {
  setDMState('地下城主正在构思', true);
  try {
    const response = await fetch('/api/dm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(modelContext(extra)) });
    if (!response.ok) throw new Error('主持人模型暂不可用');
    return normalizeScene(await response.json(), fallback);
  } catch {
    return fallback;
  }
}

function describeResult(action, check, result, declaredType = '') {
  clearSuggestions(); stopDecision();
  if (!result.simple) renderRoll(check, result); else $('#roll').classList.add('hidden');
  const event = classifyEvent(action, check, declaredType); consumeEffects(result.appliedEffectIds); const impact = applyEventImpact(event, result); renderSheet(); save();
  const resultVoice = resultNarration(event, action, result, impact);
  state.history.push({ action, check, event, impact: impact.name, result: { total: result.total, dc: result.dc, success: result.success } });
  const fallback = { title: `${event}的余波`, narration: result.success ? `你的行动“${action}”奏效了。${impact.narration}局势向小队倾斜，而道路仍在延伸。你准备如何利用这个机会？` : `你的行动没有完全达到预期。${impact.narration}你们得到了一点线索，同时付出了时间或位置上的代价。你接下来怎么做？`, choices: currentChoices(), passiveDC: 13 };
  const visual = captureStoryAnchor();
  state.generating = true;
  askDM({ requestType: 'resolve_action', event, impact, resultNarration: resultVoice, currentAnchor: state.currentScene?.anchor, previousScene: state.currentScene ? { title: state.currentScene.title, narration: state.currentScene.narration } : null, playerAction: action, check, result, visualAnchor: visual.anchorData, videoFrame: visual.frame }, fallback).then((scene) => {
    state.generating = false;
    state.currentScene = { ...scene, anchor: visual.anchor };
    $('#phase').textContent = scene.title;
    speakScene(scene, resultVoice);
  });
}

function passiveEvent(dc) {
  clearSuggestions(); const score = state.character.passive;
  const text = score >= dc ? `当沉默拖长时，你的被动察觉先一步捕捉到了异常。你从车窗外的变化里察觉一丝不协调，队伍及时做好了准备。` : `沉默给了未知可乘之机。远处的景物被吞没了一瞬，新的威胁已逼近，但故事仍在继续。`;
  const result = { ability: '感知', die: score, bonus: 0, total: score, dc, success: score >= dc };
  const event = '被动事件'; const impact = applyEventImpact(result.success ? '探索' : '危机', result); renderSheet(); save();
  const resultVoice = `沉默中的察觉${result.success ? '及时奏效' : '慢了一步'}。${impact.narration}`;
  state.history.push({ action: '等待并触发被动察觉', check: '被动察觉', event, impact: impact.name, result });
  const visual = captureStoryAnchor(); const fallback = { title: '沉默后的异动', narration: `${text} 眼前的风景为这份预感添上了新的证据。你准备如何应对？`, choices: currentChoices(), passiveDC: 13 };
  state.generating = true;
  askDM({ requestType: 'passive_event', event, impact, resultNarration: resultVoice, currentAnchor: state.currentScene?.anchor, previousScene: state.currentScene ? { title: state.currentScene.title, narration: state.currentScene.narration } : null, playerAction: '等待并触发被动察觉', check: '被动察觉', result, visualAnchor: visual.anchorData, videoFrame: visual.frame }, fallback).then((scene) => {
    state.generating = false; state.currentScene = { ...scene, anchor: visual.anchor }; $('#phase').textContent = scene.title;
    speakScene(scene, resultVoice);
  });
}

function finishAction() {
  clearSuggestions(); stopDecision(); save();
  if (state.combat) {
    const r = state.combat.resources;
    const remaining = `${r.movement ? '移动' : ''}${r.action ? `${r.movement ? '、' : ''}动作` : ''}${r.bonus ? `${(r.movement || r.action) ? '、' : ''}附赠动作` : ''}`;
    speak(remaining ? `你仍拥有${remaining}。要继续行动，还是结束回合？` : '你的主要资源已经用完。你可以结束回合，或在触发条件出现时保留反应。', () => beginDecision([...currentChoices(), ['结束回合', '结束回合', 0]], 14));
    return;
  }
  $('#listenLabel').textContent = '等待道路带来新的变化'; setDMState('地下城主观察道路', false);
}

function captureVideoFrame() {
  if (!video.videoWidth || !video.videoHeight) return null;
  const maxWidth = 960; const scale = Math.min(1, maxWidth / video.videoWidth);
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.72);
}

function captureStoryAnchor() {
  const frame = captureVideoFrame(); const capturedAt = Math.round(video.currentTime || 0);
  const anchor = frame ? `视频 ${time(capturedAt)} 的车外画面` : '当前视频画面不可用';
  $('#sceneTag').textContent = `视觉锚点 · ${anchor}`;
  if (frame) { $('#frameImage').src = frame; $('#frameCaption').textContent = `本幕画面 · ${time(capturedAt)}`; $('#framePreview').classList.remove('hidden'); }
  return { frame, anchor, anchorData: { capturedAt, description: '所附截图可作为下一幕的现实锚点，但玩家刚刚选择及其结算是优先级最高的剧情因果。先承接它造成的直接后果；只有画面出现与剧情相关的明显变化时，才提取 1 到 2 个显著特征转化为异世界地标、NPC、遭遇或线索。车辆行驶可表示世界时间流逝、区域跳转；不要臆测真实地点，也不要为了使用截图而重复描述风景。行动选项应体现大胆、谨慎或社交等不同策略。' } };
}

async function chooseMainQuest() {
  clearSuggestions();
  const fallback = {
    title: '三道委托',
    narration: '你们踏入新地名的第一刻，三条传闻同时抵达：失物、旧誓与一扇只在特定时辰开启的门。哪一件事最值得先追？',
    choices: [['追寻失落罗盘', '选择主线', 0], ['回应守望者旧誓', '选择主线', 0], ['寻找潮门的钥匙', '选择主线', 0]],
    passiveDC: 13,
    mood: '庄重、神秘、带有启程前的紧迫感'
  };
  const scene = await askDM({
    requestType: 'main_quest_options',
    openingScene: state.module?.hook,
    instruction: '根据场景、角色、动机与三位 NPC，给出三个可选择的原创主线任务。narration 用短叙事呈现三条委托同时出现的时刻；choices 必须是三个任务名，check 固定“选择主线”，dc 为 0。不要进入实际遭遇，也不要剧透真相。'
  }, fallback);
  state.questScene = { ...scene, anchor: state.module?.name || '开场画面' };
  $('#phase').textContent = '选择主线委托';
  speak(scene.narration, () => {
    renderSuggestions(scene.choices); const prompt = choiceVoice(scene.choices, 'quest');
    speak(prompt, () => { $('#listenLabel').textContent = '选择一条主线委托'; setDMState('等待旅人决定', false); }, '庄重、神秘，像三封委托正在桌上展开。', false);
  }, scene.mood);
}

async function handleQuestSelection(value) {
  clearSuggestions();
  const selectedQuest = Array.isArray(value) ? value[0] : String(value).trim();
  const fallback = { title: selectedQuest, narration: `你们决定追随“${selectedQuest}”。这条线索已经在眼前景象中留下痕迹，同行者也各自握紧了理由。第一步该如何迈出？`, choices: [['循着可见线索前进', '感知（求生）', 13], ['向同伴询问情报', '魅力（游说）', 12], ['检查随身物品与环境', '智力（调查）', 13]], passiveDC: 13, mood: '庄重、期待、带有启程的紧迫感' };
  const scene = await askDM({ requestType: 'main_quest_commit', selectedQuest, previousScene: state.questScene ? { title: state.questScene.title, narration: state.questScene.narration } : null, openingScene: state.module?.hook, instruction: '围绕 selectedQuest 建立已经被选定的主线。title 使用该任务的正式名称；narration 简洁交代目标、迫近代价与队伍为何同行，并立刻呈现可行动的第一步。choices 是实际行动，而不是任务选择。不要重新描述开场画面。' }, fallback);
  state.mainQuest = { title: scene.title, objective: scene.narration, status: '进行中' };
  state.currentScene = { ...scene, anchor: state.module?.name || '开场画面', combatRecommended: false };
  state.phase = 'game'; renderSheet(); save();
  $('#phase').textContent = `主线任务 · ${scene.title}`;
  speakScene(scene);
}

async function triggerVisualScene(reason) {
  if (state.phase !== 'game' || state.paused) return;
  stopDecision();
  clearSuggestions(); const visual = captureStoryAnchor();
  const fallback = { title: '道路上的异动', narration: '前方的异动没有给小队从容准备的时间；上一项行动留下的余波，正逼迫你们立刻作出回应。', choices: [['抢在异响前夺下有利位置', '敏捷（隐匿）', 13, '危机'], ['向现身的陌生人开出条件', '魅力（游说）', 12, '社交'], ['以武器或法术截断逼近的威胁', '攻击检定', 13, '战斗']], passiveDC: 13 };
  const scene = await askDM({ requestType: 'visual_scene', triggerReason: reason, previousScene: state.currentScene ? { title: state.currentScene.title, narration: state.currentScene.narration } : null, visualAnchor: visual.anchorData, videoFrame: visual.frame }, fallback);
  state.currentScene = { ...scene, anchor: visual.anchor, combatRecommended: false };
  $('#phase').textContent = scene.title;
  speakScene(scene);
}

function startCombat(event) {
  const playerInit = randomDie() + mod(state.character.scores.敏捷); const foeInit = randomDie() + 2;
  state.combat = { round: 1, resources: { movement: true, action: true, bonus: true, reaction: true }, playerFirst: playerInit >= foeInit };
  const order = state.combat.playerFirst ? `你先行动（先攻 ${playerInit} 对 ${foeInit}）。` : `深潮守卫抢得先机（先攻 ${foeInit} 对 ${playerInit}），它的浪刃掠过礁石后停在你们面前。现在轮到你。`;
  speak(`${event.text} ${order} 本回合你拥有移动、一个动作、可能的附赠动作和反应。`, () => beginDecision(event.choices, event.passiveDC || 14), event.mood);
}

function combatAction(action, check, dc) {
  const r = state.combat.resources;
  if (/攻击|施展|法术/.test(action) && !r.action) { speak('你的主要动作已经使用。你仍可移动、使用符合条件的附赠动作，或结束回合。', () => beginDecision(currentChoices())); return; }
  if (/攻击|施展|法术/.test(action)) r.action = false;
  const result = rollCheck(check, dc, /协助/.test(action)); describeResult(action, check, result);
}

function currentChoices() { return state.currentScene?.choices || [['抢占有利位置并逼近目标', '敏捷（隐匿）', 13, '危机'], ['以一句承诺撬开对方的防线', '魅力（游说）', 12, '社交'], ['亮出武器或法术迫使威胁后退', '攻击检定', 13, '战斗']]; }
function endCombatTurn() {
  state.combat.round += 1;
  if (state.combat.round > 3) {
    state.combat = null;
    speak('深潮守卫的浪刃终于碎成温柔的雨。潮汐钥匙从水幕中落下，战斗结束。', () => finishAction());
    return;
  }
  state.combat.resources = { movement: true, action: true, bonus: true, reaction: true };
  speak(`第 ${state.combat.round} 轮。深潮守卫卷起一道浪刃，玛拉替你挡开了最锋利的部分。现在轮到你，你重新获得移动、动作与附赠动作。`, () => beginDecision([...currentChoices(), ['结束回合', '结束回合', 0]], 14));
}
function handleAction(choice) {
  if (typeof choice === 'string' && /^(暂停冒险|暂停|等一下|别说话)$/.test(choice.trim())) { pauseGame(); return; }
  if (typeof choice === 'string' && /^(继续冒险|继续)$/.test(choice.trim()) && state.paused) { pauseGame(); return; }
  if (typeof choice === 'string' && /角色卡|状态|生命/.test(choice.trim())) { stopDecision(); $('#sheet').showModal(); speak('角色卡已经打开。查看完毕后，请告诉我你的行动。', () => beginDecision(currentChoices())); return; }
  stopDecision(); const [action, check, dc, eventType = '', requiresRoll = Number(dc) > 0] = Array.isArray(choice) ? choice : inferFreeAction(choice);
  if (state.combat && /结束回合/.test(action)) { endCombatTurn(); return; }
  if (state.combat) { combatAction(action, check, dc); return; }
  const result = requiresRoll && Number(dc) > 0
    ? rollCheck(check, dc, /协助|同伴/.test(action))
    : { ability: selectedAbility(check), total: 0, dc: 0, success: true, simple: true, appliedEffectIds: [] };
  describeResult(action, check, result, eventType);
}

function inferFreeAction(text) {
  if (/暂停|等一下|别说/.test(text)) { pauseGame(); return ['暂停', '感知（察觉）', 5]; }
  if (/角色卡|状态|生命/.test(text)) { $('#sheet').showModal(); speak('角色卡已经打开。查看完毕后，请告诉我你的行动。'); return ['查看角色卡', '感知（察觉）', 5]; }
  if (/接受|答应|跟随|前往|出发|使用线索|交出|递上|休息|绕路/.test(text)) return [text, '直接结算', 0, '抉择', false];
  if (/攻击|射箭|挥剑/.test(text)) return [text, '攻击检定', 13];
  if (/法术|奥术|幻术/.test(text)) return [text, '智力（奥秘）', 14];
  if (/说服|交谈|询问/.test(text)) return [text, '魅力（游说）', 13];
  if (/观察|寻找|查看/.test(text)) return [text, '感知（察觉）', 12];
  return [text, state.character.className === '法师' ? '智力（奥秘）' : '感知（察觉）', 15];
}

function inferClassName(concept) {
  return /野蛮|狂战/.test(concept) ? '野蛮人' : /吟游|诗人|乐师/.test(concept) ? '吟游诗人' : /牧师|祭司|神官/.test(concept) ? '牧师' : /德鲁伊|自然使者/.test(concept) ? '德鲁伊' : /武僧|拳师/.test(concept) ? '武僧' : /圣武|骑士|誓言/.test(concept) ? '圣武士' : /游荡者|盗贼|刺客|潜行/.test(concept) ? '游荡者' : /术士|血脉魔法/.test(concept) ? '术士' : /邪术|契约/.test(concept) ? '邪术师' : /法师|幻术|奥术|魔法/.test(concept) ? '法师' : /游侠|弓|追踪|荒野/.test(concept) ? '游侠' : '战士';
}

function buildCharacter(concept, name, ancestry, motivation, talent = '在关键时刻总能找到自己的方法', resolvedClass = '') {
  const className = classData[resolvedClass] ? resolvedClass : inferClassName(concept);
  const race = ancestry?.trim() || '人类';
  const bonusKey = /精灵/.test(race) ? '精灵' : /矮人/.test(race) ? '矮人' : /人类/.test(race) ? '人类' : null;
  const base = classData[className].stats; const bonuses = bonusKey ? ancestryBonus[bonusKey] : [0, 0, 0, 0, 0, 0]; const labels = ['力量', '敏捷', '体质', '智力', '感知', '魅力'];
  const scores = Object.fromEntries(labels.map((label, i) => [label, base[i] + bonuses[i]]));
  const skills = [...classData[className].skills, ...(className === '法师' ? ['历史'] : ['洞悉'])];
  const maxHp = classData[className].hitDie + mod(scores.体质);
  state.character = { name: name || names[Math.floor(Math.random() * names.length)], className, race, concept, motivation, talent, hitDie: classData[className].hitDie, scores, skills, saves: classData[className].saves, hp: maxHp, maxHp, tempHp: 0, ac: classData[className].ac, passive: 10 + mod(scores.感知) + (skills.includes('察觉') ? 2 : 0), feature: classData[className].feature };
  state.party = makeParty(className); renderSheet(); save();
}

function makeParty(className) {
  const pool = ['战士', '游侠', '法师'].filter((item) => item !== className);
  return [
    { name: '玛拉', className: pool[0], motive: '想找回失踪的弟弟' },
    { name: '托恩', className: pool[1], motive: '受灯塔守望者的旧誓约束' },
    { name: '伊西尔', className: '牧师', motive: '相信潮汐钥匙能证明自己的学说' }
  ];
}

function renderSheet() {
  const pc = state.character; if (!pc) return;
  $('#pcName').textContent = pc.name; $('#pcIdentity').textContent = `1级 · ${pc.race}${pc.className}`; $('#pcConcept').textContent = pc.concept;
  $('#abilities').innerHTML = Object.entries(pc.scores).map(([name, value]) => `<div><span>${name}</span><b>${value}</b><small>${signed(mod(value))}</small></div>`).join('');
  const maxHp = pc.maxHp || pc.hp; const hpText = `${pc.hp} / ${maxHp}${pc.tempHp ? `（临时 ${pc.tempHp}）` : ''}`;
  $('#hp').textContent = hpText; $('#ac').textContent = pc.ac; $('#passive').textContent = pc.passive; $('#skills').textContent = pc.skills.join('、'); $('#features').textContent = `${pc.feature} 天赋：${pc.talent}。`; $('#sheetDice').textContent = `能力、攻击与豁免检定使用 d20；${pc.className}的生命骰为 d${pc.hitDie}，用于决定生命值与休整恢复。`;
  $('#backstory').textContent = `${pc.motivation}。你的天赋是“${pc.talent}”。这使你接受了这段道路尽头的委托。`;
  $('#party').innerHTML = state.party.map((npc) => `<p><b>${npc.name}</b> · ${npc.className}<br>${npc.motive}</p>`).join('');
  $('#sidePcName').textContent = pc.name; $('#sidePcIdentity').textContent = `1级 · ${pc.race}${pc.className}`; $('#sidePcConcept').textContent = pc.concept;
  $('#sideAbilities').innerHTML = Object.entries(pc.scores).map(([name, value]) => `<div><span>${name}</span><b>${value}</b><small>${signed(mod(value))}</small></div>`).join('');
  $('#sideHp').textContent = hpText; $('#sideAc').textContent = pc.ac; $('#sidePassive').textContent = pc.passive; $('#sideSkills').textContent = pc.skills.join('、'); $('#sideFeature').textContent = `${pc.feature} 天赋：${pc.talent}。`; $('#sideDice').textContent = `检定 d20 · ${pc.className}生命骰 d${pc.hitDie}`;
  const questText = state.mainQuest ? `${state.mainQuest.title}：${state.mainQuest.objective}` : '角色完成后，由地下城主揭示。';
  $('#sheetQuest').textContent = questText;
  const effects = state.eventState?.effects || []; const summary = `线索 ${state.eventState.clues} · 信任 ${state.eventState.trust} · 威胁 ${state.eventState.threat}`;
  const effectText = `${summary}${effects.length ? `\n${effects.map((effect) => `${effect.name}：${effect.ability}检定 ${signed(effect.bonus)}（下次生效）`).join('；')}` : ' · 尚无临时状态。'}`;
  $('#storyEffectText').textContent = effectText; $('#sheetEffects').textContent = effectText;
  $('#sideSheet').classList.remove('hidden');
}

const creation = [
  { question: '车窗外的景色正在为一段传说铺开序幕。欢迎你，亲爱的旅人。请告诉我你的名字。', choices: [['请主持人替我取名', '确定名字', 0], ['岚', '确定名字', 0], ['梅芙', '确定名字', 0]] },
  { question: '现在用一句话描绘你想成为的人：来历、种族、职业、性格与天赋都可以包含其中。它会决定角色卡的核心。', choices: [['来自地底、擅长蛊惑人心的矮人巫师', '角色设定', 0], ['背着旧弓、沉默守望的精灵游侠', '角色设定', 0], ['信奉晨星、总在危难时说笑的牧师', '角色设定', 0]] },
  { question: '那么，是什么把你带到这里？你为什么来到这片陌生的景象之前？', choices: [['寻找失踪的人', '确定动机', 0], ['保护同行者', '确定动机', 0], ['追寻失落知识', '确定动机', 0]] }
];

const creationStages = [
  { key: 'name', label: '名字', help: '你的名字将在这片土地被第一次呼唤' },
  { key: 'character', label: '角色设定', help: '一句话确定种族、职业、来历、性格与天赋' },
  { key: 'motivation', label: '动机', help: '成为你与主线、NPC 关系的个人牵引' }
];

async function beginCreation() {
  state.phase = 'creation'; state.creationStep = 0; clearSuggestions();
  await waitForVideoFrame();
  const visual = firstFrameAnchor();
  const fallback = { title: '晨雾驿道', narration: '第一缕光落在车窗外，远处的轮廓像一扇尚未推开的门。欢迎来到晨雾驿道，亲爱的旅人。请告诉我你的名字。', choices: [['岚', '确定名字', 0], ['梅芙', '确定名字', 0], ['请主持人替我取名', '确定名字', 0]], passiveDC: 13 };
  askDM({ requestType: 'opening_name', visualAnchor: visual.visualAnchor, videoFrame: visual.frame, instruction: '先用 1 到 2 句描绘视频第一帧真正可见的主体、光线、地貌、道路或天气，并将其化为奇幻场景。接着为场景取一个原创地名，以“欢迎来到XX，亲爱的旅人，请告诉我你的名字”自然收束。choices 给出 2 到 3 个有世界观气息的名字建议，check 为“确定名字”，dc 为 0。绝不解释步骤或出现幕后用语。' }, fallback).then((scene) => { state.moduleScene = scene; runCreation(); });
}
async function runCreation() {
  const base = creation[state.creationStep];
  const stage = creationStages[state.creationStep];
  $('#phase').textContent = state.creationStep === 0 ? '故事开场' : `角色创建 · ${state.creationStep + 1}/3 · ${stage.label}`; $('#sceneTag').textContent = state.creationStep === 0 ? '车窗外的第一幕 · 传说正在苏醒' : '主持人正在编织你的传说';
  let scene;
  if (state.creationStep === 0) scene = state.moduleScene || { narration: base.question, choices: base.choices };
  else {
    const fallback = { title: `角色创建 · ${stage.label}`, narration: base.question, choices: base.choices, passiveDC: 13, mood: '亲切、好奇，像主持人正在了解一位新旅人' };
    scene = await askDM({
      requestType: 'character_creation',
      creationStage: stage.key,
      creationStageLabel: stage.label,
      creationAnswers: { background: state.module?.name, character: state.concept, name: state.name, motivation: state.motivation },
      instruction: '只引导当前 creationStage 指定的一个角色信息，不要抢先询问后续问题。问题和选项须根据已选旅程、前序回答和视频意象原创生成。角色设定步骤必须恰好给出三条完整可选的人物设定事例；每条都要包含来历、种族、职业，以及性格或天赋，例如“来自地底、擅长蛊惑人心的矮人巫师”。禁止出现“完善角色设定”“选择背景故事”“继续创建”等流程性选项。'
    }, fallback);
  }
  state.creationScene = scene;
  const step = { question: scene.narration || base.question, choices: scene.choices || base.choices };
  // 创建阶段与正式剧情保持一致：问题和选项分开念，选项语音开始时即可点击。
  speak(step.question, () => {
    const prompt = choiceVoice(step.choices, stage.key);
    setDMState('地下城主正在给出选择');
    renderSuggestions(step.choices); $('#listenLabel').textContent = '主持人正在介绍可选回答';
    speak(prompt, () => { $('#listenLabel').textContent = '回答地下城主的问题'; setDMState('等待玩家回答', false); }, '清晰、邀请式、略带期待，像在桌前等待玩家作出决定。', false);
  });
}
function inferRace(profile) { return /矮人/.test(profile) ? '矮人' : /精灵/.test(profile) ? '精灵' : /人类/.test(profile) ? '人类' : '人类'; }

async function resolveCharacter(concept) {
  const fallback = { title: '角色映射', narration: '主持人正在校准角色规则。', choices: [['继续创建角色', '角色创建', 0], ['继续创建角色', '角色创建', 0]], passiveDC: 13, characterClass: inferClassName(concept), characterRace: inferRace(concept), characterTalent: concept };
  const scene = await askDM({
    requestType: 'resolve_character',
    characterDescription: concept,
    creationAnswers: { background: state.module?.name, character: concept },
    instruction: '从 characterDescription 提取或合理推断角色的种族、职业与最鲜明天赋。将职业映射为最贴切的一个 5e 标准职业；若设定是混合概念，选择最能体现其核心行动方式的职业。'
  }, fallback);
  return { className: classData[scene.characterClass] ? scene.characterClass : fallback.characterClass, race: scene.characterRace || fallback.characterRace, talent: scene.characterTalent || fallback.characterTalent };
}

async function handleCreationAnswer(value) {
  // 回答一经提交立即移除本轮选项，避免主持人推进时仍可重复选择旧问题。
  clearSuggestions();
  const answer = Array.isArray(value) ? value[0] : value.trim();
  if (state.creationStep === 0) {
    state.name = /主持人.*取名/.test(answer) ? names[Math.floor(Math.random() * names.length)] : answer;
    state.module = { id: `opening-${Date.now()}`, name: state.moduleScene?.title || '未命名之地', tone: '视频启发的奇幻场景', hook: state.moduleScene?.narration || '车窗外的第一幕，已经化作一段等待踏入的传说。' };
  }
  if (state.creationStep === 1) { state.concept = answer; const resolved = await resolveCharacter(answer); state.resolvedClass = resolved.className; state.resolvedRace = resolved.race; state.talent = resolved.talent; }
  if (state.creationStep === 2) {
    state.motivation = answer;
    buildCharacter(state.concept || '一名谨慎的冒险者', state.name, state.resolvedRace || '人类', state.motivation, state.talent, state.resolvedClass);
    const pc = state.character; const intro = `${pc.name}，一位${pc.race}${pc.className}。${pc.talent}，这正是人们会记住你的地方。玛拉、托恩和伊西尔已在你身旁；你们将共同踏入${state.module.name}。`;
    state.phase = 'quest_selection'; video.play().catch(() => {}); speak(intro, () => chooseMainQuest()); return;
  }
  state.creationStep += 1; runCreation();
}

function onVideoProgress() {
  if (!['game', 'quest_selection'].includes(state.phase) || state.paused || !Number.isFinite(video.currentTime)) return;
  const ratio = video.duration ? video.currentTime / video.duration : 0; $('#progress').style.width = `${ratio * 100}%`; $('#clock').textContent = `${time(video.currentTime)} / ${time(video.duration || 600)}`;
}

function time(seconds) { const n = Math.floor(seconds || 0); return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; }
function pauseGame() { state.paused = !state.paused; if (state.paused) { video.pause(); stopDecision(); $('#pauseBtn').textContent = '继续冒险'; speak('冒险已暂停。道路和潮声都在等待。'); } else { video.play().catch(() => {}); $('#pauseBtn').textContent = '暂停冒险'; speak('冒险继续。让我先回顾当前局面。', () => beginDecision(currentChoices())); } }

// 语音默认开启；首次点击“开始冒险”会同步解锁浏览器的异步音频播放权限。
$('#soundBtn').dataset.on = 'true';
$('#soundBtn').addEventListener('click', async () => {
  const enabled = $('#soundBtn').dataset.on === 'true';
  $('#soundBtn').dataset.on = String(!enabled); $('#soundBtn').setAttribute('aria-pressed', String(!enabled));
  if (enabled) { state.speechRequest += 1; $('#soundBtn').textContent = '声'; $('#soundBtn').title = '模型语音已静音；点击恢复'; state.currentAudio?.pause(); state.currentAudio = null; setDMState('模型语音已静音', false); }
  else { await unlockAudioPlayback(); $('#soundBtn').textContent = '静'; $('#soundBtn').title = '模型语音已开启；点击可静音'; setDMState('模型语音已开启', false); }
});
$('#videoFile').addEventListener('change', (event) => {
  const file = event.target.files[0]; if (!file) return;
  video.src = URL.createObjectURL(file); video.controls = true;
  video.onloadedmetadata = () => { state.videoReady = Number.isFinite(video.duration) && video.duration > 0; $('#fileText').textContent = state.videoReady ? `已载入 ${file.name} · ${time(video.duration)}` : '无法读取此视频，请换一个文件'; };
});
$('#beginBtn').addEventListener('click', () => {
  if (!state.videoReady) { $('#fileText').textContent = '请先选择一个可播放的视频'; return; }
  if ($('#soundBtn').dataset.on === 'true') unlockAudioPlayback();
  $('#welcome').classList.add('hidden'); $('#session').classList.remove('hidden'); $('#sheetBtn').classList.remove('hidden'); beginCreation();
});
$('#suggestions').addEventListener('click', () => {});
$('#textForm').addEventListener('submit', (event) => { event.preventDefault(); const input = $('#textInput'); if (!input.value.trim()) return; const text = input.value.trim(); input.value = ''; if (state.phase === 'creation') handleCreationAnswer(text); else if (state.phase === 'quest_selection') handleQuestSelection(text); else handleAction(text); });
$('#micBtn').addEventListener('click', () => { if (!window.SpeechRecognition && !window.webkitSpeechRecognition) { $('#listenLabel').textContent = '浏览器不支持语音识别，请使用文字输入'; return; } const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition; const rec = new Recognition(); rec.lang = 'zh-CN'; rec.interimResults = false; rec.onstart = () => { stopDecision(); $('#micBtn').classList.add('listening'); $('#listenLabel').textContent = '正在聆听…'; }; rec.onend = () => $('#micBtn').classList.remove('listening'); rec.onresult = (e) => { const text = e.results[0][0].transcript; if (state.phase === 'creation') handleCreationAnswer(text); else if (state.phase === 'quest_selection') handleQuestSelection(text); else handleAction(text); }; rec.start(); });
$('#sheetBtn').addEventListener('click', () => $('#sheet').showModal()); $('#closeSheet').addEventListener('click', () => $('#sheet').close());
$('#openSheetBtn').addEventListener('click', () => $('#sheet').showModal());
$('#pauseBtn').addEventListener('click', pauseGame);
$('#exitBtn').addEventListener('click', () => { stopDecision(); state.currentAudio?.pause(); state.currentAudio = null; video.pause(); save(); $('#session').classList.add('hidden'); $('#sideSheet').classList.add('hidden'); $('#welcome').classList.remove('hidden'); $('#sheetBtn').classList.add('hidden'); $('#fileText').textContent = '进度已保存 · 选择视频继续'; });
video.addEventListener('timeupdate', onVideoProgress);
