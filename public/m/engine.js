/**
 * 선정확률 엔진 v2.0
 * 소상공인 맞춤형 정부지원사업 매칭 및 선정확률 계산
 *
 * 개선사항:
 *  - 이력데이터 부재 시 카테고리별 통계적 기본 경쟁률 적용
 *  - 공고 데이터 풍부도(data completeness)에 따른 신뢰도 가중치
 *  - 정규화 수식 개선으로 5~95% 범위에 걸친 실질적 분포 생성
 *  - 타이틀 키워드 분석 기반 세밀한 매칭
 *
 * 5단계 알고리즘:
 *  1. 자격요건 필터링 (Eligibility Screening)
 *  2. 조건 매칭 점수 (Weighted Scoring)
 *  3. 경쟁률 기반 조정 (Competition Adjustment)
 *  4. 이력 기반 보정 (Historical Calibration)
 *  5. 최종 확률 산출 (Bayesian Integration)
 */

const INDUSTRY_CATEGORIES = {
    '음식점업': ['음식', '식당', '카페', '커피', '베이커리', '외식', '배달'],
    '소매업': ['소매', '판매', '유통', '마트', '편의점', '상점'],
    '서비스업': ['서비스', '용역', '컨설팅', '교육', '미용', '세탁'],
    '제조업': ['제조', '생산', '공장', '가공', '조립'],
    'IT서비스': ['IT', '소프트웨어', 'SW', '앱', '플랫폼', '디지털', 'AI', '데이터'],
    '숙박업': ['숙박', '호텔', '펜션', '모텔'],
    '건설업': ['건설', '건축', '인테리어', '시공'],
    '운수업': ['운수', '운송', '택배', '물류', '화물'],
    '도매업': ['도매', '무역', '수입', '수출'],
    '바이오': ['바이오', '의료', '제약', '헬스케어'],
    '콘텐츠': ['콘텐츠', '미디어', '영상', '게임', '엔터'],
    '농림어업': ['농업', '임업', '어업', '축산'],
};

const REGIONS = ['서울','경기','인천','부산','대구','대전','광주','울산','세종',
                 '강원','충북','충남','전북','전남','경북','경남','제주'];

// 카테고리별 통계적 기본 경쟁률 (공공데이터 기반 추정치)
const DEFAULT_CATEGORY_RATES = {
    '금융': 35, '기술': 25, '창업': 20, '수출': 40,
    '인력': 45, '경영': 38, '내수': 42, '정책': 30,
    '기타': 33, '에너지': 28, '환경': 30, '문화': 22,
};

class ProbabilityEngine {
    constructor(history = []) {
        this.history = history;
        this.historyByCategory = {};
        this.avgRateByCategory = {};
        this._buildIndex();
    }

    _buildIndex() {
        for (const r of this.history) {
            const cat = r.program_category || '기타';
            if (!this.historyByCategory[cat]) this.historyByCategory[cat] = [];
            this.historyByCategory[cat].push(r);
        }
        for (const [cat, records] of Object.entries(this.historyByCategory)) {
            const rates = records.filter(r => r.selection_rate).map(r => r.selection_rate);
            this.avgRateByCategory[cat] = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : (DEFAULT_CATEGORY_RATES[cat] || 33);
        }
    }

    calculate(subsidy, profile) {
        const eligibility = this._checkEligibility(subsidy, profile);
        const matching = this._calcMatching(subsidy, profile);
        const competition = this._calcCompetition(subsidy);
        const historical = this._calcHistorical(subsidy, profile);
        const dataQuality = this._dataQuality(subsidy, profile);
        const final = this._integrate(eligibility, matching, competition, historical, subsidy, dataQuality);
        const confidence = this._confidence(subsidy, profile);
        const recommendations = this._recommend(subsidy, profile, eligibility, matching);

        return {
            subsidy_id: subsidy.id,
            subsidy_title: subsidy.title,
            category: subsidy.category,
            organization: subsidy.organization,
            apply_end_date: subsidy.apply_end_date,
            eligibility_score: Math.round(eligibility.score * 10) / 10,
            matching_score: Math.round(matching.score * 10) / 10,
            competition_score: Math.round(competition.score * 10) / 10,
            historical_score: Math.round(historical.score * 10) / 10,
            final_probability: Math.round(final * 10) / 10,
            confidence_level: confidence,
            recommendations,
            matching_details: matching.details || {},
            disqualified: eligibility.disqualified,
        };
    }

