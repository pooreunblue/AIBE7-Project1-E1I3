/**
 * finance.js — 지출 내역 및 정산 기록 모듈 메인 로직
 * Supabase 테이블: expenses (지출), budgets (예산)
 * 의존: msg.js, supabase-client.js, Chart.js (CDN)
 */

'use strict';

/* ═══════════════════════════════
   상수 — 카테고리 정의
   ═══════════════════════════════ */
// 지출 카테고리 목록과 파이 차트 색상 매핑
const CATEGORIES = [
  { key: 'accommodation', label: '숙박',   color: '#00658d', cssClass: 'cat-accommodation' },
  { key: 'food',          label: '식비',   color: '#f59e0b', cssClass: 'cat-food'          },
  { key: 'transport',     label: '교통',   color: '#10b981', cssClass: 'cat-transport'     },
  { key: 'activity',      label: '활동',   color: '#8b5cf6', cssClass: 'cat-activity'      },
  { key: 'shopping',      label: '쇼핑',   color: '#ec4899', cssClass: 'cat-shopping'      },
  { key: 'etc',           label: '기타',   color: '#6b7280', cssClass: 'cat-etc'           },
];

/* ═══════════════════════════════
   상태 — 앱 전역 상태 변수
   ═══════════════════════════════ */
// 현재 로그인 사용자 정보
let currentUser = null;
// 지출 내역 전체 배열 (렌더링 기준)
let expenses = [];
// 현재 설정된 총 예산 금액
let budget = 0;
// 현재 방 ID (URL에서 추출, schedule.js에서 이미 선언)
roomId = new URLSearchParams(location.search).get('roomId');
// 파이 차트 인스턴스 (Chart.js)
let pieChart = null;
// 수정 중인 지출 ID (null이면 신규 추가 모드)
let editingId = null;

/* ═══════════════════════════════
   DOM 참조
   ═══════════════════════════════ */
// 지출 추가/수정 폼
const expenseForm   = document.querySelector('#expense-form');
// 지출 목록 컨테이너
const expenseList   = document.querySelector('#expense-list');
// 예산 설정 폼
const budgetForm    = document.querySelector('#budget-form');
// 예산 진행률 바
const budgetBar     = document.querySelector('#budget-bar');
// 예산 퍼센트 텍스트
const budgetPct     = document.querySelector('#budget-pct');
// 예산 잔액 텍스트
const budgetRemain  = document.querySelector('#budget-remain');
// 정산 결과 컨테이너
const settlementBox = document.querySelector('#settlement-list');
// 차트 캔버스
const chartCanvas   = document.querySelector('#pie-chart');
// 차트 중앙 총액
const chartTotal    = document.querySelector('#chart-total');
// 범례 컨테이너
const legendBox     = document.querySelector('#chart-legend');
// 토스트 엘리먼트
const toastEl       = document.querySelector('#toast');
// 로그인 상태 표시
const finUserStatus    = document.querySelector('#fin-user-status');
// 로그아웃 버튼
const finLogoutBtn     = document.querySelector('#fin-logout-btn');
// 수정 폼 래퍼 (숨김/표시 전환)
const finEditWrapper   = document.querySelector('#fin-edit-form-wrapper');
// 수정 취소 버튼
const finEditCancelBtn = document.querySelector('#fin-edit-cancel-btn');
// 수정 폼 자체
const finEditForm      = document.querySelector('#edit-expense-form');
// 통계 요약 수치 요소들
const statTotal     = document.querySelector('#stat-total');
const statCount     = document.querySelector('#stat-count');
const statAvg       = document.querySelector('#stat-avg');
const statMax       = document.querySelector('#stat-max');

/* ═══════════════════════════════
   초기화 — DOMContentLoaded / 외부(room.js) 호출
   ═══════════════════════════════ */

// 중복 초기화 방지
let _finInitialized = false;
let _finInitializing = false;

// DOMContentLoaded 자동 시작 + room.js에서도 재호출 가능
document.addEventListener('DOMContentLoaded', () => { initFinance(); });

