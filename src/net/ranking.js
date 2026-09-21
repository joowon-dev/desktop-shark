// 랭킹 서버(Supabase)와 이야기하는 곳. 게임 로직은 여기 없다.
//
// **몰래 야구와 같은 프로젝트다.** `players` 표를 같이 써서 별명과 복구 코드가 두
// 게임에서 하나다 — 야구에서 쓰던 복구 코드를 넣으면 상어가 같은 이름으로 붙는다.
//
// **표에는 직접 못 닿는다.** 익명 키로 부를 수 있는 것은 아래 함수들뿐이고, 그 함수들이
// 서버에서 신분을 확인하고 상한을 건다. 키가 밖에 나가도 남의 기록을 고칠 수 없다.
//
// 보내는 것: 기기가 만든 무작위 uuid, **몇 번 먹였는지**, 별명.
// 개인을 식별할 수 있는 것은 없고, **단계도 순위도 안 보낸다** — 서버가 매긴다.

export const RANKING_URL = 'https://xajmblrdkdnqoxfvsfrt.supabase.co'
// 공개되도록 만들어진 키다(웹 앱이 브라우저에 담고 다니는 것과 같은 성질).
export const RANKING_KEY = 'sb_publishable_xsEat7HWFPI0td0olEVicw_pxa2Ct5K'

const TIMEOUT_MS = 8000

/**
 * RPC 하나를 부른다. 실패는 예외로 던지고, **부르는 쪽이 조용히 삼킨다** —
 * 랭킹이 안 되는 것과 게임이 안 되는 것은 다른 일이다.
 */
export async function rpc(name, body = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(`${RANKING_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: RANKING_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`${name} ${res.status} ${text.slice(0, 200)}`)
    }
    if (res.status === 204) return null
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

// MARK: 계정 — 야구와 공용

export function registerPlayer(nickname, secret) {
  return rpc('register_player', { p_nickname: nickname, p_secret: secret })
}

export function setNickname(playerId, secret, nickname) {
  return rpc('set_nickname', { p_player: playerId, p_secret: secret, p_nickname: nickname })
}

/** 복구 코드가 맞는지만 본다. */
export function verifyCode(playerId, secret) {
  return rpc('verify_code', { p_player: playerId, p_secret: secret })
}

// MARK: 상어

/**
 * 밥을 준 횟수를 올린다. **단계는 안 보낸다** — 서버가 문턱을 보고 매긴다.
 * count 는 오프라인에서 밀린 것을 한꺼번에 흘려보내기 위한 것이고 한 번에 20까지.
 */
export function feedShark(playerId, secret, count = 1) {
  return rpc('feed_shark', { p_player: playerId, p_secret: secret, p_count: count })
}

/** 상위 몇 명. **기간 탭이 없다** — 성장은 쌓이기만 해서 「오늘의 성장」은 뜻이 없다. */
export function sharkRanking(limit = 20) {
  return rpc('shark_ranking', { p_limit: limit })
}

export function myShark(playerId) {
  return rpc('my_shark', { p_player: playerId })
}

/** 브라우저의 난수. 순수 모듈(sync.js)에 넘겨 준다. */
export function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length))
}