    calculateAll(subsidies, profile, minProb = 0) {
        return subsidies
            .map(s => { try { return this.calculate(s, profile); } catch(e) { return null; } })
            .filter(r => r && r.final_probability >= minProb)
            .sort((a, b) => b.final_probability - a.final_probability);
    }

    // === 데이터 풍부도 평가 ===
    _dataQuality(sub, prof) {
        const sFields = ['description','detail_content','hwp_content','target','region',
                         'support_amount','eligibility_keywords','business_type_required',
                         'industry_required','employee_range','revenue_range','region_required'];
        const sScore = sFields.filter(f => sub[f] && sub[f] !== '').length / sFields.length;
        const pFields = ['business_type','industry_name','annual_revenue','employee_count',
                         'region_sido','business_age_years','credit_rating'];
        const pScore = pFields.filter(f => prof[f] != null && prof[f] !== '').length / pFields.length;
        // 0 ~ 1 사이, 높을수록 풍부
        return (sScore * 0.6 + pScore * 0.4);
    }

    // 1단계: 자격요건
    _checkEligibility(sub, prof) {
        const checks = [
            ['region', this._chkRegion(sub, prof), 15],
            ['industry', this._chkIndustry(sub, prof), 20],
            ['business_type', this._chkBizType(sub, prof), 15],
            ['revenue', this._chkRevenue(sub, prof), 15],
            ['employee', this._chkEmployee(sub, prof), 10],
            ['business_age', this._chkAge(sub, prof), 10],
            ['special', this._chkSpecial(sub, prof), 15],
        ];
        const totalW = checks.reduce((s, c) => s + c[2], 0);
        const wSum = checks.reduce((s, c) => s + c[1] * c[2], 0);
        let score = totalW > 0 ? wSum / totalW : 0;
        const disqualified = checks.some(c => c[1] === 0 && c[2] >= 15 && ['region','industry','business_type'].includes(c[0]));
        if (disqualified) score = Math.min(score, 15);
        return { score, disqualified, checks: Object.fromEntries(checks.map(c => [c[0], {score: c[1], weight: c[2]}])) };
    }

    _chkRegion(sub, prof) {
        const req = sub.region_required || sub.region || '';
        const user = prof.region_sido || '';
        if (!req || ['전국','해당없음','-',''].includes(req)) return 80; // 전국 → 약간 유리하지만 지역특화보다 낮음
        if (user && (req.includes(user) || user.includes(req))) return 100;
        if (req.includes(',') || req.includes('·') || req.includes('/')) {
            const regions = req.split(/[,·/\s]+/);
            if (regions.some(r => user && (r.trim().includes(user) || user.includes(r.trim())))) return 100;
        }
        return user ? 0 : 30;
    }

    _chkIndustry(sub, prof) {
        const req = sub.industry_required || '';
        const user = prof.industry_name || '';
        // 공고에 업종제한 정보가 없는 경우 → 타이틀 기반 추정
        if (!req || ['전체','전업종','해당없음','-',''].includes(req)) {
            // 타이틀에서 업종 힌트 탐색
            const titleText = `${sub.title||''} ${sub.target||''}`;
            const uCats = this._getIndustryCats(user);
            const tCats = this._getIndustryCats(titleText);
            if (uCats.length > 0 && tCats.length > 0) {
                return uCats.some(c => tCats.includes(c)) ? 95 : 55;
            }
            return 65; // 정보 없으면 중립보다 약간 위
        }
        const text = `${req} ${sub.target||''} ${sub.title||''}`;
        if (user && text.includes(user)) return 100;
        const uCats = this._getIndustryCats(user);
        const rCats = this._getIndustryCats(text);
        if (uCats.some(c => rCats.includes(c))) return 85;
        if (text.includes('소상공인') || text.includes('소기업')) return 70;
        return 30;
    }