async function initFinance() {
  // 이미 완전 초기화된 경우 데이터만 갱신(룸 전환 대응)
  if (_finInitialized) {
    await loadBudget();
    await loadExpenses();
    return;
  }
  // 첫 번째 초기화가 진행 중이면 중복 실행 방지
  if (_finInitializing) return;
  _finInitializing = true;

  // 이벤트 핸들러는 async 로드 전에 먼저 등록(폼 제출 차단)
  expenseForm.addEventListener('submit', handleAddExpense);
  budgetForm.addEventListener('submit', handleSaveBudget);
  finEditForm.addEventListener('submit', handleEditExpense);
  finEditCancelBtn.addEventListener('click', cancelEdit);
  finLogoutBtn.addEventListener('click', handleLogout);
  // 카테고리 select 옵션 동적 생성
  buildCategoryOptions();
  // Supabase 인증 상태 변경 구독 (로그인/로그아웃 감지) — 먼저 구독
  try {
    supabaseClient.auth.onAuthStateChange((event, session) => {
      // INITIAL_SESSION(null)은 checkAuthState가 덮어쓰므로 무시
      if (event === 'INITIAL_SESSION' && !session?.user) return;
      // SDK가 SIGNED_OUT을 잘못 발생시켜도 sb-session이 유효하면 무시
      if (event === 'SIGNED_OUT') {
        try {
          const raw = localStorage.getItem('sb-session');
          if (raw && JSON.parse(raw)?.user?.id) return;
        } catch {}
      }
      currentUser = session?.user ?? null;
      renderAuthUI();
    });
  } catch {}
  // 현재 로그인 세션 확인 (onAuthStateChange가 null을 설정해도 덮어씀)
  try { await checkAuthState(); } catch {}
  // 예산 및 지출 내역 로드
  buildCategoryOptions();
  // 예산 및 지출 내역 로드
  await loadBudget();
  await loadExpenses();

  _finInitialized = true;
}

/* ═══════════════════════════════
   인증 — 로그인 상태 확인 & UI 반영
   ═══════════════════════════════ */
async function checkAuthState() {
  // 현재 세션에서 사용자 정보 추출
  const { data: { user } } = await supabaseClient.auth.getUser();
  currentUser = user;
  renderAuthUI();
}

function renderAuthUI() {
  // 로그인 여부에 따라 상단 상태 텍스트·버튼 표시 전환
  if (currentUser) {
    finUserStatus.textContent = currentUser.email;
    finLogoutBtn.classList.remove('d-none');
  } else {
    finUserStatus.textContent = '';
    finLogoutBtn.classList.add('d-none');
  }
}

async function handleLogout() {
  // Supabase 세션 종료
  await supabaseClient.auth.signOut();
  showToast(MSG.auth.logoutSuccess);
}

/* ═══════════════════════════════
   카테고리 — select 옵션 빌드
   ═══════════════════════════════ */
function buildCategoryOptions() {
  // 추가·수정 두 폼의 카테고리 select에 옵션 삽입
  ['#add-category', '#edit-category'].forEach(sel => {
    const el = document.querySelector(sel);
    if (!el) return;
    CATEGORIES.forEach(({ key, label }) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = label;
      el.append(opt);
    });
  });
}

/* ═══════════════════════════════
   예산 — 로드 & 저장
   ═══════════════════════════════ */
async function loadBudget() {
  // 방별 예산을 localStorage에서 조회, 없으면 0
  budget = roomId ? (Number(localStorage.getItem(`motrip:budget:${roomId}`)) || 0) : 0;
  document.querySelector('#budget-input').value = budget || '';
  updateBudgetUI();
}

async function handleSaveBudget(e) {
  e.preventDefault();
  const amount = Number(document.querySelector('#budget-input').value);
  if (!amount || amount <= 0) { showToast(MSG.budget.inputRequired); return; }

  if (roomId) localStorage.setItem(`motrip:budget:${roomId}`, String(amount));
  budget = amount;
  showToast(MSG.budget.saveSuccess);
  updateBudgetUI();
}

function updateBudgetUI() {
  // 총 지출 합산
  const totalSpent = expenses.reduce((sum, ex) => sum + ex.amount, 0);
  if (!budget) {
    // 예산 미설정 시 바 비활성
    budgetBar.style.width = '0%';
    budgetBar.classList.remove('over-budget');
    budgetPct.textContent = '예산 미설정';
    budgetRemain.textContent = '';
    return;
  }
  // 사용 비율 계산 (최대 100% 표시)
  const pct = Math.min((totalSpent / budget) * 100, 100).toFixed(1);
  const remain = budget - totalSpent;

  budgetBar.style.width = `${pct}%`;
  budgetPct.textContent = `${pct}% 사용`;

  if (totalSpent > budget) {
    // 초과 시 경고 색상
    budgetBar.classList.add('over-budget');
    budgetRemain.textContent = `${formatKRW(Math.abs(remain))} 초과`;
    budgetRemain.style.color = '#ba1a1a';
  } else {
    budgetBar.classList.remove('over-budget');
    budgetRemain.textContent = `잔액 ${formatKRW(remain)}`;
    budgetRemain.style.color = '';
  }
}

