const chatMessages = document.querySelector('#chatMessages');
const chatInput = document.querySelector('#chatInput');
const sendBtn = document.querySelector('#sendBtn');
const newChatBtn = document.querySelector('#newChatBtn');
const logoutBtn = document.querySelector('#logoutBtn');

let currentUser = null;

// ────── localStorage 저장/불러오기 ──────

function getStorageKey () {
  const uid = currentUser?.id || 'anonymous';
  return `chat_log_${uid}`;
}

function saveToLocal (messages) {
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(messages));
  } catch { /* 용량 초과 등 무시 */ }
}

function loadFromLocal () {
  try {
    const raw = localStorage.getItem(getStorageKey());
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ────── 메시지 말풍선 생성 ──────

function createMessage (type, content) {
  const isAI = type === 'ai';
  const wrapper = document.createElement('div');
  wrapper.className = `message message-${type}`;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.innerHTML = isAI
    ? '<i class="bi bi-stars"></i>'
    : '<i class="bi bi-person-fill"></i>';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = content;

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);

  if (isAI) {
    const exportBtn = document.createElement('button');
    exportBtn.className = 'btn-export';
    exportBtn.innerHTML = '<i class="bi bi-journal-plus"></i>';
    exportBtn.title = '메모로 내보내기';
    exportBtn.addEventListener('click', handleExportMessage);
    wrapper.appendChild(exportBtn);
  }

  return wrapper;
}

// ────── 마크다운 렌더링 ──────

function renderMarkdown (text) {
  if (typeof marked === 'undefined') return text;
  return marked.parse(text, { breaks: true, gfm: true });
}

function addMessage (type, content, rawContent) {
  const html = type === 'ai' ? renderMarkdown(content) : content;
  const msg = createMessage(type, html);
  if (type === 'ai') msg.dataset.raw = rawContent || content;
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ────── AI 메시지 메모로 내보내기 ──────

function handleExportMessage (event) {
  event.stopPropagation();
  const msgEl = event.currentTarget.closest('.message');
  const raw = msgEl?.dataset?.raw;
  if (!raw) { showToast('내보낼 내용이 없습니다.'); return; }

  const roomId = localStorage.getItem('motrip:lastRoomId');
  if (!roomId) { showToast('먼저 여행방에 입장해 주세요.'); return; }

  const key = `motrip:memo:${roomId}`;
  const existing = JSON.parse(localStorage.getItem(key) || '[]');
  existing.push({ content: raw, exportedAt: new Date().toISOString() });
  localStorage.setItem(key, JSON.stringify(existing));
  localStorage.setItem('motrip:memo-new-flag', '1');

  showToast('메모가 저장되었습니다!');
  setTimeout(() => {
    window.location.href = `./room.html?roomId=${roomId}`;
  }, 800);
}

// ────── 채팅 내역 불러오기 ──────

async function loadChatHistory () {
  const local = loadFromLocal();
  if (local && local.length > 0) {
    for (const msg of local) {
      addMessage(msg.role === 'user' ? 'user' : 'ai', msg.html || msg.text, msg.text);
    }
    return;
  }

  // localStorage에 없으면 Supabase 시도
  if (!currentUser) return;
  try {
    const { data, error } = await _supabase
      .from('chat_messages')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: true });

    if (error) return;
    if (!data || data.length === 0) return;

    const localCopy = [];
    for (const msg of data) {
      const content = msg.html_content || msg.content || '';
      if (!content) continue;
      addMessage(msg.role === 'user' ? 'user' : 'ai', content, msg.content);
      localCopy.push({ role: msg.role, text: msg.content || '', html: msg.html_content || '' });
    }
    saveToLocal(localCopy);
  } catch { /* 테이블 없음 */ }
}

// ────── 메시지 저장 ──────

const _messageBuffer = [];

function pushMessage (role, text, html) {
  _messageBuffer.push({ role, text, html: html || text });
  saveToLocal(_messageBuffer);
}