    _chkBizType(sub, prof) {
        const user = prof.business_type || '';
        const text = `${sub.target||''} ${sub.title||''} ${sub.description||''}`;
        if (!user) return 40;
        const types = {'개인사업자': ['개인'], '법인사업자': ['법인','주식회사'], '예비창업자': ['예비','창업예정']};
        for (const [t, kws] of Object.entries(types)) {
            if (kws.some(k => user.includes(k))) {
                if (text.includes(t + ' 제외') || text.includes(t + '제외')) return 0;
                if (kws.some(k => text.includes(k))) return 100;
            }
        }
        // 타이틀 키워드 기반 추가 분석
        if (user.includes('개인') && text.includes('소상공인')) return 85;
        if (user.includes('법인') && (text.includes('중소기업') || text.includes('중견기업'))) return 80;
        if (user.includes('예비') && text.includes('창업')) return 90;
        return 50;
    }

    _chkRevenue(sub, prof) {
        const rev = prof.annual_revenue;
        const text = `${sub.revenue_range||''} ${sub.target||''} ${sub.description||''}`;
        if (!sub.revenue_range || ['해당없음','-',''].includes(sub.revenue_range)) {
            // 매출 조건이 없어도 타이틀 힌트 활용
            const title = sub.title || '';
            if (rev != null) {
                if (title.includes('소상공인') && rev <= 5e9) return 85;
                if (title.includes('소기업') && rev <= 12e9) return 80;
                if (title.includes('중소기업') && rev <= 150e9) return 80;
            }
            return 60; // 정보 없으면 중립
        }
        if (rev == null) return 40;
        if (text.includes('소상공인')) return rev <= 12e9 ? 95 : 20;
        if (text.includes('소기업')) return rev <= 12e9 ? 90 : rev <= 30e9 ? 60 : 20;
        if (text.includes('중소기업')) return rev <= 150e9 ? 90 : 30;
        return 60;
    }

    _chkEmployee(sub, prof) {
        const cnt = prof.employee_count;
        const text = `${sub.employee_range||''} ${sub.target||''}`;
        if (!sub.employee_range || ['해당없음','-',''].includes(sub.employee_range)) {
            if (cnt != null) {
                const title = sub.title || '';
                if (title.includes('소상공인') && cnt < 10) return 85;
                if (title.includes('소기업') && cnt < 50) return 80;
            }
            return 60;
        }
        if (cnt == null) return 40;
        if (text.includes('소상공인')) return cnt < 10 ? 95 : cnt < 50 ? 50 : 20;
        if (text.includes('소기업')) return cnt < 50 ? 90 : 30;
        return 65;
    }

    _chkAge(sub, prof) {
        let age = prof.business_age_years;
        const text = `${sub.business_age_range||''} ${sub.target||''} ${sub.title||''}`;
        if (age == null) return 40;
        if (text.includes('예비창업')) return age < 0.5 ? 100 : age < 1 ? 50 : 5;
        if (text.includes('초기창업') || text.includes('3년 이내') || text.includes('3년이내'))
            return age <= 3 ? 100 : age <= 5 ? 40 : 10;
        if (text.includes('7년 이내') || text.includes('7년이내'))
            return age <= 7 ? 100 : age <= 10 ? 50 : 20;
        // 일반 공고 - 업력별 차등
        if (age <= 3) return 70; // 신생기업은 창업 외 일반공고에서 약간 불리
        if (age <= 7) return 80;
        return 75;
    }