/* ═══════════════════════════════
   지출 — 로드 & 렌더
   ═══════════════════════════════ */
async function loadExpenses() {
  try {
    // 방별 localStorage에서 조회 (schedule.js와 동일 패턴)
    const key = `motrip:expenses:${roomId || "global"}`;
    const raw = localStorage.getItem(key);
    expenses = raw ? JSON.parse(raw) : [];
  } catch {
    expenses = [];
  }
  finRenderAll();
}

const EXPENSES_KEY = () => `motrip:expenses:${roomId || "global"}`;

function saveExpenses() {
  localStorage.setItem(EXPENSES_KEY(), JSON.stringify(expenses));
}

function finRenderAll() {
  // 지출 목록·파이 차트·정산·통계 통합 렌더링
  renderExpenseList();
  renderPieChart();
  renderSettlement();
  renderStats();
  updateBudgetUI();
}

function renderExpenseList() {
  // 지출 내역이 없을 때 빈 상태 안내
  if (!expenses.length) {
    expenseList.innerHTML = `<p class="text-center text-muted py-4">${MSG.expense.noData}</p>`;
    return;
  }

  expenseList.innerHTML = expenses.map(ex => {
    // 카테고리 메타 정보 찾기
    const cat = CATEGORIES.find(c => c.key === ex.category) ?? CATEGORIES.at(-1);
    // 로그인한 모든 멤버가 수정·삭제 가능 (여행방 공동 관리)
    const isOwner = !!currentUser;
    return `
      <div class="expense-row d-flex align-items-start gap-3 p-3 border-bottom animate-in"
           data-id="${ex.id}">
        <!-- 날짜 -->
        <div class="text-muted small flex-shrink-0" style="min-width:76px;">
          ${escapeHtml(ex.expense_date)}
        </div>
        <!-- 카테고리 배지 + 내용 -->
        <div class="flex-grow-1">
          <span class="category-badge ${cat.cssClass}">${cat.label}</span>
          <span class="ms-2">${escapeHtml(ex.description)}</span>
          ${ex.payer ? `<small class="text-muted ms-2">결제: ${escapeHtml(ex.payer)}</small>` : ''}
        </div>
        <!-- 금액 -->
        <div class="amount-text flex-shrink-0">${formatKRW(ex.amount)}</div>
        <!-- 작성자 전용 버튼 -->
        ${isOwner ? `
          <div class="d-flex gap-1 flex-shrink-0">
            <button class="btn btn-sm btn-outline-secondary" onclick="startEdit('${ex.id}')">수정</button>
            <button class="btn btn-sm btn-outline-danger"   onclick="deleteExpense('${ex.id}')">삭제</button>
          </div>` : ''}
      </div>`;
  }).join('');
}

/* ═══════════════════════════════
   지출 — 추가 핸들러
   ═══════════════════════════════ */
async function handleAddExpense(e) {
  try {
    // 폼 기본 제출 방지
    e.preventDefault();

    // 로그인 체크
    if (!currentUser) { showToast(MSG.auth.notLoggedIn); return; }

    // 폼 데이터 구조 분해
    const fd = new FormData(e.target);
    const expense_date = fd.get('expense_date')?.trim();
    const category     = fd.get('category');
    const amount       = Number(fd.get('amount'));
    const description  = fd.get('description')?.trim();
    const payer        = fd.get('payer')?.trim() || null;

    // 필수 항목 검증
    if (!expense_date || !category || !description) {
      showToast(MSG.expense.inputRequired); return;
    }
    if (!amount || amount <= 0) {
      showToast(MSG.expense.amountInvalid); return;
    }

    // 방별 localStorage에 저장
    const newExpense = { id: crypto.randomUUID(), expense_date, category, amount, description, payer, user_id: currentUser.id };
    expenses.unshift(newExpense);
    saveExpenses();
    finRenderAll();
    e.target.reset();
    showToast(MSG.expense.addSuccess);
  } catch (err) {
    showToast(MSG.common.networkError);
  }
}

/* ═══════════════════════════════
   지출 — 수정 핸들러
   ═══════════════════════════════ */
