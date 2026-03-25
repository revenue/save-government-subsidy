/**
 * SAVE 정부지원사업 백오피스 - 프론트엔드 앱
 */

// ===== 로그인 / 인증 =====
const ALLOWED_DOMAIN = 'unitblack.co.kr';

function checkAuth() {
    const user = localStorage.getItem('save_user_email');
    if (user && user.endsWith('@' + ALLOWED_DOMAIN)) {
        showApp(user);
        return true;
    }
    showLogin();
    return false;
}

function showLogin() {
    document.getElementById('loginOverlay').classList.remove('hidden');
    document.getElementById('appLayout').style.display = 'none';
}

function showApp(email) {
    document.getElementById('loginOverlay').classList.add('hidden');
    document.getElementById('appLayout').style.display = 'flex';
    // 사용자 정보 표시
    const userBar = document.getElementById('userBar');
    if (userBar) {
        userBar.innerHTML = `
            <span class="user-email">${email}</span>
            <button class="logout-btn" onclick="handleLogout()">로그아웃</button>
        `;
    }
}

function handleLogin(e) {
    e.preventDefault();
    const emailInput = document.getElementById('loginEmail');
    const errorEl = document.getElementById('loginError');
    const email = emailInput.value.trim().toLowerCase();

    // 이메일 형식 검증
    if (!email) {
        errorEl.textContent = '이메일 주소를 입력해주세요.';
        emailInput.classList.add('error');
        return;
    }

    // 도메인 검증
    if (!email.endsWith('@' + ALLOWED_DOMAIN)) {
        errorEl.textContent = `@${ALLOWED_DOMAIN} 도메인의 이메일만 허용됩니다.`;
        emailInput.classList.add('error');
        return;
    }

    // 로그인 성공
    emailInput.classList.remove('error');
    errorEl.textContent = '';
    localStorage.setItem('save_user_email', email);
    showApp(email);
    loadData();
}

function handleLogout() {
    localStorage.removeItem('save_user_email');
    showLogin();
    // 입력 필드 초기화
    const emailInput = document.getElementById('loginEmail');
    if (emailInput) { emailInput.value = ''; }
    document.getElementById('loginError').textContent = '';
}

// ===== 앱 데이터 =====
let allSubsidies = [];  // 전체 데이터 (마감 포함)
let subsidies = [];     // 활성 데이터만 (마감 제외) — 기본 표시용
let history = [];
let meta = {};
let currentPage = 'dashboard';
let savedProfile = null;
let matchResults = [];
let showExpired = false; // 마감 데이터 표시 여부
let isCollecting = false; // 수집 진행 중 여부

const REGION_FULL_NAMES = [
    '서울특별시','부산광역시','대구광역시','인천광역시','광주광역시','대전광역시','울산광역시',
    '세종특별자치시','경기도','강원특별자치도','충청북도','충청남도','전북특별자치도',
    '전라남도','경상북도','경상남도','제주특별자치도'
];

// Data loading
async function loadData() {
    try {
        const [subRes, histRes, metaRes] = await Promise.all([
            fetch('data/subsidies.json').then(r => r.json()),
            fetch('data/history.json').then(r => r.json()),
            fetch('data/meta.json').then(r => r.json()),
        ]);
        allSubsidies = subRes;
        history = histRes;
        meta = metaRes;

        // 마감 전 데이터만 기본 필터링
        subsidies = allSubsidies.filter(s => !s.apply_end_date || s.apply_end_date >= today);

        // Load saved profile from localStorage
        try { savedProfile = JSON.parse(localStorage.getItem('businessProfile')); } catch {}

        navigateTo('dashboard');
    } catch (e) {
        document.getElementById('page-content').innerHTML =
            `<div class="empty-state"><div class="icon"><i class="lucide-alert-circle" style="font-size:48px;color:var(--primary);"></i></div><p>데이터 로드 실패: ${e.message}</p></div>`;
    }
}

// 마감 데이터 표시 토글
function toggleExpired() {
    showExpired = !showExpired;
    subsidies = showExpired ? allSubsidies : allSubsidies.filter(s => !s.apply_end_date || s.apply_end_date >= today);
    navigateTo(currentPage);
}

// 수집하기 — Vercel Serverless API 호출 (토큰 불필요)
async function triggerCollection() {
    if (isCollecting) return;
    isCollecting = true;
    const btn = document.getElementById('collectBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 수집 중...'; }

    // 상태 배너 업데이트
    const statusEl = document.getElementById('collectStatus');
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--primary);">수집 진행 중... (약 30초 소요)</span>';

    try {
        const resp = await fetch('/api/collect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        const data = await resp.json();

        if (data.success && data.items && data.items.length > 0) {
            // 수집된 데이터를 현재 화면에 병합
            const newItems = data.items;
            const existingIds = new Set(allSubsidies.map(s => s.external_id));
            let addedCount = 0;

            for (const item of newItems) {
                if (!existingIds.has(item.external_id)) {
                    allSubsidies.push(item);
                    existingIds.add(item.external_id);
                    addedCount++;
                }
            }

            // 활성 데이터 재필터링
            subsidies = showExpired
                ? allSubsidies
                : allSubsidies.filter(s => !s.apply_end_date || s.apply_end_date >= today);

            // 소스별 결과 표시
            const srcSummary = Object.entries(data.sources || {})
                .map(([k, v]) => `${v.name}: ${v.count}건`)
                .join(', ');

            if (statusEl) statusEl.innerHTML =
                `<span style="color:var(--ant-success);">✅ 수집 완료! ${data.total}건 수집 (신규 ${addedCount}건 추가) — ${srcSummary}</span>`;

            // 현재 페이지 새로고침
            navigateTo(currentPage);
        } else if (data.success) {
            if (statusEl) statusEl.innerHTML = '<span style="color:var(--ant-warning);">수집 완료 — 새로운 데이터 없음</span>';
        } else {
            if (statusEl) statusEl.innerHTML = `<span style="color:var(--error);">수집 실패: ${data.error || '알 수 없는 오류'}</span>`;
        }
    } catch (e) {
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--error);">수집 요청 실패: ${e.message}</span>`;
    } finally {
        isCollecting = false;
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="lucide-refresh-cw"></i> 수집하기'; }
    }
}

// Navigation
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigateTo(item.dataset.page));
});

function navigateTo(page) {
    currentPage = page;
    document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === page));
    const renderers = {
        dashboard: renderDashboard, list: renderList, matching: renderMatching,
        search: renderSearch, stats: renderStats, settings: renderSettings,
    };
    (renderers[page] || renderDashboard)();
}

// Helpers
const today = new Date().toISOString().slice(0, 10);
function getStatus(endDate) {
    if (!endDate) return { text: '상시', cls: 'tag-blue' };
    if (endDate < today) return { text: '마감', cls: 'tag-gray' };
    const days = Math.ceil((new Date(endDate) - new Date()) / 86400000);
    if (days <= 7) return { text: `D-${days}`, cls: 'tag-red' };
    return { text: '진행중', cls: 'tag-green' };
}

function escHtml(str) { const d = document.createElement('div'); d.textContent = str || ''; return d.innerHTML; }

