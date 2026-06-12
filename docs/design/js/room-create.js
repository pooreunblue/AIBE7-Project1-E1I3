// 여행방 생성 폼과 초대 링크 복사 로직

// 페이지 로드 후 핸들러를 연결
document.addEventListener('DOMContentLoaded', init);

// 초기화 — 폼·복사·참여 버튼 이벤트 바인딩
function init() {
  // 여행방 생성 폼 제출 핸들러 연결
  const form = document.querySelector('#create-form');
  // 브라우저 네이티브 검증이 JS 검증을 덮어쓰지 않도록 novalidate
  form.setAttribute('novalidate', '');
  form.addEventListener('submit', handleCreate);
  // 도착일을 출발일과 연동 (min값 + 자동 초기화)
  const startInput = document.querySelector('#startDate');
  const endInput = document.querySelector('#endDate');
  const bindDate = () => {
    endInput.min = startInput.value;
    if (endInput.value && startInput.value && endInput.value < startInput.value) {
      endInput.value = "";
    }
  };
  startInput.addEventListener('change', bindDate);
  endInput.addEventListener('change', bindDate);
  // 초대 링크 복사 버튼 핸들러 연결
  document.querySelector('#copy-invite').addEventListener('click', handleCopy);
  // 초대 링크 참여 폼 제출 핸들러 연결
  document.querySelector('#join-form').addEventListener('submit', handleJoinByInvite);
  // 플래너 링크 클릭 시 방 목록에 따라 이동
  const planner = document.querySelector('#navPlanner');
  if (planner) planner.addEventListener('click', handlePlannerClick);
}

// 플래너 링크 클릭 — 방 목록 있으면 첫 방 이동, 없으면 현재 유지
async function handlePlannerClick(event) {
  event.preventDefault();
  try {
    const rooms = await getUserRooms();
    if (rooms.length) {
      window.location.href = `room.html?roomId=${rooms[0].id}`;
    }
  } catch {}
}

// 날짜 검증: 도착일이 출발일보다 이르면 메시지 + 차단
function validateDate(startDate, endDate) {
  if (!startDate || !endDate) return true;
  if (new Date(endDate) < new Date(startDate)) {
    showToast("도착일은 출발일보다 이후 날짜로 선택해 주세요.");
    return false;
  }
  return true;
}

// 여행방 생성 submit 핸들러
async function handleCreate(event) {
  // 기본 제출 동작(새로고침) 차단
  event.preventDefault();

  // 폼 입력값을 구조 분해로 추출
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const { tripTitle, destination, host } = data;
  const startDate = data.startDate;
  const endDate = data.endDate;

  // 필수값(여행명) 검증
  if (!tripTitle) {
    showToast(MSG.common.required);
    return;
  }

  // 날짜 검증: 도착일이 출발일보다 이르면 API 호출 차단
  if (!validateDate(startDate, endDate)) return;

  try {
    // API 레이어로 여행방 생성 요청
    const { room, me } = await createRoom({ title: tripTitle, destination, startDate, endDate, host });
    // 생성자 본인을 멤버로 기억
    localStorage.setItem(`motrip:me:${room.id}`, me.id);
    // 결과 영역 렌더링
    renderResult(room);
    showToast(MSG.room.createSuccess);
  } catch (err) {
    showToast(MSG.common.networkError);
  }
}

// 생성 결과와 초대 링크를 표시
function renderResult(room) {
  const { id, title, inviteCode } = room;

  // 같은 폴더의 room.html 기준 초대 링크 구성
  const link = `${location.origin}${location.pathname.replace('room-create.html', 'room.html')}?roomId=${id}&code=${inviteCode}`;

  // 생성 폼을 숨기고 결과 영역을 노출
  document.querySelector('#create-section').classList.add('d-none');
  document.querySelector('#result-section').classList.remove('d-none');

  // 결과 텍스트와 링크 채우기
  document.querySelector('#created-title').textContent = title;
  document.querySelector('#invite-link').value = link;
  document.querySelector('#enter-room').href = link;
}

// 초대 링크 복사 버튼 핸들러
function handleCopy() {
  // 입력 칸의 링크를 클립보드로 복사
  const link = document.querySelector('#invite-link').value;
  copyToClipboard(link, MSG.common.copySuccess, MSG.common.copyFail);
}

// 초대 링크로 방 정보 조회 → 닉네임 입력 → 참여 → room.html 이동
async function handleJoinByInvite(event) {
  event.preventDefault();
  const input   = document.querySelector('#invite-input');
  const nick    = document.querySelector('#invite-nickname');
  const error   = document.querySelector('#invite-error');
  const btn     = document.querySelector('#join-btn');

  error.classList.add('d-none');
  const raw = input.value.trim();
  const nickname = nick.value.trim();
  if (!raw || !nickname) {
    error.textContent = '초대 링크와 닉네임을 모두 입력해 주세요.';
    error.classList.remove('d-none');
    return;
  }

  // URL에서 roomId와 code 추출
  const qs = raw.includes('?') ? raw.slice(raw.indexOf('?'))
            : raw.includes('&') ? raw.slice(raw.indexOf('&'))
            : raw.includes('roomId') ? '?' + raw : raw;
  const params = new URLSearchParams(qs.replace(/^[?&]/, ''));
  const roomId = params.get('roomId');
  const code   = params.get('code');

  if (!roomId) {
    error.textContent = '초대 링크에서 여행방을 찾을 수 없습니다.';
    error.classList.remove('d-none');
    return;
  }

  // 로딩 상태
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> 참여 중...';

  try {
    // 방 정보 조회
    const room = await getRoom(roomId);
    // 초대 코드 검증
    if (code && code !== room.inviteCode) {
      error.textContent = '초대 링크가 올바르지 않습니다.';
      error.classList.remove('d-none');
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined">login</span> 참여하기';
      return;
    }
    // 참여 API 호출
    const me = await joinRoom(roomId, { nickname });
    localStorage.setItem(`motrip:me:${roomId}`, me.id);
    localStorage.setItem('motrip:lastRoomId', roomId);
    showToast(`${room.title} 여행방에 참여했습니다!`);
    // room.html로 이동
    window.location.href = `room.html?roomId=${roomId}`;
  } catch (err) {
    error.textContent = '참여에 실패했습니다. 링크를 확인해 주세요.';
    error.classList.remove('d-none');
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined">login</span> 참여하기';
  }
}
