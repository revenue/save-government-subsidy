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
            `<div class="empty-state"><div class="icon">⚠️</div><p>데이터 로드 실패: ${e.message}</p></div>`;
    }
}

// 마감 데이터 표시 토글
function toggleExpired() {
    showExpired = !showExpired;
    subsidies = showExpired ? allSubsidies : allSubsidies.filter(s => !s.apply_end_date || s.apply_end_date >= today);
    navigateTo(currentPage);
}

// 수집하기 — GitHub Actions 워크플로우 트리거
async function triggerCollection() {
    if (isCollecting) return;
    isCollecting = true;
    const btn = document.getElementById('collectBtn');
    if (btn) { btn.disabled = true; btn.textContent = '수집 중...'; }

    try {
        // GitHub Actions workflow dispatch (GITHUB_TOKEN 필요)
        const token = localStorage.getItem('github_token');
        if (!token) {
            alert('설정에서 GitHub Token을 등록해주세요.\\n(repo 권한의 Personal Access Token 필요)');
            isCollecting = false;
            if (btn) { btn.disabled = false; btn.textContent = '🔄 수집하기'; }
            return;
        }
        const resp = await fetch('https://api.github.com/repos/revenue/save-gov-subsidy-v2/dispatches', {
            method: 'POST',
            headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' },
            body: JSON.stringify({ event_type: 'manual_collect' }),
        });
        if (resp.ok || resp.status === 204) {
            alert('수집이 시작되었습니다!\\n완료까지 약 5~10분 소요됩니다.\\n완료 후 페이지를 새로고침 해주세요.');
        } else {
            alert('수집 실행 실패: ' + resp.status + '\\n토큰 권한을 확인해주세요.');
        }
    } catch (e) {
        alert('수집 요청 실패: ' + e.message);
    } finally {
        isCollecting = false;
        if (btn) { btn.disabled = false; btn.textContent = '🔄 수집하기'; }
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
            <h1>📊 대시보드</h1>
        </div>
        <!-- 수집 정보 배너 -->
        <div class="card" style="background:linear-gradient(135deg,#e6f7ff,#f0f7ff);border-color:#91d5ff;padding:16px 24px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
            <div>
                <div style="font-size:14px;color:var(--ant-heading);font-weight:500;">📡 데이터 수집 현황</div>
                <div style="font-size:13px;color:var(--ant-text-secondary);margin-top:4px;">
                    마지막 수집: <strong>${escHtml(lastCollected)}</strong> ·
                    마지막 갱신: <strong>${escHtml(lastUpdated)}</strong> ·
                    출처: 기업마당 ${meta.sources?.bizinfo || 0} · 중소벤처기업부 ${meta.sources?.mss || 0} · 중소벤처24 ${meta.sources?.smes || 0} · K-스타트업 ${meta.sources?.kstartup || 0}
                </div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
                <label style="font-size:13px;display:flex;align-items:center;gap:4px;cursor:pointer;">
                    <input type="checkbox" ${showExpired?'checked':''} onchange="toggleExpired()"> 마감 포함 (${expiredCount}건)
                </label>
                <button class="btn btn-primary" id="collectBtn" onclick="triggerCollection()">🔄 수집하기</button>
            </div>
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
        <div class="page-header"><h1>📋 지원사업 목록</h1></div>
        <div class="search-box">
            <select class="form-control" id="listCat" onchange="filterList()">
                <option value="">전체 분야</option>
                ${cats.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
            <select class="form-control" id="listStatus" onchange="filterList()">
                <option value="">전체 상태</option>
                <option value="active">진행중</option>
                <option value="expired">마감</option>
            </select>
            <input class="form-control" id="listKeyword" placeholder="사업명, 기관명 검색..." onkeyup="filterList()" style="flex:1;max-width:400px;">
        </div>
        <div id="listCount" style="margin-bottom:8px;font-size:14px;color:var(--ant-text-secondary);"></div>
        <div class="table-container" id="listTable"></div>
    `;
    filterList();
}

function filterList() {
    const cat = document.getElementById('listCat').value;
    const status = document.getElementById('listStatus').value;
    const kw = document.getElementById('listKeyword').value.toLowerCase();

    let filtered = subsidies.filter(s => {
        if (cat && s.category !== cat) return false;
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
            <thead><tr><th style="width:60px">상태</th><th>사업명</th><th>분야</th><th>소관기관</th><th>신청시작</th><th>마감일</th></tr></thead>
            <tbody>
                ${shown.map(s => {
                    const st = getStatus(s.apply_end_date);
                    return `<tr onclick="showDetail(${s.id})">
                        <td><span class="tag ${st.cls}">${st.text}</span></td>
                        <td title="${escHtml(s.title)}">${escHtml(s.title).slice(0, 55)}</td>
                        <td>${escHtml(s.category)}</td>
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
            <div class="detail-label">분야</div><div class="detail-value">${escHtml(s.category)}</div>
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
            <div class="page-header"><h1>🎯 맞춤 매칭 - 선정확률 분석</h1></div>
            <div class="empty-state">
                <div class="icon">⚙️</div>
                <p>사업자 프로필이 없습니다.</p>
                <p style="margin-top:8px;">먼저 <strong>⚙️ 설정</strong> 메뉴에서 '지원대상 조건 설정'을 등록해주세요.</p>
                <button class="btn btn-primary" style="margin-top:16px;" onclick="navigateTo('settings')">설정으로 이동</button>
            </div>`;
        return;
    }

    const cats = [...new Set(subsidies.map(s => s.category).filter(Boolean))].sort();
    const p = savedProfile;
    const rev = p.annual_revenue ? `${(p.annual_revenue / 10000).toLocaleString()}만원` : '-';

    document.getElementById('page-content').innerHTML = `
        <div class="page-header"><h1>🎯 맞춤 매칭 - 선정확률 분석</h1></div>
        <div class="card">
            <div class="card-title">📋 선택된 프로필: ${escHtml(p.profile_name || '기본 프로필')}</div>
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
            <select class="form-control" id="matchCat" style="max-width:200px;">
                <option value="">전체 분야</option>
                ${cats.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
            <label style="font-size:14px;">최소 확률:</label>
            <input type="range" id="matchMin" min="0" max="50" value="10" style="width:120px;"
                   oninput="document.getElementById('matchMinVal').textContent=this.value+'%'">
            <span id="matchMinVal" style="font-size:14px;">10%</span>
            <button class="btn btn-primary btn-lg" onclick="runMatching()">🎯 맞춤 매칭 실행</button>
        </div>
        <div id="matchResults"></div>
    `;

    if (matchResults.length) renderMatchResults();
}

function runMatching() {
    const cat = document.getElementById('matchCat').value;
    const minProb = parseInt(document.getElementById('matchMin').value);
    const target = subsidies.filter(s => {
        if (cat && s.category !== cat) return false;
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
        document.getElementById('matchResults').innerHTML = '<div class="empty-state"><div class="icon">📋</div><p>매칭 결과가 없습니다.</p></div>';
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

    matchResults.slice(0, 30).forEach((r, i) => {
        const level = r.final_probability >= 70 ? 'high' : r.final_probability >= 40 ? 'medium' : 'low';
        const scoreColor = { high: '#52c41a', medium: '#faad14', low: '#ff4d4f' }[level];
        const d = r.matching_details || {};
        html += `
        <div class="match-card ${level}">
            <div class="match-header">
                <div>
                    <div class="match-title">#${i + 1}. ${escHtml(r.subsidy_title).slice(0, 60)}</div>
                    <div class="match-meta">
                        ${escHtml(r.category)} · ${escHtml(r.organization)} · 마감: ${r.apply_end_date || '-'}
                        · 신뢰도: ${r.confidence_level}
                    </div>
                </div>
                <div class="match-prob ${level}">${r.final_probability.toFixed(0)}%</div>
            </div>
            <div style="margin-top:8px;">
                <button class="btn" onclick="this.nextElementSibling.classList.toggle('show');this.textContent=this.textContent==='상세 분석 ▼'?'접기 ▲':'상세 분석 ▼'">상세 분석 ▼</button>
                <div class="match-details">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
                        <div>
                            <strong>점수 분석</strong>
                            ${[['자격요건 적합도', r.eligibility_score], ['조건 매칭도', r.matching_score],
                               ['경쟁률 점수', r.competition_score], ['이력 기반 점수', r.historical_score]]
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
                            ${Object.entries({업종: d.industry_match, 규모: d.scale_match, 목적: d.purpose_match, 지역: d.region_match, 자격: d.qualification_match})
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
        <div class="page-header"><h1>🔍 상세 검색</h1></div>
        <div class="card">
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">키워드 (제목/내용/HWP 검색)</label>
                    <input class="form-control" id="srchKw" placeholder="검색어 입력">
                </div>
                <div class="form-group">
                    <label class="form-label">분야</label>
                    <select class="form-control" id="srchCat">
                        <option value="">전체</option>
                        ${cats.map(c => `<option value="${c}">${c}</option>`).join('')}
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

function doSearch() {
    const kw = document.getElementById('srchKw').value.toLowerCase();
    const cat = document.getElementById('srchCat').value;
    const status = document.getElementById('srchStatus').value;

    const results = subsidies.filter(s => {
        if (cat && s.category !== cat) return false;
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
    const catCounts = {};
    subsidies.forEach(s => { catCounts[s.category] = (catCounts[s.category] || 0) + 1; });
    const cats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
    const maxCat = Math.max(...cats.map(c => c[1]), 1);

    const histByCat = {};
    history.forEach(h => {
        if (!histByCat[h.program_category]) histByCat[h.program_category] = [];
        histByCat[h.program_category].push(h);
    });
    const catRates = Object.entries(histByCat).map(([cat, recs]) => ({
        cat, rate: recs.reduce((s, r) => s + (r.selection_rate || 0), 0) / recs.length,
    })).sort((a, b) => b.rate - a.rate);
    const maxRate = Math.max(...catRates.map(c => c.rate), 1);

    document.getElementById('page-content').innerHTML = `
        <div class="page-header"><h1>📈 통계 분석</h1></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
            <div class="card">
                <div class="card-title">분야별 지원사업 현황</div>
                ${cats.map(([c, n]) => `
                    <div class="score-row">
                        <span class="score-label">${escHtml(c)}</span>
                        <div class="score-bar"><div class="score-fill" style="width:${n/maxCat*100}%;background:#1890ff;"></div></div>
                        <span class="score-value">${n}건</span>
                    </div>
                `).join('')}
            </div>
            <div class="card">
                <div class="card-title">분야별 평균 선정률</div>
                ${catRates.map(({cat, rate}) => `
                    <div class="score-row">
                        <span class="score-label">${escHtml(cat)}</span>
                        <div class="score-bar"><div class="score-fill" style="width:${rate}%;background:${rate>=60?'#52c41a':rate>=30?'#faad14':'#ff4d4f'};"></div></div>
                        <span class="score-value">${rate.toFixed(1)}%</span>
                    </div>
                `).join('')}
            </div>
        </div>
        <div class="card" style="margin-top:16px;">
            <div class="card-title">선정 이력 상세</div>
            <div class="table-container">
                <table class="data-table">
                    <thead><tr><th>프로그램명</th><th>분야</th><th>연도</th><th>총 신청</th><th>선정</th><th>선정률</th></tr></thead>
                    <tbody>
                        ${history.map(h => `<tr>
                            <td>${escHtml(h.program_name)}</td>
                            <td>${escHtml(h.program_category)}</td>
                            <td>${h.fiscal_year}</td>
                            <td>${(h.total_applications||0).toLocaleString()}</td>
                            <td>${(h.total_selected||0).toLocaleString()}</td>
                            <td><strong>${(h.selection_rate||0).toFixed(1)}%</strong></td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

// ===== Settings =====
function renderSettings() {
    const p = savedProfile || {};
    document.getElementById('page-content').innerHTML = `
        <div class="page-header"><h1>⚙️ 설정 - 지원대상 조건 설정</h1></div>
        <div class="card">
            <p style="color:var(--ant-text-secondary);margin-bottom:16px;">
                소상공인 사업자 정보를 입력하여 맞춤형 지원사업 매칭을 받으세요.
            </p>
            <div class="profile-section">
                <h4>📋 기본 정보</h4>
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
                            ${REGIONS.map(r => `<option value="${r}" ${p.region_sido===r?'selected':''}>${r}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">시/군/구</label>
                        <input class="form-control" id="pSigungu" value="${escHtml(p.region_sigungu || '')}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">대표자 연령</label>
                        <input class="form-control" type="number" id="pAge" value="${p.representative_age || ''}" min="15" max="100">
                    </div>
                </div>
            </div>
            <div class="profile-section">
                <h4>📊 규모 정보</h4>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">연매출 (만원)</label>
                        <input class="form-control" type="number" id="pRevenue" value="${p.annual_revenue ? Math.round(p.annual_revenue / 10000) : ''}" min="0">
                    </div>
                    <div class="form-group">
                        <label class="form-label">상시 종업원 수</label>
                        <input class="form-control" type="number" id="pEmpCount" value="${p.employee_count || ''}" min="0">
                    </div>
                    <div class="form-group">
                        <label class="form-label">업력 (년)</label>
                        <input class="form-control" type="number" id="pBizAge" value="${p.business_age_years || ''}" min="0" step="0.5">
                    </div>
                </div>
            </div>
            <div class="profile-section">
                <h4>🔧 확장 정보</h4>
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
                        <input class="form-control" type="number" id="pDebt" value="${p.debt_ratio || ''}" min="0" step="0.1">
                    </div>
                    <div class="form-group">
                        <label class="form-label">기존 수혜 건수</label>
                        <input class="form-control" type="number" id="pPrevCount" value="${p.previous_subsidy_count || 0}" min="0">
                    </div>
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
            <button class="btn btn-primary btn-lg btn-block" onclick="saveProfile()">💾 프로필 저장</button>
        </div>
        <div class="card" style="margin-top:16px;">
            <div class="profile-section">
                <h4>🔑 수집 설정 (GitHub Token)</h4>
                <p style="font-size:13px;color:var(--ant-text-secondary);margin-bottom:12px;">
                    수집하기 버튼 사용을 위해 GitHub Personal Access Token이 필요합니다.<br>
                    <a href="https://github.com/settings/tokens" target="_blank">GitHub → Settings → Developer settings → Personal access tokens</a>에서 repo 권한으로 생성하세요.
                </p>
                <div class="form-group">
                    <label class="form-label">GitHub Token</label>
                    <input class="form-control" id="pGhToken" type="password" value="${localStorage.getItem('github_token') || ''}" placeholder="ghp_xxxxxxxxxxxx">
                </div>
                <button class="btn" onclick="localStorage.setItem('github_token', document.getElementById('pGhToken').value); alert('토큰이 저장되었습니다.');">🔑 토큰 저장</button>
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
        representative_age: parseInt(document.getElementById('pAge').value) || null,
        annual_revenue: rev ? parseInt(rev) * 10000 : null,
        employee_count: parseInt(document.getElementById('pEmpCount').value) || null,
        business_age_years: parseFloat(document.getElementById('pBizAge').value) || null,
        credit_rating: document.getElementById('pCredit').value,
        debt_ratio: parseFloat(document.getElementById('pDebt').value) || null,
        previous_subsidy_count: parseInt(document.getElementById('pPrevCount').value) || 0,
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