function startEdit(id) {
  // 수정 대상 지출 찾기
  const ex = expenses.find(e => String(e.id) === String(id));
  if (!ex) return;

  editingId = id;

  // 수정 폼에 기존 값 채우기
  finEditForm.querySelector('[name="edit-date"]').value        = ex.expense_date;
  finEditForm.querySelector('[name="edit-category"]').value    = ex.category;
  finEditForm.querySelector('[name="edit-amount"]').value      = ex.amount;
  finEditForm.querySelector('[name="edit-description"]').value = ex.description;
  finEditForm.querySelector('[name="edit-payer"]').value       = ex.payer ?? '';

  // 수정 폼 표시
  finEditWrapper.classList.remove('d-none');
  finEditWrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function handleEditExpense(e) {
  // 폼 기본 제출 방지
  e.preventDefault();
  if (!editingId) return;
  if (!currentUser) { showToast(MSG.auth.notLoggedIn); return; }

  const fd = new FormData(e.target);
  const expense_date = fd.get('edit-date')?.trim();
  const category     = fd.get('edit-category');
  const amount       = Number(fd.get('edit-amount'));
  const description  = fd.get('edit-description')?.trim();
  const payer        = fd.get('edit-payer')?.trim() || null;

  if (!expense_date || !category || !description || !amount || amount <= 0) {
    showToast(MSG.expense.inputRequired); return;
  }

  // 로컬 배열 갱신
  const idx = expenses.findIndex(ex => String(ex.id) === String(editingId));
  if (idx !== -1) {
    Object.assign(expenses[idx], { expense_date, category, amount, description, payer });
    saveExpenses();
  }

  cancelEdit();
  finRenderAll();
  showToast(MSG.expense.editSuccess);
}

function cancelEdit() {
  // 수정 폼 숨김 및 상태 초기화
  editingId = null;
  finEditWrapper.classList.add('d-none');
  finEditForm.reset();
}

/* ═══════════════════════════════
   지출 — 삭제 핸들러
   ═══════════════════════════════ */
async function deleteExpense(id) {
  // 삭제 확인 다이얼로그
  if (!confirm(MSG.expense.deleteConfirm)) return;
  if (!currentUser) { showToast(MSG.auth.notLoggedIn); return; }

  // 로컬 배열에서 제거 후 재렌더링
  expenses = expenses.filter(ex => String(ex.id) !== String(id));
  saveExpenses();
  finRenderAll();
}

/* ═══════════════════════════════
   파이 차트 — Chart.js 도넛 차트
   ═══════════════════════════════ */
function renderPieChart() {
  // 카테고리별 합산 계산
  const totals = CATEGORIES.map(cat => ({
    ...cat,
    total: expenses
      .filter(ex => ex.category === cat.key)
      .reduce((sum, ex) => sum + ex.amount, 0),
  })).filter(c => c.total > 0); // 지출이 없는 카테고리 제외

  const grandTotal = totals.reduce((s, c) => s + c.total, 0);

  // 차트 중앙 총액 업데이트
  if (chartTotal) chartTotal.textContent = formatKRW(grandTotal);

  // 기존 차트 인스턴스가 있으면 파괴 후 재생성
  if (pieChart) { pieChart.destroy(); pieChart = null; }

  if (!totals.length) {
    // 데이터 없을 때 빈 화면
    if (legendBox) legendBox.innerHTML = '<p class="text-muted small">지출 내역을 추가하면 차트가 표시됩니다.</p>';
    return;
  }

  // Chart.js 도넛 차트 생성
  pieChart = new Chart(chartCanvas, {
    type: 'doughnut',
    data: {
      labels:   totals.map(c => c.label),
      datasets: [{
        data:            totals.map(c => c.total),
        backgroundColor: totals.map(c => c.color),
        borderWidth:     2,
        borderColor:     '#fff',
        hoverOffset:     8,
      }],
    },
    options: {
      cutout: '68%',        // 도넛 두께 — 중앙 라벨 공간 확보
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },  // 커스텀 범례 사용
        tooltip: {
          callbacks: {
            // 툴팁에 금액 포맷 적용
            label: ctx => ` ${formatKRW(ctx.parsed)} (${((ctx.parsed / grandTotal) * 100).toFixed(1)}%)`,
          },
        },
      },
    },
  });

  // 커스텀 범례 렌더링
  if (legendBox) {
    legendBox.innerHTML = totals.map(c => `
      <div class="d-flex align-items-center gap-2 mb-1">
        <span class="legend-dot" style="background:${c.color};"></span>
        <span class="small flex-grow-1">${c.label}</span>
        <span class="small fw-semibold">${formatKRW(c.total)}</span>
        <span class="small text-muted">(${((c.total / grandTotal) * 100).toFixed(1)}%)</span>
      </div>`).join('');
  }
}