// ===== Dashboard =====
function renderDashboard() {
    const active = subsidies.filter(s => !s.apply_end_date || s.apply_end_date >= today).length;
    const closingSoon = subsidies.filter(s => {
        if (!s.apply_end_date || s.apply_end_date < today) return false;
        return Math.ceil((new Date(s.apply_end_date) - new Date()) / 86400000) <= 7;
    }).length;
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const newThisWeek = subsidies.length; // approximate

    const catCounts = {};
    subsidies.forEach(s => { catCounts[s.category] = (catCounts[s.category] || 0) + 1; });
    const cats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);

    const orgCounts = {};
    subsidies.forEach(s => { if (s.organization) orgCounts[s.organization] = (orgCounts[s.organization] || 0) + 1; });
    const orgs = Object.entries(orgCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

    const maxCat = Math.max(...cats.map(c => c[1]), 1);
    const maxOrg = Math.max(...orgs.map(o => o[1]), 1);

    const lastUpdated = meta.last_updated || '-';
    const lastCollected = meta.last_collected || '-';
    const catCount = meta.categories ? Object.keys(meta.categories).length : 0;
    const expiredCount = allSubsidies.length - subsidies.length;

    document.getElementById('page-content').innerHTML = `
        <div class="page-header">
            <h1><i class="lucide-layout-dashboard"></i> 대시보드</h1>
        </div>
        <!-- 수집 정보 배너 -->
        <div class="card" style="background:linear-gradient(135deg,#e6f7ff,#f0f7ff);border-color:#91d5ff;padding:16px 24px;margin-bottom:16px;">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
                <div>
                    <div style="font-size:14px;color:var(--heading);font-weight:500;"><i class="lucide-radio-tower"></i> 데이터 수집 현황</div>
                    <div style="font-size:13px;color:var(--text-secondary);margin-top:4px;">
                        마지막 수집: <strong>${escHtml(lastCollected)}</strong> ·
                        마지막 갱신: <strong>${escHtml(lastUpdated)}</strong> ·
                        출처 ${Object.keys(meta.sources || {}).length}개 (기업마당 · 중소벤처기업부 · K-스타트업 · 부처 · 지자체)
                    </div>
                </div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <label style="font-size:13px;display:flex;align-items:center;gap:4px;cursor:pointer;">
                        <input type="checkbox" ${showExpired?'checked':''} onchange="toggleExpired()"> 마감 포함 (${expiredCount}건)
                    </label>
                    <button class="btn btn-primary" id="collectBtn" onclick="triggerCollection()"><i class="lucide-refresh-cw"></i> 수집하기</button>
                </div>
            </div>
            <div id="collectStatus" style="font-size:13px;margin-top:8px;min-height:18px;"></div>
        </div>
        <div class="stat-grid">
            <div class="stat-card"><div class="stat-value">${subsidies.length.toLocaleString()}<span class="stat-suffix">건</span></div><div class="stat-label">${showExpired ? '전체 지원사업' : '진행중 지원사업'}</div></div>
            <div class="stat-card"><div class="stat-value">${active.toLocaleString()}<span class="stat-suffix">건</span></div><div class="stat-label">신청 가능</div></div>
            <div class="stat-card"><div class="stat-value">${closingSoon}<span class="stat-suffix">건</span></div><div class="stat-label">마감 임박 (7일)</div></div>
            <div class="stat-card"><div class="stat-value">${catCount}<span class="stat-suffix">개</span></div><div class="stat-label">분야</div></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
            <div class="card">
                <div class="card-title">분야별 현황</div>
                ${cats.map(([c, n]) => `
                    <div class="score-row">
                        <span class="score-label">${escHtml(c)}</span>
                        <div class="score-bar"><div class="score-fill" style="width:${n/maxCat*100}%;background:#1890ff;"></div></div>
                        <span class="score-value">${n}</span>
                    </div>
                `).join('')}
            </div>
            <div class="card">
                <div class="card-title">주요 기관별 현황</div>
                ${orgs.map(([o, n]) => `
                    <div class="score-row">
                        <span class="score-label" title="${escHtml(o)}">${escHtml(o).slice(0, 10)}</span>
                        <div class="score-bar"><div class="score-fill" style="width:${n/maxOrg*100}%;background:#52c41a;"></div></div>
                        <span class="score-value">${n}</span>
                    </div>
                `).join('')}
            </div>
        </div>
        <div class="card" style="margin-top:16px;">
            <div class="card-title">최근 등록된 지원사업</div>
            <div class="table-container">
                <table class="data-table">
                    <thead><tr><th>상태</th><th>사업명</th><th>분야</th><th>소관기관</th><th>마감일</th></tr></thead>
                    <tbody>
                        ${subsidies.slice(0, 15).map(s => {
                            const st = getStatus(s.apply_end_date);
                            return `<tr onclick="showDetail(${s.id})">
                                <td><span class="tag ${st.cls}">${st.text}</span></td>
                                <td>${escHtml(s.title).slice(0, 50)}</td>
                                <td>${escHtml(s.category)}</td>
                                <td>${escHtml(s.organization).slice(0, 15)}</td>
                                <td>${s.apply_end_date || '-'}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

// ===== List =====
function renderList() {
    const cats = [...new Set(subsidies.map(s => s.category).filter(Boolean))].sort();
    document.getElementById('page-content').innerHTML = `
        <div class="page-header"><h1><i class="lucide-list"></i> 지원사업 목록</h1></div>
        <div class="search-box">
            <select class="form-control" id="listCat" onchange="updateListSubcat();filterList()">
                <option value="">전체 분야</option>
                ${cats.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
            <select class="form-control" id="listSubcat" onchange="filterList()" style="display:none;">
                <option value="">전체 유형</option>
            </select>
            <select class="form-control" id="listStatus" onchange="filterList()">
                <option value="">전체 상태</option>
                <option value="active">진행중</option>
                <option value="expired">마감</option>
            </select>
            <input class="form-control" id="listKeyword" placeholder="사업명, 기관명 검색..." onkeyup="filterList()" style="flex:1;max-width:400px;">
        </div>
        <div id="listCount" style="margin-bottom:8px;font-size:14px;color:var(--text-secondary);"></div>
        <div class="table-container" id="listTable"></div>
    `;
    filterList();
}

function updateListSubcat() {
    const cat = document.getElementById('listCat').value;
    const sel = document.getElementById('listSubcat');
    if (cat && typeof SUBCATEGORIES !== 'undefined' && SUBCATEGORIES[cat]) {
        sel.style.display = '';
        sel.innerHTML = '<option value="">전체 유형</option>' + Object.keys(SUBCATEGORIES[cat]).map(sc => `<option value="${sc}">${sc}</option>`).join('');
    } else {
        sel.style.display = 'none';
        sel.value = '';
    }
}

function filterList() {
    const cat = document.getElementById('listCat').value;
    const subcat = document.getElementById('listSubcat') ? document.getElementById('listSubcat').value : '';
    const status = document.getElementById('listStatus').value;
    const kw = document.getElementById('listKeyword').value.toLowerCase();

    let filtered = subsidies.filter(s => {
        if (cat && s.category !== cat) return false;
        if (subcat && typeof classifySubcategory === 'function' && classifySubcategory(s) !== subcat) return false;
        if (status === 'active' && s.apply_end_date && s.apply_end_date < today) return false;
        if (status === 'expired' && (!s.apply_end_date || s.apply_end_date >= today)) return false;
        if (kw && !(s.title || '').toLowerCase().includes(kw) && !(s.organization || '').toLowerCase().includes(kw)
            && !(s.target || '').toLowerCase().includes(kw) && !(s.hwp_content || '').toLowerCase().includes(kw)) return false;
        return true;
    });

    document.getElementById('listCount').textContent = `검색 결과: ${filtered.length.toLocaleString()}건`;
    const shown = filtered.slice(0, 200);
    document.getElementById('listTable').innerHTML = `
        <table class="data-table">
            <thead><tr><th style="width:60px">상태</th><th>사업명</th><th>분야</th><th>유형</th><th>소관기관</th><th>신청시작</th><th>마감일</th></tr></thead>
            <tbody>
                ${shown.map(s => {
                    const st = getStatus(s.apply_end_date);
                    return `<tr onclick="showDetail(${s.id})">
                        <td><span class="tag ${st.cls}">${st.text}</span></td>
                        <td title="${escHtml(s.title)}">${escHtml(s.title).slice(0, 55)}</td>
                        <td>${escHtml(s.category)}</td>
                        <td style="font-size:12px;">${typeof classifySubcategory === 'function' ? escHtml(classifySubcategory(s)) : ''}</td>
                        <td title="${escHtml(s.organization)}">${escHtml(s.organization).slice(0, 12)}</td>
                        <td>${s.apply_start_date || '-'}</td>
                        <td>${s.apply_end_date || '-'}</td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>
    `;
}

// ===== Detail Modal =====
function showDetail(id) {
    const s = subsidies.find(x => x.id === id);
    if (!s) return;
    document.getElementById('modalTitle').textContent = s.title;
    const st = getStatus(s.apply_end_date);

    let detailHtml = `
        <div class="detail-grid">
            <div class="detail-label">상태</div><div class="detail-value"><span class="tag ${st.cls}">${st.text}</span></div>
            <div class="detail-label">분야</div><div class="detail-value">${escHtml(s.category)}${typeof classifySubcategory === 'function' ? ' > ' + escHtml(classifySubcategory(s)) : ''}</div>
            <div class="detail-label">소관기관</div><div class="detail-value">${escHtml(s.organization)}</div>
            <div class="detail-label">수행기관</div><div class="detail-value">${escHtml(s.executor)}</div>
            <div class="detail-label">신청기간</div><div class="detail-value">${s.apply_start_date || '-'} ~ ${s.apply_end_date || '-'}</div>
    `;
    if (s.target) detailHtml += `<div class="detail-label">지원대상</div><div class="detail-value">${escHtml(s.target).slice(0, 500)}</div>`;
    if (s.support_amount) detailHtml += `<div class="detail-label">지원금액</div><div class="detail-value">${escHtml(s.support_amount).slice(0, 300)}</div>`;
    if (s.region) detailHtml += `<div class="detail-label">지역</div><div class="detail-value">${escHtml(s.region)}</div>`;
    detailHtml += `</div>`;

    if (s.eligibility_keywords) {
        detailHtml += `<div style="margin-top:16px;"><strong>지원 키워드:</strong><br>
            ${s.eligibility_keywords.split(',').filter(Boolean).map(k => `<span class="tag tag-blue">${k.trim()}</span>`).join(' ')}
        </div>`;
    }

    if (s.detail_content) {
        detailHtml += `<div style="margin-top:16px;"><strong>상세 내용:</strong>
            <div style="background:#fafafa;padding:12px;border:1px solid #f0f0f0;border-radius:4px;margin-top:8px;max-height:200px;overflow-y:auto;font-size:13px;white-space:pre-wrap;">${escHtml(s.detail_content).slice(0, 3000)}</div>
        </div>`;
    }

    if (s.hwp_content) {
        detailHtml += `<div style="margin-top:16px;"><strong>📎 HWP 첨부파일 내용:</strong>
            <div style="background:#f0f7ff;padding:12px;border:1px solid #d6e4ff;border-radius:4px;margin-top:8px;max-height:250px;overflow-y:auto;font-size:13px;white-space:pre-wrap;">${escHtml(s.hwp_content).slice(0, 5000)}</div>
        </div>`;
    }

    if (s.detail_url) {
        detailHtml += `<div style="margin-top:16px;"><a href="${escHtml(s.detail_url)}" target="_blank" class="btn btn-primary">상세 페이지 바로가기 →</a></div>`;
    }

    document.getElementById('modalBody').innerHTML = detailHtml;
    document.getElementById('detailModal').classList.add('show');
}

function closeModal() {
    document.getElementById('detailModal').classList.remove('show');
}
document.getElementById('detailModal').addEventListener('click', function(e) {
    if (e.target === this) closeModal();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ===== Matching =====
function renderMatching() {
    if (!savedProfile) {
        document.getElementById('page-content').innerHTML = `
            <div class="page-header"><h1><i class="lucide-target"></i> 맞춤 매칭 - 선정확률 분석</h1></div>
            <div class="empty-state">
                <div class="icon"><i class="lucide-settings" style="font-size:48px;color:var(--primary);"></i></div>
                <p>사업자 프로필이 없습니다.</p>
                <p style="margin-top:8px;">먼저 <strong><i class="lucide-settings"></i> 설정</strong> 메뉴에서 '지원대상 조건 설정'을 등록해주세요.</p>
                <button class="btn btn-primary" style="margin-top:16px;" onclick="navigateTo('settings')">설정으로 이동</button>
            </div>`;
        return;
    }

    const cats = [...new Set(subsidies.map(s => s.category).filter(Boolean))].sort();
    const p = savedProfile;
    const rev = p.annual_revenue ? `${(p.annual_revenue / 10000).toLocaleString()}만원` : '-';

    document.getElementById('page-content').innerHTML = `
        <div class="page-header"><h1><i class="lucide-target"></i> 맞춤 매칭 - 선정확률 분석</h1></div>
        <div class="card">
            <div class="card-title"><i class="lucide-clipboard-list"></i> 선택된 프로필: ${escHtml(p.profile_name || '기본 프로필')}</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:14px;margin-top:8px;">
                <div><strong>유형:</strong> ${escHtml(p.business_type)}</div>
                <div><strong>업종:</strong> ${escHtml(p.industry_name)}</div>
                <div><strong>지역:</strong> ${escHtml(p.region_sido)} ${escHtml(p.region_sigungu || '')}</div>
                <div><strong>연매출:</strong> ${rev}</div>
                <div><strong>종업원:</strong> ${p.employee_count || '-'}명</div>
                <div><strong>업력:</strong> ${p.business_age_years || '-'}년</div>
            </div>
        </div>
        <div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;">
            <select class="form-control" id="matchCat" style="max-width:200px;" onchange="updateMatchSubcat()">
                <option value="">전체 분야</option>
                ${cats.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
            <select class="form-control" id="matchSubcat" style="max-width:200px;display:none;">
                <option value="">전체 유형</option>
            </select>
            <label style="font-size:14px;">최소 확률:</label>
            <input type="range" id="matchMin" min="0" max="50" value="10" style="width:120px;"
                   oninput="document.getElementById('matchMinVal').textContent=this.value+'%'">
            <span id="matchMinVal" style="font-size:14px;">10%</span>
            <button class="btn btn-primary btn-lg" onclick="runMatching()"><i class="lucide-target"></i> 맞춤 매칭 실행</button>
        </div>
        <div id="matchResults"></div>
    `;

    if (matchResults.length) renderMatchResults();
}

function updateMatchSubcat() {
    const cat = document.getElementById('matchCat').value;
    const sel = document.getElementById('matchSubcat');
    if (sel && cat && typeof SUBCATEGORIES !== 'undefined' && SUBCATEGORIES[cat]) {
        sel.style.display = '';
        sel.innerHTML = '<option value="">전체 유형</option>' + Object.keys(SUBCATEGORIES[cat]).map(sc => `<option value="${sc}">${sc}</option>`).join('');
    } else if (sel) {
        sel.style.display = 'none';
        sel.value = '';
    }
}

function runMatching() {
    const cat = document.getElementById('matchCat').value;
    const subcat = document.getElementById('matchSubcat') ? document.getElementById('matchSubcat').value : '';
    const minProb = parseInt(document.getElementById('matchMin').value);
    const target = subsidies.filter(s => {
        if (cat && s.category !== cat) return false;
        if (subcat && typeof classifySubcategory === 'function' && classifySubcategory(s) !== subcat) return false;
        return !s.apply_end_date || s.apply_end_date >= today;
    });

    document.getElementById('matchResults').innerHTML = '<div class="loading"><div class="spinner"></div><p style="margin-top:8px;">선정확률 계산 중...</p></div>';

    setTimeout(() => {
        const engine = new ProbabilityEngine(history);
        matchResults = engine.calculateAll(target, savedProfile, minProb);
        renderMatchResults();
    }, 100);
}

function renderMatchResults() {
    if (!matchResults.length) {
        document.getElementById('matchResults').innerHTML = '<div class="empty-state"><div class="icon"><i class="lucide-clipboard" style="font-size:48px;color:var(--primary);"></i></div><p>매칭 결과가 없습니다.</p></div>';
        return;
    }
    const probs = matchResults.map(r => r.final_probability);
    const avg = probs.reduce((a, b) => a + b, 0) / probs.length;
    const high = probs.filter(p => p >= 70).length;

    let html = `
        <div class="stat-grid" style="margin-bottom:16px;">
            <div class="stat-card"><div class="stat-value">${matchResults.length}<span class="stat-suffix">건</span></div><div class="stat-label">매칭 사업 수</div></div>
            <div class="stat-card"><div class="stat-value">${avg.toFixed(1)}<span class="stat-suffix">%</span></div><div class="stat-label">평균 선정확률</div></div>
            <div class="stat-card"><div class="stat-value">${high}<span class="stat-suffix">건</span></div><div class="stat-label">높은 확률 (70%+)</div></div>
            <div class="stat-card"><div class="stat-value">${Math.max(...probs).toFixed(1)}<span class="stat-suffix">%</span></div><div class="stat-label">최고 확률</div></div>
        </div>
    `;

    matchResults.slice(0, 100).forEach((r, i) => {
        const level = r.final_probability >= 70 ? 'high' : r.final_probability >= 40 ? 'medium' : 'low';
        const scoreColor = { high: '#52c41a', medium: '#faad14', low: '#ff4d4f' }[level];
        const d = r.matching_details || {};
        html += `
        <div class="match-card ${level}">
            <div class="match-header">
                <div>
                    <div class="match-title">#${i + 1}. ${escHtml(r.subsidy_title).slice(0, 60)}</div>
                    <div class="match-meta">
                        ${escHtml(r.category)}${r.subcategory ? ' > '+escHtml(r.subcategory) : ''} · ${escHtml(r.organization)} · 마감: ${r.apply_end_date || '-'}
                        · 신뢰도: ${r.confidence_level}
                    </div>
                </div>
                <div class="match-prob ${level}">
                            ${r.final_probability.toFixed(0)}%
                            ${r.probability_range ? `<div style="font-size:11px;font-weight:400;opacity:0.7;">${r.probability_range.low.toFixed(0)}~${r.probability_range.high.toFixed(0)}%</div>` : ''}
                        </div>
            </div>
            <div style="margin-top:8px;">
                <button class="btn" onclick="this.nextElementSibling.classList.toggle('show');this.textContent=this.textContent==='상세 분석 ▼'?'접기 ▲':'상세 분석 ▼'">상세 분석 ▼</button>
                <div class="match-details">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
                        <div>
                            <strong>점수 분석</strong>
                            ${[['자격요건 적합도', r.eligibility_score], ['조건 매칭도', r.matching_score],
                               ['선정률 (사전확률)', r.competition_score], ['이력 기반 점수', r.historical_score]]
                                .map(([l, v]) => `
                                    <div class="score-row">
                                        <span class="score-label">${l}</span>
                                        <div class="score-bar"><div class="score-fill" style="width:${v}%;background:${v>=70?'#52c41a':v>=40?'#faad14':'#ff4d4f'}"></div></div>
                                        <span class="score-value">${v.toFixed(0)}</span>
                                    </div>
                                `).join('')}
                        </div>
                        <div>
                            <strong>추천사항</strong>
                            <ul class="recommendations">${(r.recommendations || []).map(rec => `<li>${rec}</li>`).join('')}</ul>
                            <strong style="display:block;margin-top:12px;">매칭 세부</strong>
                            ${Object.entries({업종: d.industry_match, 규모: d.scale_match, 목적: d.purpose_match, 지역: d.region_match, 자격: d.qualification_match, 사업설명: d.description_match})
                                .map(([l, v]) => `<span style="margin-right:12px;font-size:13px;">${l}: <strong>${(v||0).toFixed(0)}</strong></span>`)
                                .join('')}
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
    });
    document.getElementById('matchResults').innerHTML = html;
}