    _chkSpecial(sub, prof) {
        let score = 50; // 기본값을 50으로 낮춤 (70 → 50)
        const text = `${sub.target||''} ${sub.title||''} ${sub.special_conditions||''} ${sub.description||''}`;
        if (text.includes('여성') && prof.is_female_owned) score += 25;
        if (text.includes('장애인') && prof.is_disabled_owned) score += 25;
        if (text.includes('사회적기업') && prof.is_social_enterprise) score += 20;
        if ((text.includes('벤처') || text.includes('혁신')) && prof.is_venture_certified) score += 20;
        if (text.includes('이노비즈') && prof.is_innobiz) score += 15;
        if (text.includes('수출') && prof.has_export) score += 15;
        if (text.includes('고용보험') && !prof.has_employment_insurance) score -= 25;
        if ((prof.previous_subsidy_count || 0) > 3) score -= 15;
        // 여성/장애인 한정 공고인데 해당 안 되면 큰 감점
        if (text.includes('여성기업') && !prof.is_female_owned) score -= 20;
        if (text.includes('장애인기업') && !prof.is_disabled_owned) score -= 20;
        return Math.max(0, Math.min(100, score));
    }

    // 2단계: 매칭
    _calcMatching(sub, prof) {
        const text = [sub.title, sub.description, sub.detail_content, sub.hwp_content, sub.target, sub.eligibility_keywords]
            .filter(Boolean).join(' ');
        const details = {
            industry_match: this._matchIndustry(text, prof),
            scale_match: this._matchScale(text, prof),
            region_match: this._matchRegion(text, prof),
            purpose_match: this._matchPurpose(sub, prof),
            qualification_match: this._matchQual(text, prof),
        };
        const weights = { industry_match: 0.30, scale_match: 0.20, purpose_match: 0.25, region_match: 0.10, qualification_match: 0.15 };
        const score = Object.entries(weights).reduce((s, [k, w]) => s + (details[k] || 0) * w, 0);
        return { score, details };
    }

    _matchIndustry(text, prof) {
        const user = prof.industry_name || '';
        if (!user) return 35;
        if (text.includes(user)) return 100;
        const uC = this._getIndustryCats(user), tC = this._getIndustryCats(text);
        if (uC.some(c => tC.includes(c))) return 80;
        if (text.includes('전업종') || text.includes('업종무관')) return 65;
        if (text.includes('소상공인')) return 60;
        // 완전 무관한 업종
        if (tC.length > 0 && uC.length > 0 && !uC.some(c => tC.includes(c))) return 15;
        return 35;
    }

    _matchScale(text, prof) {
        const rev = prof.annual_revenue || 0, emp = prof.employee_count || 0;
        if (!rev && !emp) return 40;
        if (text.includes('소상공인')) return (rev <= 1e9 && emp < 5) ? 95 : (rev <= 5e9 && emp < 10) ? 75 : 30;
        if (text.includes('소기업')) return (rev <= 5e9 && emp < 50) ? 85 : 45;
        if (text.includes('중소기업')) return rev <= 30e9 ? 80 : 35;
        if (text.includes('중견기업') || text.includes('대기업')) return rev >= 30e9 ? 70 : 25;
        return 55;
    }

    _matchRegion(text, prof) {
        const user = prof.region_sido || '';
        if (!user) return 40;
        if (text.includes('전국') || !REGIONS.some(r => text.includes(r))) return 70;
        return REGIONS.some(r => text.includes(r) && user.includes(r)) ? 100 : 20;
    }