/* ═══════════════════════════════
   정산 — 1/N 균등 정산 계산
   ═══════════════════════════════ */
function renderSettlement() {
  if (!expenses.length) {
    settlementBox.innerHTML = `<p class="text-muted small">${MSG.settlement.noExpense}</p>`;
    return;
  }

  // 결제자(payer)별 합산
  const payerMap = {};
  expenses.forEach(({ payer, amount }) => {
    const name = payer || '미지정';
    payerMap[name] = (payerMap[name] ?? 0) + amount;
  });

  const payers = Object.keys(payerMap);
  const total  = Object.values(payerMap).reduce((s, v) => s + v, 0);
  const fair   = total / payers.length; // 1인당 균등 부담액

  // 잔액 계산 (양수: 더 낸 사람, 음수: 덜 낸 사람)
  const balances = payers.map(name => ({
    name,
    balance: payerMap[name] - fair,
  }));

  // 채권자 · 채무자 분리
  const creditors = balances.filter(b => b.balance > 0).sort((a, b) => b.balance - a.balance);
  const debtors   = balances.filter(b => b.balance < 0).sort((a, b) => a.balance - b.balance);

  // 최소 송금 횟수 정산 계산 (greedy)
  const transfers = [];
  const cred = creditors.map(c => ({ ...c }));
  const debt = debtors.map(d => ({ ...d }));

  let ci = 0, di = 0;
  while (ci < cred.length && di < debt.length) {
    const amount = Math.min(cred[ci].balance, -debt[di].balance);
    if (amount > 0.5) { // 1원 미만 오차 무시
      transfers.push({ from: debt[di].name, to: cred[ci].name, amount });
    }
    cred[ci].balance += debt[di].balance;
    debt[di].balance += cred[ci].balance < 0 ? cred[ci].balance : 0;
    if (Math.abs(cred[ci].balance) < 0.5) ci++;
    if (Math.abs(debt[di].balance) < 0.5) di++;
  }

  if (!transfers.length) {
    // 이미 균등하게 정산된 경우
    settlementBox.innerHTML = `<p class="text-success fw-semibold">${MSG.settlement.perfect}</p>`;
    return;
  }

  // 정산 내역 렌더링
  settlementBox.innerHTML = `
    <p class="small text-muted mb-2">1인당 부담: <strong>${formatKRW(Math.round(fair))}</strong></p>
    ${transfers.map(t => `
      <div class="settlement-item animate-in">
        <span class="fw-semibold">${escapeHtml(t.from)}</span>
        <span class="settlement-arrow">→</span>
        <span class="fw-semibold">${escapeHtml(t.to)}</span>
        <span class="settlement-amount ms-auto">${formatKRW(Math.round(t.amount))}</span>
      </div>`).join('')}`;
}

/* ═══════════════════════════════
   통계 요약 — 총액·건수·평균·최대
   ═══════════════════════════════ */
function renderStats() {
  const total = expenses.reduce((s, ex) => s + ex.amount, 0);
  const count = expenses.length;
  const avg   = count ? Math.round(total / count) : 0;
  const max   = count ? Math.max(...expenses.map(ex => ex.amount)) : 0;

  if (statTotal) statTotal.textContent = formatKRW(total);
  if (statCount) statCount.textContent = `${count}건`;
  if (statAvg)   statAvg.textContent   = formatKRW(avg);
  if (statMax)   statMax.textContent   = formatKRW(max);
}

/* ═══════════════════════════════
   유틸리티 — 공통 헬퍼
   ═══════════════════════════════ */
// 숫자를 한국 원화 형식(₩1,000)으로 포맷
function formatKRW(amount) {
  return '₩' + Number(amount ?? 0).toLocaleString('ko-KR');
}

// HTML 특수문자 이스케이프 (XSS 방지)
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Bootstrap Toast로 짧은 메시지 표시
function showToast(message) {
  if (!toastEl) { alert(message); return; }
  toastEl.querySelector('.toast-body').textContent = message;
  bootstrap.Toast.getOrCreateInstance(toastEl).show();
}
