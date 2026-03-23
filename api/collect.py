"""
Vercel Serverless Function: 정부지원사업 실시간 수집 API

POST /api/collect → 주요 정부 API에서 최신 데이터를 직접 수집하여 반환
GET  /api/collect → 마지막 수집 상태 조회

GitHub 토큰 없이 웹 브라우저에서 직접 수집을 트리거할 수 있습니다.
Vercel 서버리스 함수로 실행되므로 60초 타임아웃 내에서 동작합니다.
"""

from http.server import BaseHTTPRequestHandler
import json
import re
import hashlib
import time
from datetime import datetime
from urllib.request import urlopen, Request
from urllib.parse import urlencode
from urllib.error import URLError


# ===== 경량 수집기 (외부 라이브러리 없이 stdlib만 사용) =====

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/html, */*',
    'Accept-Language': 'ko-KR,ko;q=0.9',
}


def _fetch(url, params=None, timeout=10):
    """HTTP GET 요청 (stdlib only)"""
    if params:
        url = url + '?' + urlencode(params)
    req = Request(url, headers=HEADERS)
    try:
        with urlopen(req, timeout=timeout) as resp:
            return resp.read().decode('utf-8', errors='replace')
    except Exception:
        return None


def _hash_id(source, title, org=''):
    """해시 기반 external_id 생성"""
    h = hashlib.md5(f"{title}_{org}".encode()).hexdigest()[:12]
    return f"{source}_{h}"


def _parse_date(text):
    """날짜 파싱"""
    if not text:
        return ''
    m = re.search(r'(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})', str(text))
    if m:
        return f"{m.group(1)}-{m.group(2).zfill(2)}-{m.group(3).zfill(2)}"
    return ''


# ----- 기업마당 (bizinfo.go.kr) Open API -----
def collect_bizinfo(max_pages=5):
    """기업마당 Open API 수집"""
    items = []
    seen = set()
    base = 'https://www.bizinfo.go.kr/uss/rss/bizRss.do'

    for page in range(1, max_pages + 1):
        html = _fetch(base, {'cpage': page, 'rows': 20})
        if not html:
            break
        # RSS XML에서 항목 추출
        for item_match in re.finditer(r'<item>(.*?)</item>', html, re.DOTALL):
            block = item_match.group(1)
            title_m = re.search(r'<title><!\[CDATA\[(.*?)\]\]></title>', block)
            link_m = re.search(r'<link>(.*?)</link>', block)
            desc_m = re.search(r'<description><!\[CDATA\[(.*?)\]\]></description>', block)

            if not title_m:
                continue
            title = title_m.group(1).strip()
            if title in seen:
                continue
            seen.add(title)

            link = link_m.group(1).strip() if link_m else ''
            desc = desc_m.group(1).strip() if desc_m else ''

            # 날짜 추출 시도
            date_m = re.search(r'(\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})', desc)
            date_text = date_m.group(1) if date_m else ''

            items.append({
                'external_id': _hash_id('bizinfo', title),
                'title': title,
                'category': '경영',
                'organization': '기업마당',
                'executor': '',
                'target': '',
                'region': '전국',
                'apply_start_date': _parse_date(date_text),
                'apply_end_date': '',
                'detail_url': link,
                'source': 'bizinfo',
            })

    return items


# ----- K-스타트업 API -----
def collect_kstartup(max_pages=3):
    """K-스타트업 공고 수집 (JSON API)"""
    items = []
    seen = set()
    base = 'https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do'

    for page in range(1, max_pages + 1):
        raw = _fetch(base, {'schPage': page, 'pbancEndYn': 'N'})
        if not raw:
            break

        # HTML에서 목록 추출 (정규식)
        for m in re.finditer(
            r'<a[^>]*href=["\']([^"\']*detail[^"\']*)["\'][^>]*>(.*?)</a>',
            raw, re.DOTALL
        ):
            link = m.group(1).strip()
            title = re.sub(r'<[^>]+>', '', m.group(2)).strip()
            if not title or title in seen or len(title) < 5:
                continue
            seen.add(title)

            if not link.startswith('http'):
                link = 'https://www.k-startup.go.kr' + link

            items.append({
                'external_id': _hash_id('kstartup', title),
                'title': title,
                'category': '창업',
                'organization': 'K-스타트업',
                'executor': '',
                'target': '창업기업',
                'region': '전국',
                'apply_start_date': '',
                'apply_end_date': '',
                'detail_url': link,
                'source': 'kstartup',
            })

    return items


# ----- 중소벤처24 (smes.go.kr) -----
def collect_smes(max_pages=3):
    """중소벤처24 지원사업 수집"""
    items = []
    seen = set()

    for page in range(1, max_pages + 1):
        raw = _fetch(
            'https://www.smes.go.kr/bizApply/list',
            {'page': page, 'size': 20}
        )
        if not raw:
            # 대안 URL
            raw = _fetch(
                'https://www.smes.go.kr/smesBizApply/bizApplyList.do',
                {'pageIndex': page}
            )
        if not raw:
            break

        for m in re.finditer(
            r'<a[^>]*href=["\']([^"\']*)["\'][^>]*>\s*(?:<[^>]*>)*\s*([^<]{5,})',
            raw
        ):
            link = m.group(1).strip()
            title = m.group(2).strip()
            if title in seen or len(title) > 200:
                continue
            seen.add(title)

            if not link.startswith('http'):
                link = 'https://www.smes.go.kr' + link

            items.append({
                'external_id': _hash_id('smes', title),
                'title': title,
                'category': '중소기업',
                'organization': '중소벤처24',
                'executor': '',
                'target': '중소기업',
                'region': '전국',
                'apply_start_date': '',
                'apply_end_date': '',
                'detail_url': link,
                'source': 'smes',
            })

    return items


# ----- 보조금24 (subsidy.go.kr) -----
def collect_subsidy24(max_pages=3):
    """보조금24 포털 수집"""
    items = []
    seen = set()

    for page in range(1, max_pages + 1):
        raw = _fetch(
            'https://www.subsidy.go.kr/subsidy/search',
            {'page': page, 'size': 20, 'sort': 'latest'}
        )
        if not raw:
            break

        for m in re.finditer(
            r'<a[^>]*href=["\']([^"\']*)["\'][^>]*>\s*(?:<[^>]*>)*\s*([^<]{5,})',
            raw
        ):
            link = m.group(1).strip()
            title = m.group(2).strip()
            if title in seen or len(title) > 200:
                continue
            seen.add(title)

            if not link.startswith('http'):
                link = 'https://www.subsidy.go.kr' + link

            items.append({
                'external_id': _hash_id('subsidy24', title),
                'title': title,
                'category': '보조금',
                'organization': '보조금24',
                'executor': '',
                'target': '',
                'region': '전국',
                'apply_start_date': '',
                'apply_end_date': '',
                'detail_url': link,
                'source': 'subsidy24',
            })

    return items


def run_collection():
    """모든 소스에서 수집 실행"""
    results = {
        'timestamp': datetime.utcnow().isoformat() + 'Z',
        'sources': {},
        'items': [],
        'total': 0,
    }

    collectors = [
        ('bizinfo', '기업마당', collect_bizinfo),
        ('kstartup', 'K-스타트업', collect_kstartup),
        ('smes', '중소벤처24', collect_smes),
        ('subsidy24', '보조금24', collect_subsidy24),
    ]

    for source_id, source_name, collector_fn in collectors:
        try:
            items = collector_fn()
            results['sources'][source_id] = {
                'name': source_name,
                'count': len(items),
                'status': 'success',
            }
            results['items'].extend(items)
        except Exception as e:
            results['sources'][source_id] = {
                'name': source_name,
                'count': 0,
                'status': 'error',
                'error': str(e),
            }

    results['total'] = len(results['items'])
    return results


# ===== Vercel Handler =====

class handler(BaseHTTPRequestHandler):

    def _send_json(self, status, data):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

    def do_OPTIONS(self):
        """CORS preflight"""
        self._send_json(200, {'ok': True})

    def do_GET(self):
        """수집 상태/정보 조회"""
        self._send_json(200, {
            'status': 'ready',
            'message': '수집 API가 준비되었습니다. POST 요청으로 수집을 시작하세요.',
            'sources': ['bizinfo', 'kstartup', 'smes', 'subsidy24'],
            'method': 'POST /api/collect',
        })

    def do_POST(self):
        """수집 실행"""
        try:
            results = run_collection()
            self._send_json(200, {
                'success': True,
                'message': f"수집 완료: {results['total']}건",
                **results,
            })
        except Exception as e:
            self._send_json(500, {
                'success': False,
                'error': str(e),
            })