    _matchPurpose(sub, prof) {
        const cat = sub.category || '';
        const age = prof.business_age_years;
        const title = sub.title || '';

        // 타이틀 키워드 기반 정밀 매칭
        const userInd = prof.industry_name || '';
        const titleCats = this._getIndustryCats(title);
        const userCats = this._getIndustryCats(userInd);
        let titleBonus = 0;
        if (titleCats.length > 0 && userCats.length > 0) {
            titleBonus = titleCats.some(c => userCats.includes(c)) ? 15 : -10;
        }

        let base = 50;
        if (cat === '창업') base = age != null && age <= 3 ? 90 : age != null && age <= 7 ? 50 : 15;
        else if (cat === '수출') base = prof.has_export ? 90 : 25;
        else if (cat === '기술') {
            const techKws = ['IT', '소프트웨어', '바이오', '제조'];
            if (techKws.some(k => userInd.includes(k))) base = 85;
            else if (prof.is_venture_certified || prof.is_innobiz) base = 75;
            else base = 35;
        }
        else if (cat === '금융') base = 65;
        else if (cat === '인력') base = (prof.employee_count || 0) >= 1 ? 75 : 40;
        else if (cat === '경영') base = 60;
        else if (cat === '내수') base = 55;
        else if (cat === '정책') base = 50;
        else base = 45;

        return Math.max(5, Math.min(100, base + titleBonus));
    }

    _matchQual(text, prof) {
        let score = 45; // 기본 45로 낮춤
        if (prof.is_venture_certified && text.includes('벤처')) score += 20;
        if (prof.is_social_enterprise && text.includes('사회적')) score += 15;
        if (prof.technology_grade && (text.includes('기술') || text.includes('R&D'))) score += 15;
        if (prof.has_employment_insurance) score += 5;
        // 해당 자격이 없으면 감점
        if (!prof.is_venture_certified && text.includes('벤처기업')) score -= 15;
        if (!prof.is_social_enterprise && text.includes('사회적기업')) score -= 15;
        return Math.min(100, Math.max(5, score));
    }

    // 3단계: 경쟁률 (이력 없을 때 카테고리 기반 기본 경쟁률 적용)
    _calcCompetition(sub) {
        const cat = sub.category || '기타';
        const rate = this.avgRateByCategory[cat] || DEFAULT_CATEGORY_RATES[cat] || 33;

        // 공고 특성 기반 경쟁률 조정
        let adjusted = rate;
        const title = sub.title || '';
        // 전국 공고는 경쟁 치열
        if (!sub.region || sub.region === '전국') adjusted *= 0.85;
        // 특수 대상 한정 공고는 경쟁 완화
        if (title.includes('여성') || title.includes('장애인')) adjusted *= 1.2;
        if (title.includes('청년') || title.includes('시니어')) adjusted *= 1.1;
        // 마감 임박 공고는 지원자 적어 경쟁 완화
        if (sub.apply_end_date) {
            const days = Math.ceil((new Date(sub.apply_end_date) - new Date()) / 86400000);
            if (days >= 0 && days <= 3) adjusted *= 1.3;
            else if (days <= 7) adjusted *= 1.1;
        }

        adjusted = Math.max(10, Math.min(80, adjusted));
        // 로지스틱 함수로 0-100 스케일 변환
        const score = 100 / (1 + Math.exp(-0.08 * (adjusted - 33)));
        return { score: Math.round(score * 10) / 10, selection_rate: Math.round(adjusted * 10) / 10 };
    }