async function saveToSupabase (role, content, htmlContent) {
  if (!currentUser) return;
  try {
    await _supabase.from('chat_messages').insert({
      user_id: currentUser.id,
      role,
      content,
      html_content: htmlContent || content
    });
  } catch { /* 테이블 없으면 무시 */ }
}

// ────── AI 응답 생성 ──────

// ────── 서버 API 호출 ──────

const CHAT_API_URL = '/api/chat';

// AI 응답 생성 (서버 우선, 실패 시 키워드 fallback)
async function getAIResponse (text) {
  try {
    const res = await fetch(CHAT_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        history: _messageBuffer.slice(-10) // 최근 10개만 컨텍스트로 전달
      })
    });
    if (!res.ok) throw new Error('API 응답 오류');
    const data = await res.json();
    return data.response;
  } catch {
    throw new Error('서버에 연결할 수 없습니다.');
  }
}

// 로딩 인디케이터 (점점 애니메이션)
let _loadingEl = null;

function showLoading () {
  _loadingEl = createMessage('ai', '<span class="loading-dots"><span>.</span><span>.</span><span>.</span></span>');
  chatMessages.appendChild(_loadingEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function hideLoading () {
  if (_loadingEl) {
    _loadingEl.remove();
    _loadingEl = null;
  }
}

// ────── 메시지 전송 ──────

async function sendMessage () {
  const text = chatInput.value.trim();
  if (!text) return;

  // 사용자 메시지
  addMessage('user', text);
  pushMessage('user', text);
  saveToSupabase('user', text);
  chatInput.value = '';

  // 로딩 표시
  showLoading();

  // AI 응답
  try {
    const aiText = await getAIResponse(text);
    hideLoading();
    addMessage('ai', aiText);
    pushMessage('assistant', aiText);
    saveToSupabase('assistant', aiText);
  } catch {
    hideLoading();
    addMessage('ai', MSG.chatError);
  }
}

// ────── 초기화 ──────

async function initChat () {
  try {
    const { data: { session } } = await _supabase.auth.getSession();
    currentUser = session?.user ?? null;
  } catch { /* 무시 */ }

  // 로그인하지 않으면 로그인 페이지로 이동
  if (!currentUser) {
    window.location.href = '/design/html/login.html';
    return;
  }

  // 여행방이 없으면 AI 추천 사용 불가
  const myRooms = getMyRooms();
  if (!myRooms || myRooms.length === 0) {
    chatMessages.innerHTML = `
      <div class="text-center py-5" style="margin-top:4rem;">
        <p class="fs-5 mb-2">아직 여행방이 없어요!</p>
        <p class="text-secondary mb-4">AI 여행 추천을 받으려면 먼저 여행방을 만들어 주세요.</p>
        <a class="btn btn-primary btn-pill px-4" href="./room-create.html">새 여행 만들기</a>
      </div>
    `;
    chatInput.disabled = true;
    sendBtn.disabled = true;
    return;
  }

  await loadChatHistory();

  // 불러온 내역이 없으면 환영 메시지
  if (chatMessages.children.length === 0) {
    addMessage('ai', MSG.chatWelcome);
  }
}

// ────── 로그아웃 ──────

async function handleLogout () {
  try {
    await _supabase.auth.signOut();
  } catch { /* 무시 */ }
  localStorage.clear();
  window.location.href = '/design/html/login.html';
}

// ────── 새 대화 ──────

async function handleNewChat () {
  chatMessages.innerHTML = '';
  _messageBuffer.length = 0;
  localStorage.removeItem(getStorageKey());
  addMessage('ai', MSG.chatWelcome);

  if (currentUser) {
    try {
      await _supabase.from('chat_messages').delete().eq('user_id', currentUser.id);
    } catch { /* 무시 */ }
  }
}

// ────── 이벤트 바인딩 ──────

sendBtn.addEventListener('click', sendMessage);

chatInput.addEventListener('keydown', (e) => {
  // 한글 IME 조합 중 Enter 무시
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

if (newChatBtn) {
  newChatBtn.addEventListener('click', handleNewChat);
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', handleLogout);
}

initChat();
