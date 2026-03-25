/**
 * 선정확률 엔진 v3.0
 * 소상공인 맞춤형 정부지원사업 매칭 및 선정확률 계산
 *
 * v3.0 개선사항:
 *  - 베이지안 오즈 업데이트 (Bayesian Odds Update) 구조로 전환
 *  - 사전확률(Prior) = 카테고리별 실제 선정률 기반
 *  - 우도비(Likelihood Ratio)로 적합도 점수를 확률로 변환
 *  - 자격요건 Gate: 부적격 시 즉시 3% 이하 반환
 *  - 신뢰구간(probability_range) 표시
 *
 * 5단계 알고리즘:
 *  1. 자격요건 Gate (Eligibility Gate) - Pass/Fail/Partial
 *  2. 조건 매칭 점수 (Weighted Scoring)
 *  3. 사전확률 산출 (Prior from Competition/Base Rate)
 *  4. 이력 기반 우도비 (Historical Likelihood Ratio)
 *  5. 베이지안 오즈 업데이트 (Bayesian Odds Update)
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

// 카테고리별 실제 평균 선정률 (정부 공개 데이터 + 업계 통계 기반)
// 경쟁률 데이터 없을 때 사전확률(prior)로 사용
const BASE_SELECTION_RATES = {
    '창업': 0.20,   // 창업 지원: 경쟁률 3:1~10:1, 평균 선정률 ~20%
    '기술': 0.25,   // R&D/기술: 경쟁률 3:1~5:1, 평균 선정률 ~25%
    '금융': 0.50,   // 정책자금 융자: 요건 충족 시 비교적 높은 선정률
    '수출': 0.30,   // 수출 지원: 경쟁률 2:1~5:1
    '인력': 0.35,   // 인력 지원: 중간 수준
    '경영': 0.40,   // 경영 지원: 비교적 넓은 선정 범위
    '내수': 0.35,   // 내수 지원: 중간 수준
    '정책': 0.30,   // 정책 일반: 중간 수준
    '기타': 0.30,   // 기본값
    '에너지': 0.28,
    '환경': 0.30,
    '문화': 0.22,
};

// 분야별 하위 카테고리 (subcategory) 체계
// 공고 타이틀/본문에서 키워드 매칭으로 자동 분류
const SUBCATEGORIES = {
    '금융': {
        '정책자금 대출': ['정책자금','융자','대출','운전자금','시설자금','긴급자금','경영안정자금','특례보증'],
        '보증 지원': ['보증','신용보증','기술보증','특례보증','보증서','보증료','이차보전'],
        '투자 유치': ['투자','엔젤','벤처캐피탈','VC','투자유치','지분투자','모태펀드'],
        '이자 보전': ['이자보전','이차보전','이자차액','이자지원','금리우대'],
        '긴급 경영자금': ['긴급','재해','피해','경영위기','회생','재기']
    },
    '기술': {
        'R&D 지원': ['R&D','연구개발','기술개발','연구과제','기술혁신','기술고도화'],
        '기술 바우처': ['바우처','기술바우처','혁신바우처','서비스바우처'],
        '특허/지식재산': ['특허','지식재산','IP','실용신안','디자인등록','상표'],
        '시제품 제작': ['시제품','프로토타입','시작품','금형','3D프린팅'],
        '기술 인증': ['인증','KC인증','CE인증','ISO','시험','검사','품질'],
        '기술 이전': ['기술이전','기술사업화','기술거래','기술중개']
    },
    '창업': {
        '창업 교육': ['창업교육','아카데미','캠프','멘토링','창업스쿨','인큐베이팅'],
        '사업화 지원': ['사업화','창업사업화','초기창업','예비창업','창업도약'],
        '창업 공간': ['창업공간','입주','보육','액셀러레이터','창업센터','오피스'],
        '창업 자금': ['창업자금','시드','초기자금','창업지원금'],
        '창업 경진대회': ['경진대회','공모전','아이디어','데모데이','IR피칭']
    },
    '수출': {
        '해외 마케팅': ['해외마케팅','수출마케팅','해외홍보','글로벌마케팅','해외광고'],
        '전시회/박람회': ['전시회','박람회','엑스포','해외전시','무역전시'],
        '수출 물류': ['수출물류','물류비','EMS','국제배송','통관','FTA'],
        '수출 바우처': ['수출바우처','글로벌바우처','해외진출바우처'],
        '수출 인증': ['수출인증','해외인증','CE','FDA','해외규격','적합성'],
        '해외 입점': ['해외입점','크로스보더','아마존','해외 온라인','해외 플랫폼']
    },
    '인력': {
        '채용 지원': ['채용','고용','일자리','채용장려금','고용장려금','인턴'],
        '직업 훈련': ['훈련','직업훈련','직무교육','재직자교육','역량강화'],
        '인건비 지원': ['인건비','임금','급여지원','임금보전','인력지원금'],
        '전문인력 매칭': ['전문인력','인력매칭','구인구직','취업연계'],
        '청년 고용': ['청년','청년채용','청년일자리','청년고용','MZ']
    },
    '경영': {
        '컨설팅': ['컨설팅','자문','진단','경영진단','경영자문','전문가활용'],
        '교육/세미나': ['교육','세미나','워크숍','아카데미','역량강화교육'],
        '디자인 지원': ['디자인','브랜딩','BI','CI','패키지디자인','포장'],
        '마케팅 지원': ['마케팅','홍보','광고','판촉','프로모션','SNS마케팅'],
        '경영 혁신': ['혁신','스마트화','디지털전환','DX','자동화','AI도입'],
        '법률/회계': ['법률','회계','세무','노무','법무','특허상담']
    },
    '내수': {
        '온라인 판로': ['온라인','e커머스','전자상거래','쇼핑몰','라이브커머스','입점'],
        '오프라인 판로': ['판로','판매','직매장','팝업','대형마트입점','납품'],
        '소상공인 지원': ['소상공인','전통시장','골목상권','상권활성화','상점가'],
        '프랜차이즈': ['프랜차이즈','가맹','체인','브랜드화'],
        '지역 축제/행사': ['축제','행사','박람회','페어','페스티벌']
    },
    '정책': {
        '규제 특례': ['규제','특례','샌드박스','규제혁신','특구'],
        '인허가 지원': ['인허가','허가','등록','신고','면허'],
        '정보 제공': ['정보','안내','가이드','설명회','간담회','정보제공'],
        '네트워킹': ['네트워킹','교류','협력','협의체','클러스터','동반성장'],
        '포상/인증': ['포상','시상','인증','선정','지정','표창']
    },
    '기타': {
        '복합 지원': ['복합','통합','패키지','원스톱'],
        '기타': []
    }
};

// 공고 텍스트에서 subcategory 자동 분류
function classifySubcategory(subsidy) {
    const cat = subsidy.category || '기타';
    const subMap = SUBCATEGORIES[cat];
    if (!subMap) return '기타';
    const text = [subsidy.title, subsidy.description, subsidy.target, subsidy.detail_content]
        .filter(Boolean).join(' ');
    let bestMatch = '기타';
    let bestCount = 0;
    for (const [subcat, keywords] of Object.entries(subMap)) {
        const count = keywords.filter(kw => text.includes(kw)).length;
        if (count > bestCount) { bestCount = count; bestMatch = subcat; }
    }
    return bestMatch;
}

// 사업장 설명에서 주요 키워드 추출
function extractBusinessKeywords(description) {
    if (!description || description.length < 2) return [];
    const stops = ['있습니다','합니다','하고','입니다','됩니다','것입니다','하는','되는','위한','통한','대한','관련','현재','최근','매우','정도','약간','계속','항상','자주','때문','그리고','하지만','그래서','또한','그런데','따라서','이를','저희','우리','사업','업체','회사','기업','사업장','운영','진행','제공','서비스','목표','준비','예정','주요','제품'];
    // 한국어 조사/어미 제거
    const clean = description.replace(/[^가-힣a-zA-Z0-9\s]/g, ' ')
        .replace(/(을|를|이|가|은|는|의|에|에서|으로|로|와|과|하여|하는|하고|이며|으며|입니다|합니다|됩니다|중이며|중입니다)/g, ' ');
    const words = clean.split(/\s+/)
        .filter(w => w.length >= 2 && !stops.includes(w));
    // 빈도순 정렬 후 상위 키워드 반환
    const freq = {};
    words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 15).map(e => e[0]);
}

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
            this.avgRateByCategory[cat] = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : ((BASE_SELECTION_RATES[cat] || 0.30) * 100);
        }
    }

    calculate(subsidy, profile) {
        const eligibility = this._checkEligibility(subsidy, profile);

        // Gate: 부적격 시 즉시 낮은 확률 반환
        if (eligibility.disqualified) {
            // 지역 불일치 시 1% 강제
            const regionFail = eligibility.checks.region && eligibility.checks.region.score === 0;
            const gateProb = regionFail ? 1 : Math.round(Math.max(3, eligibility.score * 0.1) * 10) / 10;
            const gateRange = regionFail ? { low: 1, high: 1 } : { low: 1, high: 5 };
            const confidence = this._confidence(subsidy, profile);
            const recommendations = this._recommend(subsidy, profile, eligibility, {score: 0, details: {}});
            return {
                subsidy_id: subsidy.id,
                subsidy_title: subsidy.title,
                category: subsidy.category,
                organization: subsidy.organization,
                apply_end_date: subsidy.apply_end_date,
                eligibility_score: Math.round(eligibility.score * 10) / 10,
                matching_score: 0,
                competition_score: 0,
                historical_score: 0,
                final_probability: gateProb,
                probability_range: gateRange,
                confidence_level: confidence,
                recommendations,
                matching_details: {},
                subcategory: classifySubcategory(subsidy),
                disqualified: true,
            };
        }

        const matching = this._calcMatching(subsidy, profile);
        const competition = this._calcCompetition(subsidy);
        const historical = this._calcHistorical(subsidy, profile);
        const { probability: final, range } = this._integrate(eligibility, matching, competition, historical, subsidy, profile);
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
            probability_range: range,
            confidence_level: confidence,
            recommendations,
            matching_details: matching.details || {},
            subcategory: classifySubcategory(subsidy),
            disqualified: false,
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
            ['target_fit', this._chkTargetFit(sub, prof), 20],
        ];
        const totalW = checks.reduce((s, c) => s + c[2], 0);
        const wSum = checks.reduce((s, c) => s + c[1] * c[2], 0);
        let score = totalW > 0 ? wSum / totalW : 0;
        const disqualified = checks.some(c => c[1] === 0 && c[2] >= 15 && ['region','industry','business_type','target_fit'].includes(c[0]));
        if (disqualified) score = Math.min(score, 15);
        return { score, disqualified, checks: Object.fromEntries(checks.map(c => [c[0], {score: c[1], weight: c[2]}])) };
    }

    // 대상 적합도: 공고에 특정 자격/시설/경험이 요구되는데 사용자가 해당하지 않으면 감점
    _chkTargetFit(sub, prof) {
        const text = [sub.title, sub.target, sub.description, sub.detail_content]
            .filter(Boolean).join(' ');
        const userDesc = (prof.business_description || '').toLowerCase();
        const userInd = (prof.industry_name || '').toLowerCase();
        const userAll = (userDesc + ' ' + userInd).toLowerCase();

        // 특수 자격 키워드: [키워드 그룹, 관련 업종/키워드]
        // 공고에 키워드가 있으면 사용자도 관련 키워드를 가져야 함
        const requirements = [
            { keywords: ['스마트공장','스마트 공장','smart factory'], related: ['공장','제조','생산','스마트공장','factory','제조업'] },
            { keywords: ['수출실적','수출 실적','수출기업'], related: ['수출','export','해외','무역'] },
            { keywords: ['제조기업','제조 기업','제조업체','제조업 영위'], related: ['제조','생산','공장','가공','조립'] },
            { keywords: ['농업인','농업경영체','영농'], related: ['농업','농산물','축산','임업','어업','영농'] },
            { keywords: ['사회적경제조직','사회적기업','마을기업','협동조합 기본법'], related: ['사회적기업','협동조합','마을기업','자활기업'] },
            { keywords: ['벤처기업 확인','벤처확인','벤처인증기업'], related: ['벤처','venture','벤처인증'] },
            { keywords: ['특허 보유','지식재산 보유','IP 보유'], related: ['특허','지식재산','IP','patent'] },
            { keywords: ['프랜차이즈 가맹','가맹사업'], related: ['프랜차이즈','가맹','체인','FC'] },
            { keywords: ['연구소 보유','기업부설연구소','연구개발전담부서'], related: ['연구소','연구개발','R&D','연구원'] },
            { keywords: ['의료기기','의약품','임상시험'], related: ['의료','의약','바이오','임상','제약'] },
            { keywords: ['건설업 등록','건설업체'], related: ['건설','건축','시공','인테리어'] },
            { keywords: ['물류센터','물류 시설','창고업'], related: ['물류','창고','운송','택배','배송'] },
            { keywords: ['콘텐츠 제작','영상 제작','방송 프로그램'], related: ['콘텐츠','영상','방송','미디어','게임'] },
            { keywords: ['관광사업자','관광업','여행업'], related: ['관광','여행','숙박','호텔','펜션'] },
        ];

        let hasRequirement = false;
        let meetsRequirement = true;

        for (const req of requirements) {
            const found = req.keywords.some(kw => text.includes(kw));
            if (found) {
                hasRequirement = true;
                const userHas = req.related.some(r => userAll.includes(r));
                // 프로필 체크박스로도 충족 가능
                if (req.keywords.some(k => k.includes('벤처')) && prof.is_venture_certified) continue;
                if (req.keywords.some(k => k.includes('사회적')) && prof.is_social_enterprise) continue;
                if (req.keywords.some(k => k.includes('수출')) && prof.has_export) continue;
                if (!userHas) { meetsRequirement = false; break; }
            }
        }

        if (hasRequirement && !meetsRequirement) return 0; // 부적격
        if (hasRequirement && meetsRequirement) return 100; // 완벽 적합
        return 50; // 특수 요건 없음 → 중립
    }

    _chkRegion(sub, prof) {
        let req = sub.region_required || sub.region || '';
        const user = prof.region_sido || '';
        const userSigungu = prof.region_sigungu || '';

        // 타이틀에서 [시도] + 시/군/구 추출
        // 예: "[경기] 수원시 2026년 ..." → sido="경기", sigungu="수원시"
        let titleSido = '';
        let titleSigungu = '';
        const titleMatch = (sub.title || '').match(/^\[([가-힣]+)\]\s*([가-힣]+[시군구])?/);
        if (titleMatch) {
            titleSido = titleMatch[1];           // "경기", "전남" 등
            titleSigungu = titleMatch[2] || '';   // "수원시", "강진군" 등
        }

        // req가 비어있으면 타이틀에서 추출한 시/도 사용
        if (!req && titleSido) {
            req = titleSido;
        }

        if (!req || ['전국','해당없음','-',''].includes(req)) return 80;

        // 지역명 정규화 매칭 (약칭 ↔ 풀네임)
        const regionMap = {
            '서울':'서울특별시','경기':'경기도','인천':'인천광역시',
            '부산':'부산광역시','대구':'대구광역시','대전':'대전광역시',
            '광주':'광주광역시','울산':'울산광역시','세종':'세종특별자치시',
            '강원':'강원특별자치도','충북':'충청북도','충남':'충청남도',
            '전북':'전북특별자치도','전남':'전라남도',
            '경북':'경상북도','경남':'경상남도','제주':'제주특별자치도',
        };

        for (const [short, full] of Object.entries(regionMap)) {
            if (req.includes(short) || req.includes(full)) {
                // 시/도 불일치 → 0
                if (user && !(user.includes(short) || user.includes(full))) return 0;
                // 시/도 일치 → 시/군/구 체크
                if (user && (user.includes(short) || user.includes(full))) {
                    // 공고에 특정 시/군/구가 있으면 세부 매칭
                    if (titleSigungu) {
                        if (userSigungu && userSigungu === titleSigungu) return 100; // 시/군/구 완전 일치
                        if (userSigungu && userSigungu !== titleSigungu) return 0;   // 같은 도 다른 시 → 0
                        return 30; // 사용자 시/군/구 미입력
                    }
                    return 100; // 시/도 일치 + 시/군/구 특정 없음
                }
                return 30; // 사용자 시/도 미입력
            }
        }

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
            return 40; // 업종제한 없어도 미매칭 시 낮게 평가
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
            return 30; // 미입력: 판단 불가 → 낮게
        }
        if (rev == null) return 25; // 공고에 조건이 있는데 매출 미입력 → 더 낮게
        if (text.includes('소상공인')) return rev <= 12e9 ? 95 : 20;
        if (text.includes('소기업')) return rev <= 12e9 ? 90 : rev <= 30e9 ? 60 : 20;
        if (text.includes('중소기업')) return rev <= 150e9 ? 90 : 30;
        return 50;
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
            return 30; // 미입력: 판단 불가 → 낮게
        }
        if (cnt == null) return 25; // 공고에 조건이 있는데 종업원 미입력 → 더 낮게
        if (text.includes('소상공인')) return cnt < 10 ? 95 : cnt < 50 ? 50 : 20;
        if (text.includes('소기업')) return cnt < 50 ? 90 : 30;
        return 55;
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
        let score = 35; // 기본값: 가산점 없으면 불리하게
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
            description_match: this._matchDescription(text, prof),
        };
        // 사업장 설명이 있으면 가중치 재배분 (description_match 0.15 추가)
        const hasDesc = prof.business_description && prof.business_description.length >= 10;
        const weights = hasDesc
            ? { industry_match: 0.25, scale_match: 0.15, purpose_match: 0.20, region_match: 0.10, qualification_match: 0.15, description_match: 0.15 }
            : { industry_match: 0.30, scale_match: 0.20, purpose_match: 0.25, region_match: 0.10, qualification_match: 0.15, description_match: 0.00 };
        const score = Object.entries(weights).reduce((s, [k, w]) => s + (details[k] || 0) * w, 0);
        return { score, details };
    }

    // 사업장 설명 키워드 매칭
    _matchDescription(text, prof) {
        const desc = prof.business_description || '';
        if (!desc || desc.length < 10) return 0; // 미입력 시 0 (가중치도 0이므로 영향 없음)
        const keywords = extractBusinessKeywords(desc);
        if (keywords.length === 0) return 30;
        // 키워드 매칭 비율
        const matched = keywords.filter(kw => text.includes(kw)).length;
        const ratio = matched / keywords.length;
        // 0% 매칭 → 20, 50% → 60, 100% → 100
        return Math.round(20 + ratio * 80);
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
        if (!rev && !emp) return 25; // 매출·종업원 둘 다 미입력 → 판단 불가
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
        const userInd = prof.industry_name || '';

        // 타이틀 키워드 기반 정밀 매칭
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

        // 하위 카테고리 매칭 보너스: 사업장 설명 키워드가 하위유형 키워드와 매칭
        const subcat = classifySubcategory(sub);
        const desc = prof.business_description || '';
        if (desc.length >= 10 && subcat !== '기타') {
            const subcatMap = SUBCATEGORIES[cat];
            if (subcatMap && subcatMap[subcat]) {
                const subcatKws = subcatMap[subcat];
                const descKws = extractBusinessKeywords(desc);
                const subcatHit = subcatKws.some(kw => desc.includes(kw) || descKws.some(dk => kw.includes(dk) || dk.includes(kw)));
                if (subcatHit) base = Math.min(100, base + 15); // 하위유형-설명 매칭 시 +15
            }
        }

        return Math.max(5, Math.min(100, base + titleBonus));
    }

    _matchQual(text, prof) {
        let score = 30; // 자격요건 기본: 인증/자격 없으면 낮게
        if (prof.is_venture_certified && text.includes('벤처')) score += 20;
        if (prof.is_social_enterprise && text.includes('사회적')) score += 15;
        if (prof.technology_grade && (text.includes('기술') || text.includes('R&D'))) score += 15;
        if (prof.has_employment_insurance) score += 5;
        // 해당 자격이 없으면 감점
        if (!prof.is_venture_certified && text.includes('벤처기업')) score -= 15;
        if (!prof.is_social_enterprise && text.includes('사회적기업')) score -= 15;
        return Math.min(100, Math.max(5, score));
    }

    // 3단계: 사전확률(Prior) 산출 - 경쟁률 기반 실제 선정률
    _calcCompetition(sub) {
        const cat = sub.category || '기타';
        const competitionRate = sub.competition_rate;
        let selectionRate, source;

        if (competitionRate != null && competitionRate > 0) {
            selectionRate = (1 / competitionRate) * 100;
            source = 'direct';
        } else if (this.avgRateByCategory[cat]) {
            selectionRate = this.avgRateByCategory[cat];
            source = 'historical_avg';
        } else {
            selectionRate = (BASE_SELECTION_RATES[cat] || 0.30) * 100;
            source = 'base_rate';
        }

        // 공고 특성 기반 선정률 조정
        let adjusted = selectionRate;
        const title = sub.title || '';
        // 전국 공고는 경쟁 치열 → 선정률 감소
        if (!sub.region || sub.region === '전국') adjusted *= 0.85;
        // 특수 대상 한정 공고는 경쟁 완화 → 선정률 증가
        if (title.includes('여성') || title.includes('장애인')) adjusted *= 1.2;
        if (title.includes('청년') || title.includes('시니어')) adjusted *= 1.1;
        // 마감 임박 공고는 지원자 적어 선정률 증가
        if (sub.apply_end_date) {
            const days = Math.ceil((new Date(sub.apply_end_date) - new Date()) / 86400000);
            if (days >= 0 && days <= 3) adjusted *= 1.3;
            else if (days <= 7) adjusted *= 1.1;
        }

        adjusted = Math.max(5, Math.min(80, adjusted));
        const prior = adjusted / 100;

        return {
            score: Math.round(adjusted * 10) / 10,
            selection_rate: Math.round(adjusted * 10) / 10,
            prior_probability: Math.round(prior * 1000) / 1000,
            source,
        };
    }

    // 4단계: 이력 (데이터 없을 때 프로필-공고 적합도 추정)
    _calcHistorical(sub, prof) {
        const cat = sub.category || '기타';
        const records = this.historyByCategory[cat] || [];

        if (!records.length) {
            // 이력 데이터가 없으므로 프로필 완성도 + 카테고리 친화도로 대체
            let score = 25; // 이력 없음 = 낮은 출발
            // 프로필이 풍부할수록 점수 상승 (최대 +35 → 60)
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

    // 5단계: 베이지안 오즈 업데이트
    // P(선정|사용자) = Prior × LR_total / (Prior × LR_total + (1-Prior))
    _integrate(elig, match, comp, hist, sub, profile) {
        // --- 사전확률 (Prior) ---
        let prior = comp.prior_probability;
        if (prior == null) {
            const cat = sub.category || '기타';
            prior = BASE_SELECTION_RATES[cat] || 0.30;
        }
        prior = Math.max(0.02, Math.min(0.98, prior));

        // --- 우도비 (Likelihood Ratios) ---
        // 핵심 원칙: 50점(=모름/중립) → LR=1.0, Prior 변동 없음
        //           100점(=완벽 적합) → LR=3.0, Prior 크게 상승
        //           0점(=완전 부적합) → LR=0.15, Prior 크게 하락
        // 공식: LR = exp((score - 50) / 50 * ln(3)) → 50→1.0, 100→3.0, 0→0.33
        //       추가로 0점 근처를 더 가파르게: 2구간 선형보간
        //       [0, 50] → [0.15, 1.0]  /  [50, 100] → [1.0, 3.0]

        // LR_eligibility
        const eligScore = elig.score / 100;
        const lrElig = eligScore <= 0.5
            ? 0.15 + (eligScore / 0.5) * (1.0 - 0.15)       // 0→0.15, 50→1.0
            : 1.0 + ((eligScore - 0.5) / 0.5) * (3.0 - 1.0); // 50→1.0, 100→3.0

        // LR_matching (동일 곡선)
        const matchScore = match.score / 100;
        const lrMatch = matchScore <= 0.5
            ? 0.15 + (matchScore / 0.5) * (1.0 - 0.15)
            : 1.0 + ((matchScore - 0.5) / 0.5) * (3.0 - 1.0);

        // LR_historical: 이력 기반 우도비
        const histScore = hist.score / 100;
        const histRecords = (this.historyByCategory[sub.category || '기타'] || []).length;
        let lrHist;
        if (histRecords > 0) {
            const dataConf = Math.min(1.0, histRecords / 5);
            const lrRaw = histScore <= 0.5
                ? 0.15 + (histScore / 0.5) * (1.0 - 0.15)
                : 1.0 + ((histScore - 0.5) / 0.5) * (3.0 - 1.0);
            lrHist = 1.0 + (lrRaw - 1.0) * dataConf;
        } else {
            lrHist = 1.0; // 이력 없으면 중립
        }

        // --- 베이지안 업데이트 (오즈 형태) ---
        const priorOdds = prior / (1 - prior);
        const combinedLR = lrElig * lrMatch * lrHist;
        const posteriorOdds = priorOdds * combinedLR;
        const posterior = posteriorOdds / (1 + posteriorOdds);

        const finalProb = Math.max(3, Math.min(95, posterior * 100));

        // --- 신뢰구간 산출 ---
        const range = this._calcProbRange(finalProb, sub, profile, histRecords);

        return { probability: finalProb, range };
    }

    // 신뢰구간: 데이터 불확실성에 비례하여 폭 결정
    _calcProbRange(center, sub, profile, histCount) {
        const sFields = ['description','detail_content','hwp_content','target','region','support_amount'];
        const sComp = sFields.filter(f => sub[f]).length / sFields.length;
        const pFields = ['business_type','industry_name','annual_revenue','employee_count','region_sido','business_age_years'];
        const pComp = pFields.filter(f => profile[f] != null && profile[f] !== '').length / pFields.length;
        const histFactor = Math.min(1.0, histCount / 5);
        const quality = (sComp + pComp) / 2 * 0.6 + histFactor * 0.4;
        // 불확실성: 데이터 풍부하면 ±5%, 부족하면 ±20%
        const margin = 20 - quality * 15;
        return {
            low: Math.round(Math.max(1, center - margin) * 10) / 10,
            high: Math.round(Math.min(99, center + margin) * 10) / 10,
        };
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