    // 4단계: 이력 (데이터 없을 때 프로필-공고 적합도 추정)
    _calcHistorical(sub, prof) {
        const cat = sub.category || '기타';
        const records = this.historyByCategory[cat] || [];

        if (!records.length) {
            // 이력 데이터가 없으므로 프로필 완성도 + 카테고리 친화도로 대체
            let score = 40; // 기본 불확실
            // 프로필이 풍부할수록 점수 상승
            if (prof.business_type) score += 5;
            if (prof.industry_name) score += 8;
            if (prof.annual_revenue) score += 7;
            if (prof.employee_count) score += 5;
            if (prof.region_sido) score += 5;
            if (prof.business_age_years != null) score += 5;

            // 카테고리-프로필 친화도
            const userCats = this._getIndustryCats(prof.industry_name || '');
            const titleCats = this._getIndustryCats(sub.title || '');
            if (userCats.length > 0 && titleCats.length > 0) {
                score += userCats.some(c => titleCats.includes(c)) ? 12 : -8;
            }

            return { score: Math.max(10, Math.min(85, score)), factors: {} };
        }

        const factors = {};
        const age = prof.business_age_years;
        const avgAge = records.reduce((s, r) => s + (r.avg_company_age || 5), 0) / records.length;
        factors.age_fit = age != null ? Math.max(0, 100 - Math.abs(age - avgAge) * 10) : 40;

        const emp = prof.employee_count;
        const avgEmp = records.reduce((s, r) => s + (r.avg_employee_count || 5), 0) / records.length;
        factors.employee_fit = emp != null ? Math.max(0, 100 - Math.abs(1 - (emp / (avgEmp || 1))) * 50) : 40;

        const rev = prof.annual_revenue;
        const avgRev = records.reduce((s, r) => s + (r.avg_revenue || 0), 0) / records.length;
        factors.revenue_fit = (rev && avgRev) ? Math.max(0, 100 - Math.abs(1 - (rev / avgRev)) * 30) : 40;

        const user_ind = prof.industry_name || '';
        let indMatch = 0;
        for (const r of records) {
            let top = r.top_industries || '[]';
            try { top = typeof top === 'string' ? JSON.parse(top) : top; } catch { top = []; }
            if (top.some(i => user_ind && (user_ind.includes(i) || i.includes(user_ind)))) indMatch++;
        }
        factors.industry_fit = Math.min(100, (indMatch / Math.max(1, records.length)) * 100 + 20);

        const user_reg = prof.region_sido || '';
        let regMatch = 0;
        for (const r of records) {
            let top = r.top_regions || '[]';
            try { top = typeof top === 'string' ? JSON.parse(top) : top; } catch { top = []; }
            if (top.some(rg => user_reg && (user_reg.includes(rg) || rg.includes(user_reg)))) regMatch++;
        }
        factors.region_fit = Math.min(100, (regMatch / Math.max(1, records.length)) * 100 + 15);

        const weights = { age_fit: 0.15, employee_fit: 0.15, revenue_fit: 0.20, industry_fit: 0.30, region_fit: 0.20 };
        const score = Object.entries(weights).reduce((s, [k, w]) => s + (factors[k] || 40) * w, 0);
        return { score, factors };
    }

    // 5단계: 통합 (v2 - 넓은 분포 생성)
    _integrate(elig, match, comp, hist, sub, dataQuality) {
        if (elig.disqualified) return Math.max(5, elig.score * 0.2);

        const cat = sub.category || '기타';
        const w = this._catWeights(cat);

        // 가중합산 (각 점수 0-100)
        const raw = elig.score * w.eligibility
                   + match.score * w.matching
                   + comp.score * w.competition
                   + hist.score * w.historical;

        // 데이터 풍부도 보정
        const uncertainty = 1 - dataQuality;

        // 카테고리 기반 기본 선정률을 중앙 기준으로 사용
        const baseRate = DEFAULT_CATEGORY_RATES[cat] || 33;

        // Quantile rank stretching
        // 실측 raw 분포: ~30(하위) ~ ~75(상위), 중앙 ~55, 사실상 분산이 작음
        // 작은 점수차이도 의미있게 확대해야 함
        const rawCenter = 55;
        const rawSpread = 8; // 매우 좁게 → 작은 차이도 크게 반영

        // z-score
        const z = (raw - rawCenter) / rawSpread;

        // Sigmoid → 0~1 (분산 확대)
        const sigmoid = 1 / (1 + Math.exp(-z * 1.6));
        const mapped = 8 + sigmoid * 84; // 8 ~ 92

        // baseRate 방향으로 불확실성 보정 (데이터 부족 시)
        const shrink = 0.12 * uncertainty;
        const final = mapped * (1 - shrink) + baseRate * shrink;

        return Math.max(5, Math.min(95, Math.round(final * 10) / 10));
    }