// ===== Search =====
function renderSearch() {
    const cats = [...new Set(subsidies.map(s => s.category).filter(Boolean))].sort();
    document.getElementById('page-content').innerHTML = `
        <div class="page-header"><h1><i class="lucide-search"></i> 상세 검색</h1></div>
        <div class="card">
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">키워드 (제목/내용/HWP 검색)</label>
                    <input class="form-control" id="srchKw" placeholder="검색어 입력">
                </div>
                <div class="form-group">
                    <label class="form-label">분야</label>
                    <select class="form-control" id="srchCat" onchange="updateSrchSubcat()">
                        <option value="">전체</option>
                        ${cats.map(c => `<option value="${c}">${c}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">유형</label>
                    <select class="form-control" id="srchSubcat">
                        <option value="">전체</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">상태</label>
                    <select class="form-control" id="srchStatus">
                        <option value="">전체</option>
                        <option value="active">진행중</option>
                        <option value="expired">마감</option>
                    </select>
                </div>
            </div>
            <button class="btn btn-primary btn-block" onclick="doSearch()">검색</button>
        </div>
        <div id="searchResults"></div>
    `;
}

function updateSrchSubcat() {
    const cat = document.getElementById('srchCat').value;
    const sel = document.getElementById('srchSubcat');
    if (sel && cat && typeof SUBCATEGORIES !== 'undefined' && SUBCATEGORIES[cat]) {
        sel.innerHTML = '<option value="">전체</option>' + Object.keys(SUBCATEGORIES[cat]).map(sc => `<option value="${sc}">${sc}</option>`).join('');
    } else if (sel) {
        sel.innerHTML = '<option value="">전체</option>';
    }
}

function doSearch() {
    const kw = document.getElementById('srchKw').value.toLowerCase();
    const cat = document.getElementById('srchCat').value;
    const subcat = document.getElementById('srchSubcat') ? document.getElementById('srchSubcat').value : '';
    const status = document.getElementById('srchStatus').value;

    const results = subsidies.filter(s => {
        if (cat && s.category !== cat) return false;
        if (subcat && typeof classifySubcategory === 'function' && classifySubcategory(s) !== subcat) return false;
        if (status === 'active' && s.apply_end_date && s.apply_end_date < today) return false;
        if (status === 'expired' && (!s.apply_end_date || s.apply_end_date >= today)) return false;
        if (kw) {
            const text = [s.title, s.description, s.detail_content, s.hwp_content, s.target, s.organization]
                .filter(Boolean).join(' ').toLowerCase();
            if (!text.includes(kw)) return false;
        }
        return true;
    }).slice(0, 200);

    document.getElementById('searchResults').innerHTML = `
        <p style="margin:16px 0;font-size:14px;"><strong>검색 결과: ${results.length}건</strong></p>
        <div class="table-container">
            <table class="data-table">
                <thead><tr><th>상태</th><th>사업명</th><th>분야</th><th>소관기관</th><th>지원대상</th><th>마감일</th></tr></thead>
                <tbody>
                    ${results.map(s => {
                        const st = getStatus(s.apply_end_date);
                        return `<tr onclick="showDetail(${s.id})">
                            <td><span class="tag ${st.cls}">${st.text}</span></td>
                            <td title="${escHtml(s.title)}">${escHtml(s.title).slice(0, 45)}</td>
                            <td>${escHtml(s.category)}</td>
                            <td>${escHtml(s.organization).slice(0, 12)}</td>
                            <td title="${escHtml(s.target)}">${escHtml(s.target || '').slice(0, 20)}</td>
                            <td>${s.apply_end_date || '-'}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// ===== Stats =====
function renderStats() {
    // ── 1. 기초 데이터 집계 ──
    const catCounts = {};
    const orgCounts = {};
    const srcCounts = {};
    const execCounts = {};
    const orgCatMatrix = {}; // org → { cat → count }
    const deadlineSubs = [];
    const kwCounts = {};

    subsidies.forEach(s => {
        catCounts[s.category] = (catCounts[s.category] || 0) + 1;
        orgCounts[s.organization || '기타'] = (orgCounts[s.organization || '기타'] || 0) + 1;
        srcCounts[s.source || 'unknown'] = (srcCounts[s.source || 'unknown'] || 0) + 1;
        if (s.executor) execCounts[s.executor] = (execCounts[s.executor] || 0) + 1;

        const org = s.organization || '기타';
        if (!orgCatMatrix[org]) orgCatMatrix[org] = {};
        orgCatMatrix[org][s.category] = (orgCatMatrix[org][s.category] || 0) + 1;

        if (s.apply_end_date) {
            const diff = (new Date(s.apply_end_date) - new Date()) / 86400000;
            if (diff >= 0 && diff <= 30) deadlineSubs.push({...s, daysLeft: Math.ceil(diff)});
        }

        // 키워드 추출
        (s.title || '').replace(/[가-힣]{2,}/g, w => {
            if (!['공고','모집','안내','계획','사업','지원','년도','수정','연장','대한'].includes(w))
                kwCounts[w] = (kwCounts[w] || 0) + 1;
        });
    });

    const cats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
    const maxCat = Math.max(...cats.map(c => c[1]), 1);
    const orgs = Object.entries(orgCounts).sort((a, b) => b[1] - a[1]);
    const topOrgs = orgs.slice(0, 15);
    const maxOrg = Math.max(...topOrgs.map(o => o[1]), 1);
    const topKw = Object.entries(kwCounts).sort((a, b) => b[1] - a[1]).slice(0, 40);
    const maxKw = Math.max(...topKw.map(k => k[1]), 1);
    deadlineSubs.sort((a, b) => a.daysLeft - b.daysLeft);

    // ── 2. 분야별 집중도 분석 (HHI) ──
    const totalSub = subsidies.length;
    const hhi = cats.reduce((s, [, n]) => s + Math.pow(n / totalSub * 100, 2), 0);
    const hhiLabel = hhi > 2500 ? '고집중' : hhi > 1500 ? '중집중' : '분산';

    // ── 3. 기관 다양성 지수 (Shannon Entropy) ──
    const shannon = -orgs.reduce((s, [, n]) => {
        const p = n / totalSub;
        return s + (p > 0 ? p * Math.log2(p) : 0);
    }, 0);
    const maxEntropy = Math.log2(orgs.length);
    const evenness = maxEntropy > 0 ? (shannon / maxEntropy * 100).toFixed(1) : 0;

    // ── 4. 기관-분야 크로스탭 (상위 20기관 × 전체 분야) ──
    const ctOrgs = orgs.slice(0, 20).map(o => o[0]);
    const ctCats = cats.map(c => c[0]);

    // ── 5. 출처별 분석 ──
    const srcNames = { bizinfo: '기업마당', mss: '중소벤처기업부', kstartup: 'K-스타트업', smes: '중소벤처24' };
    const srcs = Object.entries(srcCounts).sort((a, b) => b[1] - a[1]);
    const totalSrc = srcs.reduce((s, [, n]) => s + n, 0);

    // ── 6. SVG 차트 생성 헬퍼 (통일 크기) ──
    const CHART_COLORS = ['#2563eb','#16a34a','#d97706','#dc2626','#7c3aed','#0891b2','#db2777','#ea580c','#65a30d','#4f46e5','#0d9488','#c026d3','#e11d48','#ca8a04','#059669'];

    function svgDonut(data, chartId) {
        const w = 380, h = 240;
        const cx = 130, cy = h / 2, r = 85, ir = r * 0.55;
        const total = data.reduce((s, d) => s + d[1], 0);
        let cumAngle = -Math.PI / 2;
        let paths = '', legends = '';
        data.forEach(([label, val], i) => {
            const angle = (val / total) * Math.PI * 2;
            const x1 = cx + r * Math.cos(cumAngle), y1 = cy + r * Math.sin(cumAngle);
            const x2 = cx + r * Math.cos(cumAngle + angle), y2 = cy + r * Math.sin(cumAngle + angle);
            const ix1 = cx + ir * Math.cos(cumAngle), iy1 = cy + ir * Math.sin(cumAngle);
            const ix2 = cx + ir * Math.cos(cumAngle + angle), iy2 = cy + ir * Math.sin(cumAngle + angle);
            const large = angle > Math.PI ? 1 : 0;
            paths += '<path d="M'+x1+','+y1+' A'+r+','+r+' 0 '+large+' 1 '+x2+','+y2+' L'+ix2+','+iy2+' A'+ir+','+ir+' 0 '+large+' 0 '+ix1+','+iy1+'Z" fill="'+CHART_COLORS[i%CHART_COLORS.length]+'" opacity="0.85" style="cursor:pointer" onclick="openKG(\''+chartId+'\',\''+label.replace(/'/g,"\\'")+'\')"><title>'+label+': '+val+'건 ('+(val/total*100).toFixed(1)+'%)</title></path>';
            cumAngle += angle;
            if (i < 8) legends += '<text x="240" y="'+(30+i*24)+'" font-size="12" fill="#334155" style="cursor:pointer" onclick="openKG(\''+chartId+'\',\''+label.replace(/'/g,"\\'")+'\')"><tspan fill="'+CHART_COLORS[i%CHART_COLORS.length]+'" font-size="14">● </tspan>'+label+' <tspan fill="#94a3b8">'+(val/total*100).toFixed(1)+'%</tspan></text>';
        });
        return '<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="xMidYMid meet">' + paths + '<text x="'+cx+'" y="'+(cy+2)+'" text-anchor="middle" font-size="14" font-weight="bold" fill="#0f172a">'+total+'건</text>' + legends + '</svg>';
    }

    function svgTreemap(data, chartId) {
        const w = 600, h = 90;
        const total = data.reduce((s, d) => s + d[1], 0);
        let rects = '', x = 0;
        data.forEach(([label, val], i) => {
            const rw = (val / total) * w;
            if (rw < 2) return;
            rects += '<g style="cursor:pointer" onclick="openKG(\''+chartId+'\',\''+label.replace(/'/g,"\\'")+'\')"><rect x="'+x+'" y="0" width="'+rw+'" height="'+h+'" fill="'+CHART_COLORS[i%CHART_COLORS.length]+'" rx="4" opacity="0.85" stroke="#fff" stroke-width="1.5"><title>'+label+': '+val+'건</title></rect>';
            if (rw > 50) rects += '<text x="'+(x+rw/2)+'" y="'+(h/2-4)+'" text-anchor="middle" font-size="'+(rw>90?12:10)+'" fill="#fff" font-weight="600">'+label+'</text><text x="'+(x+rw/2)+'" y="'+(h/2+12)+'" text-anchor="middle" font-size="10" fill="rgba(255,255,255,0.85)">'+val+'건</text>';
            rects += '</g>';
            x += rw;
        });
        return '<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="xMidYMid meet">'+rects+'</svg>';
    }

    function svgHeatmap(rowLabels, colLabels, matrix, chartId) {
        const ch = Math.max(20, Math.min(28, 400 / rowLabels.length));
        const w = 700, h = 40 + rowLabels.length * ch + 10;
        const cw = Math.floor((w - 120) / colLabels.length);
        const maxVal = Math.max(...matrix.flat(), 1);
        let cells = '';
        colLabels.forEach((c, ci) => {
            cells += '<text x="'+(125+ci*cw+cw/2)+'" y="16" text-anchor="middle" font-size="9" fill="#64748b" transform="rotate(-30,'+(125+ci*cw+cw/2)+',16)">'+c+'</text>';
        });
        rowLabels.forEach((r, ri) => {
            cells += '<text x="115" y="'+(38+ri*ch+ch/2)+'" text-anchor="end" font-size="9" fill="#334155">'+(r.length>12?r.substring(0,11)+'..':r)+'</text>';
            colLabels.forEach((c, ci) => {
                const v = matrix[ri] ? (matrix[ri][ci] || 0) : 0;
                const intensity = v / maxVal;
                const cr = Math.round(37+(230-37)*(1-intensity));
                const cg = Math.round(99+(247-99)*(1-intensity));
                const cb = Math.round(235+(255-235)*(1-intensity));
                cells += '<rect x="'+(125+ci*cw)+'" y="'+(30+ri*ch)+'" width="'+(cw-2)+'" height="'+(ch-2)+'" fill="rgb('+cr+','+cg+','+cb+')" rx="3" style="cursor:pointer" onclick="openKG(\''+chartId+'\',\''+r.replace(/'/g,"\\'")+' × '+c.replace(/'/g,"\\'")+'\')"><title>'+r+' × '+c+': '+v+'건</title></rect>';
                if (v > 0 && cw > 24) cells += '<text x="'+(125+ci*cw+cw/2)+'" y="'+(30+ri*ch+ch/2+3)+'" text-anchor="middle" font-size="'+(cw>35?9:7)+'" fill="'+(intensity>0.5?'#fff':'#475569')+'" pointer-events="none">'+v+'</text>';
            });
        });
        return '<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="xMidYMid meet">'+cells+'</svg>';
    }

    // ── 7. 키워드 클라우드 (SVG) ──
    function svgWordCloud(words, chartId) {
        const w = 500, h = 240;
        const maxF = Math.max(...words.map(w => w[1]), 1);
        let texts = '';
        words.forEach(([word, freq], i) => {
            const fontSize = Math.max(11, Math.round(11 + (freq / maxF) * 24));
            const angle = i * 0.75;
            const radius = 10 + i * 4.2;
            let x = w/2 + Math.cos(angle) * radius;
            let y = h/2 + Math.sin(angle) * radius * 0.55;
            x = Math.max(35, Math.min(w - 35, x));
            y = Math.max(20, Math.min(h - 10, y));
            texts += '<text x="'+x+'" y="'+y+'" font-size="'+fontSize+'" fill="'+CHART_COLORS[i%CHART_COLORS.length]+'" text-anchor="middle" opacity="'+(0.7+(freq/maxF)*0.3).toFixed(2)+'" font-weight="'+(freq/maxF>0.4?'bold':'normal')+'" style="cursor:pointer" onclick="openKG(\'keyword\',\''+word.replace(/'/g,"\\'")+'\')"><title>'+word+': '+freq+'건</title>'+word+'</text>';
        });
        return '<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="xMidYMid meet" style="background:var(--bg);border-radius:8px;">'+texts+'</svg>';
    }

    // ── 8. 히트맵 데이터 구성 ──
    const hmMatrix = ctOrgs.map(org => ctCats.map(cat => (orgCatMatrix[org] || {})[cat] || 0));

    // ── 9. 수행기관 네트워크 (상위) ──
    const topExecs = Object.entries(execCounts).sort((a, b) => b[1] - a[1]).filter(e => e[0] !== '중소벤처기업부').slice(0, 12);
    const maxExec = Math.max(...topExecs.map(e => e[1]), 1);

    // ── 10. 마감 임박 타임라인 ──
    const urgentSubs = deadlineSubs.slice(0, 15);

    // ── 11. 인사이트 도출 ──
    const topOrg = orgs[0];
    const topOrgShare = (topOrg[1] / totalSub * 100).toFixed(1);
    const centralGovCount = orgs.filter(([o]) => ['중소벤처기업부','고용노동부','산업통상부','과학기술정보통신부','농림축산식품부','문화체육관광부','해양수산부','보건복지부','환경부','국토교통부'].includes(o)).reduce((s, [, n]) => s + n, 0);
    const localGovCount = totalSub - centralGovCount;
    const topCat = cats[0];
    const topCatShare = (topCat[1] / totalSub * 100).toFixed(1);

    // ── Render ──
    document.getElementById('page-content').innerHTML = `
        <div class="page-header"><h1><i class="lucide-bar-chart-3"></i> 심화 통계 분석</h1>
            <p style="color:var(--text-secondary);font-size:13px;margin-top:4px;">
                총 <strong>${totalSub.toLocaleString()}</strong>건 지원사업 데이터 기반 · 최종 수집: ${meta.last_collected || '-'}
            </p>
        </div>

        <!-- KPI 요약 -->
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px;">
            <div class="stat-card"><div class="stat-value">${totalSub.toLocaleString()}<span class="stat-suffix">건</span></div><div class="stat-label">총 지원사업</div></div>
            <div class="stat-card"><div class="stat-value">${cats.length}<span class="stat-suffix">개</span></div><div class="stat-label">분야 수</div></div>
            <div class="stat-card"><div class="stat-value">${orgs.length}<span class="stat-suffix">개</span></div><div class="stat-label">소관기관 수</div></div>
            <div class="stat-card"><div class="stat-value">${deadlineSubs.length}<span class="stat-suffix">건</span></div><div class="stat-label">30일내 마감</div></div>
            <div class="stat-card"><div class="stat-value">${Object.keys(srcCounts).length}<span class="stat-suffix">개</span></div><div class="stat-label">데이터 출처</div></div>
        </div>

        <!-- 핵심 인사이트 -->
        <div class="card" style="margin-bottom:16px;background:linear-gradient(135deg,#f0f5ff,#e6fffb);border:1px solid #d6e4ff;">
            <div class="card-title"><i class="lucide-lightbulb"></i> 핵심 인사이트</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;font-size:13px;line-height:1.7;">
                <div>
                    <strong style="color:#1890ff;">시장 집중도</strong><br>
                    HHI 지수 <strong>${hhi.toFixed(0)}</strong> (${hhiLabel})<br>
                    '${topCat[0]}' 분야가 전체의 <strong>${topCatShare}%</strong>를 차지하여 ${parseFloat(topCatShare) > 50 ? '높은 편중' : '보통 수준의 집중도'}를 보입니다.
                </div>
                <div>
                    <strong style="color:#52c41a;">기관 다양성</strong><br>
                    Shannon 균등도 <strong>${evenness}%</strong><br>
                    ${topOrg[0]}이 <strong>${topOrgShare}%</strong>로 최다이며, 중앙부처 ${centralGovCount}건 vs 지자체·기타 ${localGovCount}건입니다.
                </div>
                <div>
                    <strong style="color:#ff4d4f;">긴급 알림</strong><br>
                    7일 내 마감 <strong>${deadlineSubs.filter(s => s.daysLeft <= 7).length}</strong>건<br>
                    ${urgentSubs.length > 0 ? '가장 임박: <em>' + escHtml(urgentSubs[0].title).substring(0, 25) + '...</em> (' + urgentSubs[0].daysLeft + '일)' : '현재 임박 마감 없음'}
                </div>
            </div>
        </div>

        <!-- Row 1: 도넛 + 트리맵 -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
            <div class="card">
                <div class="card-title"><i class="lucide-pie-chart"></i> 분야별 구성비 (도넛 차트)</div>
                <p style="font-size:11px;color:var(--text-tertiary);margin-bottom:8px;">항목을 클릭하면 연관 정보를 볼 수 있습니다</p>
                <div class="chart-wrap chart-md">${svgDonut(cats, 'category')}</div>
            </div>
            <div class="card" style="display:flex;flex-direction:column;">
                <div class="card-title"><i class="lucide-map"></i> 분야별 비중 (트리맵)</div>
                <p style="font-size:11px;color:var(--text-tertiary);margin-bottom:8px;">면적이 넓을수록 해당 분야의 지원사업이 많습니다</p>
                <div class="chart-wrap" style="flex:1;display:flex;align-items:center;">${svgTreemap(cats, 'category')}</div>
            </div>
        </div>

        <!-- Row 2: 기관별 수평바 + 출처별 도넛 -->
        <div style="display:grid;grid-template-columns:3fr 2fr;gap:16px;margin-bottom:16px;">
            <div class="card">
                <div class="card-title"><i class="lucide-building-2"></i> 소관기관별 사업 현황 (상위 15)</div>
                <div style="padding:4px 0;">
                ${topOrgs.map(([o, n], i) => {
                    const pct = (n / totalSub * 100).toFixed(1);
                    const barColor = i === 0 ? 'var(--primary)' : i < 3 ? 'var(--primary-light)' : i < 7 ? 'var(--primary-lighter)' : '#93c5fd';
                    return '<div style="display:flex;align-items:center;margin-bottom:5px;cursor:pointer;" onclick="openKG(\'org\',\'' + o.replace(/'/g,"\\'") + '\')"><span style="min-width:100px;font-size:12px;color:var(--text-secondary);text-align:right;padding-right:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escHtml(o) + '</span><div style="flex:1;background:var(--border-light);border-radius:20px;height:18px;overflow:hidden;"><div style="height:100%;width:' + (n/maxOrg*100) + '%;background:' + barColor + ';border-radius:20px;transition:width 0.5s;"></div></div><span style="min-width:75px;font-size:12px;color:var(--heading);padding-left:8px;font-weight:' + (i < 3 ? '700' : '400') + ';">' + n + '건 <span style="color:var(--text-tertiary);">' + pct + '%</span></span></div>';
                }).join('')}
                </div>
            </div>
            <div class="card">
                <div class="card-title"><i class="lucide-database"></i> 데이터 출처별 구성</div>
                <div class="chart-wrap chart-md">${svgDonut(srcs.map(([s, n]) => [srcNames[s] || s, n]), 'source')}</div>
            </div>
        </div>

        <!-- Row 3: 히트맵 -->
        <div class="card" style="margin-bottom:16px;">
            <div class="card-title"><i class="lucide-grid-3x3"></i> 기관 × 분야 교차 히트맵</div>
            <p style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;">상위 20개 기관의 분야별 분포입니다. 셀을 클릭하면 연관 정보를 확인할 수 있습니다.</p>
            <div class="chart-wrap">${svgHeatmap(ctOrgs, ctCats, hmMatrix, 'heatmap')}</div>
        </div>

        <!-- Row 4: 키워드 클라우드 + 수행기관 -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
            <div class="card">
                <div class="card-title"><i class="lucide-cloud"></i> 키워드 클라우드</div>
                <p style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;">키워드를 클릭하면 관련 사업을 볼 수 있습니다</p>
                <div class="chart-wrap chart-md">${svgWordCloud(topKw, 'keyword')}</div>
            </div>
            <div class="card">
                <div class="card-title"><i class="lucide-network"></i> 주요 수행기관 네트워크</div>
                <p style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">클릭하면 수행기관의 연관 사업을 확인합니다</p>
                <div style="display:flex;flex-wrap:wrap;gap:6px;">
                ${topExecs.map(([e, n]) => {
                    return '<div style="display:inline-flex;align-items:center;padding:6px 14px;background:var(--primary-bg);border:1px solid var(--primary-border);border-radius:20px;font-size:12px;cursor:pointer;transition:all 0.2s;" onclick="openKG(\'executor\',\'' + e.replace(/'/g,"\\'") + '\')" onmouseenter="this.style.background=\'var(--primary)\';this.style.color=\'#fff\'" onmouseleave="this.style.background=\'var(--primary-bg)\';this.style.color=\'inherit\'"><span style="display:inline-block;width:' + Math.round(8 + n/maxExec*10) + 'px;height:' + Math.round(8 + n/maxExec*10) + 'px;border-radius:50%;background:var(--primary);margin-right:6px;opacity:' + (0.4 + n/maxExec*0.6).toFixed(2) + ';"></span>' + escHtml(e).substring(0, 15) + ' <strong style="margin-left:4px;">' + n + '</strong></div>';
                }).join('')}
                </div>
            </div>
        </div>

        <!-- Row 5: 마감 임박 타임라인 -->
        <div class="card" style="margin-bottom:16px;">
            <div class="card-title"><i class="lucide-clock"></i> 마감 임박 사업 타임라인 (30일 내)</div>
            ${urgentSubs.length ? `
            <div style="position:relative;padding:8px 0 8px 24px;border-left:3px solid #e8e8e8;margin-left:12px;">
                ${urgentSubs.map(s => {
                    const urgency = s.daysLeft <= 3 ? '#ff4d4f' : s.daysLeft <= 7 ? '#faad14' : '#1890ff';
                    return '<div style="position:relative;margin-bottom:12px;padding-left:16px;"><div style="position:absolute;left:-31px;top:4px;width:14px;height:14px;border-radius:50%;background:' + urgency + ';border:2px solid #fff;box-shadow:0 0 0 2px ' + urgency + ';"></div><div style="font-size:13px;"><strong style="color:' + urgency + ';">D-' + s.daysLeft + '</strong> <span style="color:#262626;">' + escHtml(s.title).substring(0, 55) + '</span><br><span style="font-size:11px;color:#8c8c8c;">' + escHtml(s.organization) + ' · ' + escHtml(s.category) + ' · 마감: ' + s.apply_end_date + '</span></div></div>';
                }).join('')}
            </div>
            ` : '<div style="text-align:center;color:var(--text-secondary);padding:20px;">현재 30일 내 마감 예정 사업이 없습니다.</div>'}
        </div>

        <!-- Row 6: 기관별 상세 테이블 -->
        <div class="card">
            <div class="card-title"><i class="lucide-table-2"></i> 기관별 지원사업 상세 분석</div>
            <div class="table-container">
                <table class="data-table">
                    <thead><tr><th>기관</th><th>사업수</th><th>점유율</th><th>주력 분야</th><th>분야 다양성</th><th>마감임박</th></tr></thead>
                    <tbody>
                        ${(() => {
                            return orgs.slice(0, 25).map(([org, cnt]) => {
                                const oCats = orgCatMatrix[org] || {};
                                const oCatArr = Object.entries(oCats).sort((a, b) => b[1] - a[1]);
                                const topC = oCatArr[0] ? oCatArr[0][0] + ' (' + oCatArr[0][1] + ')' : '-';
                                const diversity = oCatArr.length;
                                const urgCnt = deadlineSubs.filter(s => s.organization === org && s.daysLeft <= 7).length;
                                const share = (cnt / totalSub * 100).toFixed(1);
                                return '<tr><td><strong>' + escHtml(org) + '</strong></td><td>' + cnt + '건</td><td><div style="display:flex;align-items:center;gap:6px;"><div style="width:60px;background:var(--border-light);border-radius:20px;height:6px;overflow:hidden;"><div style="height:100%;width:' + share + '%;background:var(--primary);border-radius:20px;"></div></div>' + share + '%</div></td><td>' + topC + '</td><td>' + diversity + '개 분야</td><td>' + (urgCnt > 0 ? '<span style="color:var(--error);font-weight:bold;">' + urgCnt + '건</span>' : '-') + '</td></tr>';
                            }).join('');
                        })()}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- ═══ 심화 통계 분석 섹션 ═══ -->

        <!-- 로렌츠 곡선 & 지니계수 + 파레토 분석 -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
            <div class="card">
                <div class="card-title"><i class="lucide-trending-up"></i> 로렌츠 곡선 & 지니계수 (기관 집중도)</div>
                <div class="chart-wrap chart-md">
                ${(() => {
                    const sorted = orgs.map(o => o[1]).sort((a, b) => a - b);
                    const n = sorted.length;
                    const cumPop = [0], cumShare = [0];
                    let runSum = 0;
                    sorted.forEach((v, i) => { runSum += v; cumPop.push((i+1)/n); cumShare.push(runSum/totalSub); });
                    let giniArea = 0;
                    for (let i = 1; i < cumPop.length; i++) giniArea += (cumPop[i]-cumPop[i-1])*(cumShare[i]+cumShare[i-1])/2;
                    const gini = (0.5 - giniArea) / 0.5;
                    const w = 400, h = 280, pad = 48;
                    const pw = w-pad*2, ph = h-pad*2;
                    let lorenzPath = 'M'+pad+','+(pad+ph);
                    cumPop.forEach((p, i) => { lorenzPath += ' L'+(pad+p*pw)+','+(pad+ph-cumShare[i]*ph); });
                    let gridLines = '';
                    for (let g = 0.25; g <= 0.75; g += 0.25) {
                        const gx = pad+g*pw, gy = pad+ph-g*ph;
                        gridLines += '<line x1="'+pad+'" y1="'+gy+'" x2="'+(pad+pw)+'" y2="'+gy+'" stroke="#e2e8f0" stroke-width="0.5"/>';
                        gridLines += '<line x1="'+gx+'" y1="'+pad+'" x2="'+gx+'" y2="'+(pad+ph)+'" stroke="#e2e8f0" stroke-width="0.5"/>';
                        gridLines += '<text x="'+(pad-6)+'" y="'+(gy+3)+'" text-anchor="end" font-size="9" fill="#94a3b8">'+(g*100).toFixed(0)+'%</text>';
                        gridLines += '<text x="'+gx+'" y="'+(pad+ph+14)+'" text-anchor="middle" font-size="9" fill="#94a3b8">'+(g*100).toFixed(0)+'%</text>';
                    }
                    return '<svg viewBox="0 0 '+w+' '+(h+20)+'" preserveAspectRatio="xMidYMid meet">' + gridLines +
                        '<line x1="'+pad+'" y1="'+(pad+ph)+'" x2="'+(pad+pw)+'" y2="'+pad+'" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="4,4"/>' +
                        '<path d="'+lorenzPath+'" fill="rgba(37,99,235,0.12)" stroke="var(--primary)" stroke-width="2.5" fill-opacity="0.3"/>' +
                        '<text x="'+(pad+pw/2)+'" y="'+(pad+ph+30)+'" text-anchor="middle" font-size="10" fill="#64748b">기관 누적 비율 (%)</text>' +
                        '<text x="'+(pad-34)+'" y="'+(pad+ph/2)+'" text-anchor="middle" font-size="10" fill="#64748b" transform="rotate(-90,'+(pad-34)+','+(pad+ph/2)+')">사업 누적 비율 (%)</text>' +
                        '<rect x="'+(pad+pw-145)+'" y="'+(pad+8)+'" width="140" height="42" rx="8" fill="white" stroke="var(--border)" stroke-width="1"/>' +
                        '<text x="'+(pad+pw-135)+'" y="'+(pad+26)+'" font-size="12" fill="var(--heading)" font-weight="700">지니계수: '+gini.toFixed(3)+'</text>' +
                        '<text x="'+(pad+pw-135)+'" y="'+(pad+42)+'" font-size="9" fill="'+(gini>0.6?'var(--error)':gini>0.4?'var(--warning)':'var(--success)')+'">'+(gini>0.6?'매우 불균등 (상위 기관 과도 집중)':gini>0.4?'보통 수준의 불균등':'비교적 균등한 분포')+'</text>' +
                    '</svg>';
                })()}
                </div>
                <p style="font-size:11px;color:var(--text-tertiary);margin-top:8px;">곡선이 대각선에서 멀수록 소수 기관에 사업이 편중되어 있음을 나타냅니다.</p>
            </div>

            <div class="card">
                <div class="card-title"><i class="lucide-bar-chart-horizontal"></i> 파레토 분석 (80/20 법칙)</div>
                <div class="chart-wrap chart-md">
                ${(() => {
                    const sortedDesc = orgs.map(o => o[1]).sort((a, b) => b - a);
                    const w = 400, h = 280, pad = 48;
                    const pw = w-pad*2, ph = h-pad*2;
                    const barW = Math.max(5, Math.min(18, pw/Math.min(sortedDesc.length, 25)));
                    const maxBar = sortedDesc[0];
                    let bars = '', cumLine = 'M', cumSum = 0, pareto80 = -1;
                    const showN = Math.min(sortedDesc.length, 25);
                    for (let i = 0; i < showN; i++) {
                        const bh = (sortedDesc[i]/maxBar)*ph;
                        const bx = pad+(i/showN)*pw+(pw/showN-barW)/2;
                        bars += '<rect x="'+bx+'" y="'+(pad+ph-bh)+'" width="'+barW+'" height="'+bh+'" fill="var(--primary)" rx="2" opacity="0.75"><title>#'+(i+1)+'위: '+sortedDesc[i]+'건</title></rect>';
                        cumSum += sortedDesc[i];
                        const cumPct = cumSum/totalSub;
                        const cx2 = pad+((i+0.5)/showN)*pw;
                        const cy2 = pad+ph-cumPct*ph;
                        cumLine += (i===0?'':' L')+cx2+','+cy2;
                        if (pareto80 < 0 && cumPct >= 0.8) pareto80 = i+1;
                    }
                    const p80y = pad+ph*0.2;
                    return '<svg viewBox="0 0 '+w+' '+(h+20)+'" preserveAspectRatio="xMidYMid meet">' +
                        '<line x1="'+pad+'" y1="'+p80y+'" x2="'+(pad+pw)+'" y2="'+p80y+'" stroke="var(--error)" stroke-width="1" stroke-dasharray="4,3" opacity="0.6"/>' +
                        '<text x="'+(pad+pw+4)+'" y="'+(p80y+3)+'" font-size="9" fill="var(--error)">80%</text>' +
                        bars +
                        '<path d="'+cumLine+'" fill="none" stroke="var(--warning)" stroke-width="2.5" stroke-linecap="round"/>' +
                        '<rect x="'+(pad+8)+'" y="'+(pad+8)+'" width="175" height="42" rx="8" fill="white" stroke="var(--border)" stroke-width="1"/>' +
                        '<text x="'+(pad+16)+'" y="'+(pad+26)+'" font-size="12" fill="var(--heading)" font-weight="700">상위 '+pareto80+'개 기관 = 80% 점유</text>' +
                        '<text x="'+(pad+16)+'" y="'+(pad+42)+'" font-size="9" fill="var(--text-secondary)">전체 '+orgs.length+'개 기관 중 '+(pareto80/orgs.length*100).toFixed(1)+'%</text>' +
                        '<text x="'+(pad+pw/2)+'" y="'+(pad+ph+16)+'" text-anchor="middle" font-size="10" fill="#64748b">기관 순위 (사업수 내림차순)</text>' +
                    '</svg>';
                })()}
                </div>
                <p style="font-size:11px;color:var(--text-tertiary);margin-top:8px;">파란 막대는 개별 사업 수, 주황 선은 누적 비율입니다.</p>
            </div>
        </div>

        <!-- 분야 다양성 레이더 + 출처 신뢰도 -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
            <div class="card">
                <div class="card-title"><i class="lucide-radar"></i> 분야별 다양성 레이더 차트</div>
                <div class="chart-wrap chart-md" style="display:flex;justify-content:center;">
                ${(() => {
                    const w = 380, h = 300;
                    const cx3 = w/2, cy3 = h/2+5, rad = 110;
                    const nCats = cats.length;
                    const maxVal = cats[0][1];
                    const angleStep = (Math.PI*2)/nCats;
                    let grid = '';
                    [0.25,0.5,0.75,1.0].forEach(pct => {
                        const rr = rad*pct;
                        let poly = '';
                        for (let i = 0; i < nCats; i++) { const a = -Math.PI/2+i*angleStep; poly += (i===0?'':' ')+(cx3+rr*Math.cos(a))+','+(cy3+rr*Math.sin(a)); }
                        grid += '<polygon points="'+poly+'" fill="none" stroke="#e2e8f0" stroke-width="0.5"/>';
                    });
                    let axes = '';
                    cats.forEach(([cat], i) => {
                        const a = -Math.PI/2+i*angleStep;
                        const lx = cx3+(rad+22)*Math.cos(a);
                        const ly = cy3+(rad+22)*Math.sin(a);
                        axes += '<line x1="'+cx3+'" y1="'+cy3+'" x2="'+(cx3+rad*Math.cos(a))+'" y2="'+(cy3+rad*Math.sin(a))+'" stroke="#e2e8f0" stroke-width="0.5"/>';
                        axes += '<text x="'+lx+'" y="'+(ly+3)+'" text-anchor="middle" font-size="10" fill="#64748b" font-weight="500">'+cat+'</text>';
                    });
                    let dataPath = '', dots = '';
                    cats.forEach(([, val], i) => {
                        const a = -Math.PI/2+i*angleStep;
                        const pr = (val/maxVal)*rad;
                        const px = cx3+pr*Math.cos(a), py = cy3+pr*Math.sin(a);
                        dataPath += (i===0?'':' ')+px+','+py;
                        dots += '<circle cx="'+px+'" cy="'+py+'" r="4" fill="var(--primary)" stroke="white" stroke-width="2" style="cursor:pointer" onclick="openKG(\'category\',\''+cats[i][0].replace(/'/g,"\\'")+'\')"><title>'+cats[i][0]+': '+val+'건</title></circle>';
                    });
                    return '<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="xMidYMid meet">' + grid + axes +
                        '<polygon points="'+dataPath+'" fill="rgba(37,99,235,0.15)" stroke="var(--primary)" stroke-width="2"/>' + dots + '</svg>';
                })()}
                </div>
            </div>

            <div class="card">
                <div class="card-title"><i class="lucide-shield-check"></i> 데이터 품질 & 출처 신뢰도 분석</div>
                ${(() => {
                    // 각 출처별 데이터 품질 점수 계산
                    const srcQuality = {};
                    subsidies.forEach(s => {
                        const src = s.source || 'unknown';
                        if (!srcQuality[src]) srcQuality[src] = { total: 0, hasUrl: 0, hasDate: 0, hasExec: 0, hasOrg: 0 };
                        srcQuality[src].total++;
                        if (s.detail_url) srcQuality[src].hasUrl++;
                        if (s.apply_start_date || s.apply_end_date) srcQuality[src].hasDate++;
                        if (s.executor) srcQuality[src].hasExec++;
                        if (s.organization) srcQuality[src].hasOrg++;
                    });
                    const srcNames2 = { bizinfo: '기업마당', mss: '중소벤처기업부', kstartup: 'K-스타트업', smes: '중소벤처24' };
                    return Object.entries(srcQuality).sort((a,b) => b[1].total - a[1].total).map(([src, q]) => {
                        const urlPct = (q.hasUrl / q.total * 100).toFixed(0);
                        const datePct = (q.hasDate / q.total * 100).toFixed(0);
                        const execPct = (q.hasExec / q.total * 100).toFixed(0);
                        const avgScore = ((parseInt(urlPct) + parseInt(datePct) + parseInt(execPct)) / 3).toFixed(0);
                        const color = avgScore >= 70 ? 'var(--success)' : avgScore >= 40 ? 'var(--warning)' : 'var(--error)';
                        return '<div style="margin-bottom:14px;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;"><span style="font-size:13px;font-weight:600;color:var(--heading);">' + (srcNames2[src]||src) + ' <span style="color:var(--text-tertiary);font-weight:400;">(' + q.total + '건)</span></span><span style="font-size:13px;font-weight:700;color:' + color + ';">' + avgScore + '점</span></div>' +
                        '<div style="display:flex;gap:4px;height:8px;">' +
                        '<div style="flex:1;background:var(--border-light);border-radius:20px;overflow:hidden;" title="URL 보유율 ' + urlPct + '%"><div style="height:100%;width:' + urlPct + '%;background:var(--primary);border-radius:20px;"></div></div>' +
                        '<div style="flex:1;background:var(--border-light);border-radius:20px;overflow:hidden;" title="일정 보유율 ' + datePct + '%"><div style="height:100%;width:' + datePct + '%;background:var(--success);border-radius:20px;"></div></div>' +
                        '<div style="flex:1;background:var(--border-light);border-radius:20px;overflow:hidden;" title="수행기관 보유율 ' + execPct + '%"><div style="height:100%;width:' + execPct + '%;background:var(--warning);border-radius:20px;"></div></div>' +
                        '</div><div style="display:flex;gap:4px;margin-top:3px;font-size:9px;color:var(--text-tertiary);"><span style="flex:1;">URL ' + urlPct + '%</span><span style="flex:1;">일정 ' + datePct + '%</span><span style="flex:1;">수행기관 ' + execPct + '%</span></div></div>';
                    }).join('');
                })()}
            </div>
        </div>

        <!-- 엔트로피 기반 분야 복잡도 + 분포 요약 -->
        <div class="card" style="margin-bottom:16px;">
            <div class="card-title"><i class="lucide-brain"></i> 정보 엔트로피 기반 복잡도 분석</div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;">
                ${(() => {
                    // 분야별 엔트로피
                    const catEntropy = -cats.reduce((s, [, n]) => { const p = n/totalSub; return s + (p > 0 ? p * Math.log2(p) : 0); }, 0);
                    const catMaxEntropy = Math.log2(cats.length);
                    const catNormEntropy = (catEntropy / catMaxEntropy * 100).toFixed(1);
                    // 기관별 엔트로피
                    const orgEntropy = -orgs.reduce((s, [, n]) => { const p = n/totalSub; return s + (p > 0 ? p * Math.log2(p) : 0); }, 0);
                    const orgMaxEntropy = Math.log2(orgs.length);
                    const orgNormEntropy = (orgEntropy / orgMaxEntropy * 100).toFixed(1);
                    // 출처별 엔트로피
                    const srcEntropy = -srcs.reduce((s, [, n]) => { const p = n/totalSrc; return s + (p > 0 ? p * Math.log2(p) : 0); }, 0);
                    const srcMaxEntropy = Math.log2(srcs.length);
                    const srcNormEntropy = (srcEntropy / srcMaxEntropy * 100).toFixed(1);
                    // CR4 (상위 4개 기관 집중률)
                    const cr4 = orgs.slice(0,4).reduce((s,[,n]) => s+n, 0) / totalSub * 100;

                    function makeGauge(label, value, desc, color) {
                        const angle = (value / 100) * 180;
                        const rad2 = angle * Math.PI / 180;
                        const ex = 70 + 52 * Math.cos(Math.PI - rad2);
                        const ey = 72 - 52 * Math.sin(Math.PI - rad2);
                        return '<div style="text-align:center;padding:8px 0;"><svg viewBox="0 0 140 85" style="width:100%;max-width:160px;"><path d="M18,72 A52,52 0 0,1 122,72" fill="none" stroke="var(--border-light)" stroke-width="10" stroke-linecap="round"/><path d="M18,72 A52,52 0 0,1 ' + ex + ',' + ey + '" fill="none" stroke="' + color + '" stroke-width="10" stroke-linecap="round"/><text x="70" y="66" text-anchor="middle" font-size="20" font-weight="800" fill="var(--heading)">' + value + '</text><text x="70" y="80" text-anchor="middle" font-size="9" fill="var(--text-tertiary)">/ 100</text></svg><div style="font-size:13px;font-weight:700;color:var(--heading);margin-top:4px;">' + label + '</div><div style="font-size:11px;color:var(--text-tertiary);margin-top:3px;">' + desc + '</div></div>';
                    }

                    return makeGauge('분야 다양성', catNormEntropy, '분야 엔트로피 균등도', 'var(--primary)') +
                           makeGauge('기관 다양성', orgNormEntropy, '기관 엔트로피 균등도', 'var(--success)') +
                           makeGauge('출처 균형도', srcNormEntropy, '출처 엔트로피 균등도', 'var(--warning)') +
                           makeGauge('CR4 집중률', cr4.toFixed(1), '상위 4개 기관 점유율', cr4 > 80 ? 'var(--error)' : 'var(--primary)');
                })()}
            </div>
        </div>
    `;

}

// ===== Knowledge Graph =====
function openKG(chartType, label) {
    const overlay = document.getElementById('kgOverlay');
    const title = document.getElementById('kgTitle');
    const body = document.getElementById('kgBody');

    // 연관 데이터 수집
    let related = [];
    let stats = {};
    let centerLabel = label;
    let centerColor = 'var(--primary)';

    if (chartType === 'category') {
        const items = subsidies.filter(s => s.category === label);
        const orgMap = {}, srcMap = {}, execMap = {};
        items.forEach(s => {
            orgMap[s.organization || '기타'] = (orgMap[s.organization || '기타'] || 0) + 1;
            srcMap[s.source || 'unknown'] = (srcMap[s.source || 'unknown'] || 0) + 1;
            if (s.executor) execMap[s.executor] = (execMap[s.executor] || 0) + 1;
        });
        const activeCount = items.filter(s => !s.apply_end_date || s.apply_end_date >= today).length;
        stats = { total: items.length, active: activeCount, orgs: Object.keys(orgMap).length, execs: Object.keys(execMap).length };
        related = [
            ...Object.entries(orgMap).sort((a,b) => b[1]-a[1]).slice(0,8).map(([n,c]) => ({name:n, count:c, type:'기관', color:'var(--primary)'})),
            ...Object.entries(execMap).sort((a,b) => b[1]-a[1]).slice(0,5).map(([n,c]) => ({name:n, count:c, type:'수행기관', color:'var(--success)'})),
            ...Object.entries(srcMap).sort((a,b) => b[1]-a[1]).map(([n,c]) => ({name:n, count:c, type:'출처', color:'var(--warning)'}))
        ];
        title.innerHTML = '<i class="lucide-share-2"></i> 분야 연관 그래프: ' + escHtml(label);
    } else if (chartType === 'org') {
        const items = subsidies.filter(s => s.organization === label);
        const catMap = {}, execMap = {};
        items.forEach(s => {
            catMap[s.category] = (catMap[s.category] || 0) + 1;
            if (s.executor) execMap[s.executor] = (execMap[s.executor] || 0) + 1;
        });
        const activeCount = items.filter(s => !s.apply_end_date || s.apply_end_date >= today).length;
        stats = { total: items.length, active: activeCount, cats: Object.keys(catMap).length, execs: Object.keys(execMap).length };
        related = [
            ...Object.entries(catMap).sort((a,b) => b[1]-a[1]).map(([n,c]) => ({name:n, count:c, type:'분야', color:'var(--primary)'})),
            ...Object.entries(execMap).sort((a,b) => b[1]-a[1]).slice(0,6).map(([n,c]) => ({name:n, count:c, type:'수행기관', color:'var(--success)'}))
        ];
        centerColor = 'var(--primary-light)';
        title.innerHTML = '<i class="lucide-share-2"></i> 기관 연관 그래프: ' + escHtml(label);
    } else if (chartType === 'executor') {
        const items = subsidies.filter(s => s.executor === label);
        const catMap = {}, orgMap = {};
        items.forEach(s => {
            catMap[s.category] = (catMap[s.category] || 0) + 1;
            orgMap[s.organization || '기타'] = (orgMap[s.organization || '기타'] || 0) + 1;
        });
        stats = { total: items.length, cats: Object.keys(catMap).length, orgs: Object.keys(orgMap).length };
        related = [
            ...Object.entries(orgMap).sort((a,b) => b[1]-a[1]).map(([n,c]) => ({name:n, count:c, type:'소관기관', color:'var(--primary)'})),
            ...Object.entries(catMap).sort((a,b) => b[1]-a[1]).map(([n,c]) => ({name:n, count:c, type:'분야', color:'var(--warning)'}))
        ];
        centerColor = 'var(--success)';
        title.innerHTML = '<i class="lucide-share-2"></i> 수행기관 연관 그래프: ' + escHtml(label);
    } else if (chartType === 'keyword') {
        const items = subsidies.filter(s => (s.title || '').includes(label));
        const catMap = {}, orgMap = {};
        items.forEach(s => {
            catMap[s.category] = (catMap[s.category] || 0) + 1;
            orgMap[s.organization || '기타'] = (orgMap[s.organization || '기타'] || 0) + 1;
        });
        stats = { total: items.length, cats: Object.keys(catMap).length, orgs: Object.keys(orgMap).length };
        related = [
            ...Object.entries(catMap).sort((a,b) => b[1]-a[1]).map(([n,c]) => ({name:n, count:c, type:'분야', color:'var(--primary)'})),
            ...Object.entries(orgMap).sort((a,b) => b[1]-a[1]).slice(0,6).map(([n,c]) => ({name:n, count:c, type:'기관', color:'var(--success)'}))
        ];
        centerColor = '#7c3aed';
        title.innerHTML = '<i class="lucide-share-2"></i> 키워드 연관 그래프: "' + escHtml(label) + '"';
    } else if (chartType === 'source') {
        const srcNames2 = { '기업마당': 'bizinfo', '중소벤처기업부': 'mss', 'K-스타트업': 'kstartup', '중소벤처24': 'smes' };
        const srcKey = srcNames2[label] || label;
        const items = subsidies.filter(s => s.source === srcKey || s.source === label);
        const catMap = {}, orgMap = {};
        items.forEach(s => {
            catMap[s.category] = (catMap[s.category] || 0) + 1;
            orgMap[s.organization || '기타'] = (orgMap[s.organization || '기타'] || 0) + 1;
        });
        stats = { total: items.length, cats: Object.keys(catMap).length, orgs: Object.keys(orgMap).length };
        related = [
            ...Object.entries(catMap).sort((a,b) => b[1]-a[1]).map(([n,c]) => ({name:n, count:c, type:'분야', color:'var(--primary)'})),
            ...Object.entries(orgMap).sort((a,b) => b[1]-a[1]).slice(0,6).map(([n,c]) => ({name:n, count:c, type:'기관', color:'var(--warning)'}))
        ];
        centerColor = 'var(--warning)';
        title.innerHTML = '<i class="lucide-share-2"></i> 출처 연관 그래프: ' + escHtml(label);
    } else if (chartType === 'heatmap') {
        const parts = label.split(' × ');
        const items = subsidies.filter(s => (s.organization || '기타') === parts[0] && s.category === parts[1]);
        stats = { total: items.length };
        const execMap = {};
        items.forEach(s => { if (s.executor) execMap[s.executor] = (execMap[s.executor]||0)+1; });
        related = Object.entries(execMap).sort((a,b) => b[1]-a[1]).map(([n,c]) => ({name:n, count:c, type:'수행기관', color:'var(--success)'}));
        // 같은 기관의 다른 분야
        const sameOrg = subsidies.filter(s => (s.organization||'기타') === parts[0] && s.category !== parts[1]);
        const otherCats = {};
        sameOrg.forEach(s => { otherCats[s.category] = (otherCats[s.category]||0)+1; });
        related = [...related, ...Object.entries(otherCats).sort((a,b) => b[1]-a[1]).slice(0,5).map(([n,c]) => ({name:n, count:c, type:'동일기관 타분야', color:'var(--primary)'}))];
        centerLabel = parts[0] + ' × ' + parts[1];
        title.innerHTML = '<i class="lucide-share-2"></i> 교차 분석: ' + escHtml(centerLabel);
    }

    // Knowledge Graph SVG 생성
    const maxRel = Math.max(...related.map(r => r.count), 1);
    const gw = 600, gh = 320;
    const gcx = gw/2, gcy = gh/2;
    let graphSvg = '<svg viewBox="0 0 '+gw+' '+gh+'" preserveAspectRatio="xMidYMid meet" style="width:100%;max-height:320px;">';
    // 중심 노드
    graphSvg += '<circle cx="'+gcx+'" cy="'+gcy+'" r="40" fill="'+centerColor+'" opacity="0.15" stroke="'+centerColor+'" stroke-width="2"/>';
    graphSvg += '<text x="'+gcx+'" y="'+(gcy-2)+'" text-anchor="middle" font-size="12" font-weight="700" fill="var(--heading)">'+(centerLabel.length>12?centerLabel.substring(0,12)+'..':centerLabel)+'</text>';
    if (stats.total !== undefined) graphSvg += '<text x="'+gcx+'" y="'+(gcy+14)+'" text-anchor="middle" font-size="11" fill="var(--text-secondary)">'+stats.total+'건</text>';

    // 주변 노드
    const nodeCount = Math.min(related.length, 14);
    related.slice(0, nodeCount).forEach((rel, i) => {
        const angle = -Math.PI/2 + (i / nodeCount) * Math.PI * 2;
        const dist = 110 + (i % 2) * 30;
        const nx = gcx + dist * Math.cos(angle);
        const ny = gcy + dist * Math.sin(angle);
        const strength = rel.count / maxRel;
        const nodeR = 18 + strength * 16;
        // 엣지
        graphSvg += '<line x1="'+gcx+'" y1="'+gcy+'" x2="'+nx+'" y2="'+ny+'" stroke="'+rel.color+'" stroke-width="'+(1+strength*2.5)+'" opacity="'+(0.2+strength*0.4)+'" stroke-dasharray="'+(strength<0.3?'3,3':'none')+'"/>';
        // 노드
        graphSvg += '<circle cx="'+nx+'" cy="'+ny+'" r="'+nodeR+'" fill="'+rel.color+'" opacity="0.12" stroke="'+rel.color+'" stroke-width="1.5"/>';
        graphSvg += '<text x="'+nx+'" y="'+(ny-3)+'" text-anchor="middle" font-size="'+(nodeR>26?11:9)+'" font-weight="600" fill="var(--heading)">'+(rel.name.length>8?rel.name.substring(0,7)+'..':rel.name)+'</text>';
        graphSvg += '<text x="'+nx+'" y="'+(ny+10)+'" text-anchor="middle" font-size="9" fill="var(--text-secondary)">'+rel.count+'건</text>';
    });
    graphSvg += '</svg>';

    // 패널 본문 조립
    let html = '<div class="kg-graph-area">' + graphSvg + '</div>';

    // 통계 카드
    html += '<div class="kg-detail-grid">';
    if (stats.total !== undefined) html += '<div class="kg-detail-card"><div class="kg-label">총 사업 수</div><div class="kg-value">'+stats.total+'건</div></div>';
    if (stats.active !== undefined) html += '<div class="kg-detail-card"><div class="kg-label">진행중 사업</div><div class="kg-value" style="color:var(--success);">'+stats.active+'건</div></div>';
    if (stats.cats !== undefined) html += '<div class="kg-detail-card"><div class="kg-label">관련 분야</div><div class="kg-value">'+stats.cats+'개</div></div>';
    if (stats.orgs !== undefined) html += '<div class="kg-detail-card"><div class="kg-label">관련 기관</div><div class="kg-value">'+stats.orgs+'개</div></div>';
    if (stats.execs !== undefined) html += '<div class="kg-detail-card"><div class="kg-label">수행기관</div><div class="kg-value">'+stats.execs+'개</div></div>';
    html += '</div>';

    // 연관 항목 리스트
    if (related.length > 0) {
        html += '<div class="kg-related-list"><h4 style="font-size:13px;font-weight:700;color:var(--heading);margin-bottom:10px;"><i class="lucide-link"></i> 연관 항목 ('+related.length+'건)</h4>';
        related.forEach(rel => {
            const strength = rel.count / maxRel;
            html += '<div class="kg-related-item">' +
                '<div class="kg-related-dot" style="background:'+rel.color+';"></div>' +
                '<div class="kg-related-name">'+escHtml(rel.name)+'</div>' +
                '<div class="kg-related-meta">'+rel.type+' · '+rel.count+'건</div>' +
                '<div class="kg-strength-bar"><div class="kg-strength-fill" style="width:'+(strength*100)+'%;background:'+rel.color+';"></div></div>' +
            '</div>';
        });
        html += '</div>';
    }

    body.innerHTML = html;
    overlay.classList.add('show');
}

function closeKG() {
    document.getElementById('kgOverlay').classList.remove('show');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeKG(); });

// ===== Settings =====
function renderSettings() {
    const p = savedProfile || {};
    document.getElementById('page-content').innerHTML = `
        <div class="page-header"><h1><i class="lucide-settings"></i> 설정 - 지원대상 조건 설정</h1></div>
        <div class="card">
            <p style="color:var(--text-secondary);margin-bottom:16px;">
                소상공인 사업자 정보를 입력하여 맞춤형 지원사업 매칭을 받으세요.
            </p>
            <div class="profile-section">
                <h4><i class="lucide-clipboard-list"></i> 기본 정보</h4>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">프로필명 *</label>
                        <input class="form-control" id="pName" value="${escHtml(p.profile_name || '')}" placeholder="예: 내 음식점">
                    </div>
                    <div class="form-group">
                        <label class="form-label">사업자 유형 *</label>
                        <select class="form-control" id="pBizType">
                            ${['개인사업자','법인사업자','예비창업자'].map(t => `<option value="${t}" ${p.business_type===t?'selected':''}>${t}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">사업자등록번호</label>
                        <input class="form-control" id="pRegNo" value="${escHtml(p.business_registration_number || '')}">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">업종명 *</label>
                        <input class="form-control" id="pIndustry" value="${escHtml(p.industry_name || '')}" placeholder="예: 음식점업, IT서비스">
                    </div>
                    <div class="form-group">
                        <label class="form-label">업종코드 (선택)</label>
                        <input class="form-control" id="pIndCode" value="${escHtml(p.industry_code || '')}" placeholder="한국표준산업분류">
                    </div>
                    <div class="form-group">
                        <label class="form-label">설립일</label>
                        <input class="form-control" type="date" id="pEstDate" value="${p.establishment_date || ''}">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">사업장 소재지 (시/도) *</label>
                        <select class="form-control" id="pRegion">
                            ${REGION_FULL_NAMES.map(r => `<option value="${r}" ${p.region_sido===r?'selected':''}>${r}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">시/군/구</label>
                        <input class="form-control" id="pSigungu" value="${escHtml(p.region_sigungu || '')}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">대표자 연령</label>
                        <input class="form-control" type="number" id="pAge" value="${p.representative_age != null ? p.representative_age : ''}" min="15" max="100">
                    </div>
                </div>
            </div>
            <div class="profile-section">
                <h4><i class="lucide-bar-chart-2"></i> 규모 정보</h4>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">연매출 (만원)</label>
                        <input class="form-control" type="number" id="pRevenue" value="${p.annual_revenue != null ? Math.round(p.annual_revenue / 10000) : ''}" min="0">
                    </div>
                    <div class="form-group">
                        <label class="form-label">상시 종업원 수</label>
                        <input class="form-control" type="number" id="pEmpCount" value="${p.employee_count != null ? p.employee_count : ''}" min="0">
                    </div>
                    <div class="form-group">
                        <label class="form-label">업력 (년)</label>
                        <input class="form-control" type="number" id="pBizAge" value="${p.business_age_years != null ? p.business_age_years : ''}" min="0" step="0.5">
                    </div>
                </div>
            </div>
            <div class="profile-section">
                <h4><i class="lucide-wrench"></i> 확장 정보</h4>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">신용등급</label>
                        <select class="form-control" id="pCredit">
                            <option value="">선택</option>
                            ${[1,2,3,4,5,6,7,8,9,10].map(g => `<option value="${g}등급" ${p.credit_rating===g+'등급'?'selected':''}>${g}등급</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">부채비율 (%)</label>
                        <input class="form-control" type="number" id="pDebt" value="${p.debt_ratio != null ? p.debt_ratio : ''}" min="0" step="0.1">
                    </div>
                    <div class="form-group">
                        <label class="form-label">기존 수혜 건수</label>
                        <input class="form-control" type="number" id="pPrevCount" value="${p.previous_subsidy_count || 0}" min="0">
                    </div>
                </div>
                <div class="form-group" style="margin-top:12px;">
                    <label class="form-label">사업장 설명</label>
                    <textarea class="form-control" id="pBizDesc" rows="4" placeholder="사업장의 주요 업무, 제품/서비스, 기술 역량 등을 입력하세요. (선정확률 산출에 활용)" style="resize:vertical;min-height:80px;">${escHtml(p.business_description || '')}</textarea>
                    <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">입력된 내용에서 키워드를 추출하여 공고문과 매칭합니다.</div>
                </div>
                <div class="form-row" style="margin-top:12px;">
                    <div>
                        <div class="form-check"><input type="checkbox" id="pExport" ${p.has_export?'checked':''}><label for="pExport">수출 여부</label></div>
                        <div class="form-check"><input type="checkbox" id="pFemale" ${p.is_female_owned?'checked':''}><label for="pFemale">여성기업</label></div>
                        <div class="form-check"><input type="checkbox" id="pDisabled" ${p.is_disabled_owned?'checked':''}><label for="pDisabled">장애인기업</label></div>
                    </div>
                    <div>
                        <div class="form-check"><input type="checkbox" id="pSocial" ${p.is_social_enterprise?'checked':''}><label for="pSocial">사회적기업</label></div>
                        <div class="form-check"><input type="checkbox" id="pVenture" ${p.is_venture_certified?'checked':''}><label for="pVenture">벤처인증</label></div>
                        <div class="form-check"><input type="checkbox" id="pInnobiz" ${p.is_innobiz?'checked':''}><label for="pInnobiz">이노비즈(INNOBIZ)</label></div>
                    </div>
                    <div>
                        <div class="form-check"><input type="checkbox" id="pInsurance" ${p.has_employment_insurance!==false?'checked':''}><label for="pInsurance">고용보험 가입</label></div>
                    </div>
                </div>
            </div>
            <button class="btn btn-primary btn-lg btn-block" onclick="saveProfile()"><i class="lucide-save"></i> 프로필 저장</button>
        </div>
        <div class="card" style="margin-top:16px;">
            <div class="profile-section">
                <h4><i class="lucide-radio-tower"></i> 수집 설정</h4>
                <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">
                    대시보드의 <strong>수집하기</strong> 버튼을 클릭하면 주요 출처(기업마당, K-스타트업, 중소벤처24, 보조금24)에서 실시간으로 최신 데이터를 수집합니다.<br>
                    전체 37개 출처(부처·지자체 포함) 수집은 매일 오전 9시 자동으로 실행됩니다.
                </p>
                <div style="background:#f6ffed;border:1px solid #b7eb8f;border-radius:4px;padding:12px 16px;font-size:13px;color:#389e0d;">
                    ✅ 토큰 설정 없이 바로 사용할 수 있습니다.
                </div>
            </div>
        </div>
    `;
}

function saveProfile() {
    const rev = document.getElementById('pRevenue').value;
    savedProfile = {
        profile_name: document.getElementById('pName').value || '기본 프로필',
        business_type: document.getElementById('pBizType').value,
        business_registration_number: document.getElementById('pRegNo').value,
        industry_name: document.getElementById('pIndustry').value,
        industry_code: document.getElementById('pIndCode').value,
        establishment_date: document.getElementById('pEstDate').value,
        region_sido: document.getElementById('pRegion').value,
        region_sigungu: document.getElementById('pSigungu').value,
        representative_age: document.getElementById('pAge').value !== '' ? parseInt(document.getElementById('pAge').value) : null,
        annual_revenue: rev !== '' ? parseInt(rev) * 10000 : null,
        employee_count: document.getElementById('pEmpCount').value !== '' ? parseInt(document.getElementById('pEmpCount').value) : null,
        business_age_years: document.getElementById('pBizAge').value !== '' ? parseFloat(document.getElementById('pBizAge').value) : null,
        credit_rating: document.getElementById('pCredit').value,
        debt_ratio: document.getElementById('pDebt').value !== '' ? parseFloat(document.getElementById('pDebt').value) : null,
        previous_subsidy_count: document.getElementById('pPrevCount').value !== '' ? parseInt(document.getElementById('pPrevCount').value) : 0,
        business_description: document.getElementById('pBizDesc') ? document.getElementById('pBizDesc').value : '',
        has_export: document.getElementById('pExport').checked ? 1 : 0,
        is_female_owned: document.getElementById('pFemale').checked ? 1 : 0,
        is_disabled_owned: document.getElementById('pDisabled').checked ? 1 : 0,
        is_social_enterprise: document.getElementById('pSocial').checked ? 1 : 0,
        is_venture_certified: document.getElementById('pVenture').checked ? 1 : 0,
        is_innobiz: document.getElementById('pInnobiz').checked ? 1 : 0,
        has_employment_insurance: document.getElementById('pInsurance').checked ? 1 : 0,
    };
    localStorage.setItem('businessProfile', JSON.stringify(savedProfile));
    matchResults = []; // 프로필 변경 시 매칭 결과 초기화
    alert('프로필이 저장되었습니다!');
}

// Init — 인증 확인 후 데이터 로드
if (checkAuth()) {
    loadData();
}