    _catWeights(cat) {
        // 이력 데이터 없을 때는 자격+매칭 비중 확대, 경쟁률+이력 축소
        const hasHistory = (this.historyByCategory[cat] || []).length > 0;
        if (hasHistory) {
            const map = {
                '금융': { eligibility: 0.35, matching: 0.25, competition: 0.20, historical: 0.20 },
                '기술': { eligibility: 0.25, matching: 0.30, competition: 0.20, historical: 0.25 },
                '창업': { eligibility: 0.30, matching: 0.30, competition: 0.15, historical: 0.25 },
                '수출': { eligibility: 0.25, matching: 0.35, competition: 0.20, historical: 0.20 },
                '인력': { eligibility: 0.35, matching: 0.25, competition: 0.25, historical: 0.15 },
                '경영': { eligibility: 0.30, matching: 0.25, competition: 0.25, historical: 0.20 },
                '내수': { eligibility: 0.30, matching: 0.25, competition: 0.25, historical: 0.20 },
            };
            return map[cat] || { eligibility: 0.30, matching: 0.25, competition: 0.25, historical: 0.20 };
        }
        // 이력 없으면 자격+매칭 중심
        return { eligibility: 0.40, matching: 0.35, competition: 0.15, historical: 0.10 };
    }

    _getIndustryCats(text) {
        return Object.entries(INDUSTRY_CATEGORIES)
            .filter(([_, kws]) => kws.some(k => text.includes(k)))
            .map(([cat]) => cat);
    }

    _confidence(sub, prof) {
        const sFields = ['description','detail_content','hwp_content','target','region','support_amount'];
        const sComp = sFields.filter(f => sub[f]).length / sFields.length;
        const pFields = ['business_type','industry_name','annual_revenue','employee_count','region_sido','business_age_years'];
        const pComp = pFields.filter(f => prof[f]).length / pFields.length;
        const hCount = (this.historyByCategory[sub.category || '기타'] || []).length;
        const avg = (sComp + pComp) / 2;
        if (avg >= 0.7 && hCount >= 3) return 'high';
        if (avg >= 0.4 || hCount >= 1) return 'medium';
        return 'low';
    }

    _recommend(sub, prof, elig, match) {
        const recs = [];
        if (elig.disqualified) {
            const labels = { region: '지역', industry: '업종', business_type: '사업자 유형' };
            for (const [name, chk] of Object.entries(elig.checks || {})) {
                if (chk.score === 0 && chk.weight >= 15 && labels[name])
                    recs.push(`${labels[name]} 요건이 충족되지 않아 지원이 어려울 수 있습니다.`);
            }
        }
        if (!prof.industry_name) recs.push('업종 정보를 입력하면 더 정확한 매칭이 가능합니다.');
        if (!prof.annual_revenue) recs.push('연매출 정보를 입력하면 규모 적합도 판단이 향상됩니다.');
        if (!prof.region_sido) recs.push('사업장 소재지를 입력하면 지역 매칭이 가능합니다.');
        const d = match.details || {};
        if ((d.purpose_match || 0) >= 80) recs.push('사업 목적이 귀하의 사업 특성과 잘 맞습니다.');
        if ((d.scale_match || 0) >= 80) recs.push('사업 규모가 지원 대상에 적합합니다.');
        const text = `${sub.target||''} ${sub.special_conditions||''}`;
        if (text.includes('여성') && !prof.is_female_owned) recs.push('여성기업 가산점이 있는 사업입니다.');
        if (text.includes('벤처') && !prof.is_venture_certified) recs.push('벤처인증 기업에 가산점이 부여됩니다.');
        if (sub.apply_end_date) {
            const days = Math.ceil((new Date(sub.apply_end_date) - new Date()) / 86400000);
            if (days >= 0 && days <= 7) recs.push(`마감 ${days}일 전입니다. 서둘러 지원하세요!`);
        }
        return recs.slice(0, 5);
    }
}

window.ProbabilityEngine = ProbabilityEngine;
