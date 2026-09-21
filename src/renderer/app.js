// 캔버스·브리지·루프. **게임 규칙은 여기 없다** — src/game/ 에 있다.
//
// 여기는 순수 모듈이 못 하는 것만 한다: 벽시계를 읽고, 화면 크기를 재고, 클릭을 받고,
// 셸과 이야기하고, 서버에 올린다.

import { DT } from '../game/constants.js'
import {
  createEngine, feedAt, feedTyped, setBounds, setGameMode, snapshot, step,
} from '../game/engine.js'
import { hungerLabel } from '../game/hunger.js'
import { toNextStage } from '../game/growth.js'
import {
  defaultNickname, dropBatch, mergeEaten, newSecret, nextBatch,
  parseRecoveryCode, recoveryCode,
} from '../game/sync.js'
import { draw } from '../render/draw.js'
import {
  feedShark, myShark, randomBytes, registerPlayer, setNickname, sharkRanking, verifyCode,
} from '../net/ranking.js'

const canvas = document.getElementById('stage')
const ctx = canvas.getContext('2d')

const hud = document.getElementById('hud')
const panel = document.getElementById('panel')

/** 셸이 없으면(브라우저로 열었으면) 저장도 핫키도 없이 게임만 돈다. */
const bridge = window.sneaky ?? null

let engine = createEngine({ seed: (Date.now() & 0xffff) | 1, now: Date.now() })
let account = { playerId: null, secret: null, nickname: null }

/** 랭킹에 올릴 것인가. 끄면 아무것도 서버로 안 보낸다. 셸이 저장한다. */
let rankingOn = true

/** 자동 등록이 도는 중인가. 밥을 연달아 주면 두 번 등록되는 것을 막는다. */
let registering = false
let view = { width: 0, height: 0, scale: 1 }

/** 지느러미가 지나간 자리. 그리는 데만 쓴다. */
let wake = []
/** 먹은 자리에 퍼지는 동심원. */
let ripples = []

// MARK: 화면

/**
 * 레티나 배율은 **여기서 한 번만** 건다. draw() 안에서 setTransform 을 부르면
 * 배율이 지워져 화면 왼쪽 위 1/4 에만 그려진다 — 불꽃놀이에서 이미 겪었다.
 */
function resize() {
  const dpr = window.devicePixelRatio || 1
  const width = document.body.clientWidth
  const height = document.body.clientHeight

  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const scale = Math.min(width, height)
  view = { width, height, scale }
  engine = setBounds(engine, { w: width / scale, h: height / scale })
}

window.addEventListener('resize', resize)

// MARK: 루프 — 고정 타임스텝

let accumulator = 0
let previous = performance.now()

function frame(timestamp) {
  const frameSeconds = Math.min(0.25, (timestamp - previous) / 1000)
  previous = timestamp
  accumulator += frameSeconds

  const now = Date.now()
  while (accumulator >= DT) {
    engine = step(engine, now, DT)
    accumulator -= DT
    afterStep()
  }

  ageTrails(frameSeconds)
  draw(ctx, view, snapshot(engine), { wake, ripples })
  requestAnimationFrame(frame)
}

/** 한 스텝 뒤에 붙는 것들 — 물살 자국, 먹었을 때의 저장과 동심원. */
function afterStep() {
  const snap = snapshot(engine)

  if (snap.alpha > 0.02) {
    wake.push({
      x: engine.swimmer.x, y: engine.swimmer.y, heading: engine.swimmer.heading, age: 0,
    })
  }

  if (engine.justAte) {
    const mouthX = engine.swimmer.x
    const mouthY = engine.swimmer.y
    ripples.push({ x: mouthX, y: mouthY, age: 0, duration: 1.1, maxRadius: 0.12 })
    saveState()
    flashHud()
  }
}

function ageTrails(dt) {
  wake = wake.map((w) => ({ ...w, age: w.age + dt })).filter((w) => w.age < 1.6)
  ripples = ripples.map((r) => ({ ...r, age: r.age + dt })).filter((r) => r.age < r.duration)
}

// MARK: 눈금

function refreshHud() {
  const snap = snapshot(engine)
  document.getElementById('hud-stage').textContent = `${snap.stage}단계`
  document.getElementById('hud-hunger').textContent = hungerLabel(snap.hunger)

  const left = toNextStage(snap.eaten)
  document.getElementById('hud-next').textContent =
    left === null ? '다 컸다' : `다음까지 ${left}점`

  bridge?.setStatus?.({ stage: snap.stage, hunger: hungerLabel(snap.hunger), eaten: snap.eaten })
}

// MARK: 저장

function saveState() {
  bridge?.saveState?.({ eaten: engine.eaten, lastFedAt: engine.lastFedAt })
}

// MARK: 밥 주기
//
// **클릭도 타자도 이 창으로 오지 않는다.** 창은 마우스를 언제나 밑의 앱으로 흘려보내고
// (그래야 일을 계속할 수 있다), 셸이 화면 어디서 눌렸는지 **엿듣기만** 해서 알려 준다.
// 누르던 버튼은 그대로 눌리고 치던 글자는 그대로 찍힌다 — 밥은 덤으로 떨어진다.

/** 셸이 전역으로 들은 클릭. 화면 좌표(CSS 픽셀)로 온다. */
bridge?.onFeed?.((x, y) => {
  engine = feedAt(engine, x / view.scale, y / view.scale, 'big')
  ensureAccount()
  flashHud()
})

/** 셸이 전역으로 들은 타자. 자리는 게임이 정한다 — 어디를 쳤는지는 알 수 없고 알 것도 없다. */
bridge?.onType?.(() => {
  const before = engine.food.length
  engine = feedTyped(engine)
  if (engine.food.length !== before) flashHud()
})

// 셸이 없을 때(브라우저로 열었을 때)만 페이지에서 직접 받는다. 실제 앱에서는
// 창이 클릭을 안 받으므로 이 길로 오지 않는다.
if (!bridge) {
  canvas.addEventListener('pointerdown', (event) => {
    engine = feedAt(engine, event.clientX / view.scale, event.clientY / view.scale, 'big')
  })
  window.addEventListener('keydown', () => { engine = feedTyped(engine) })
}

// MARK: 셸이 부르는 것

/**
 * 눈금은 **밥을 줬을 때만 잠깐** 뜬다.
 *
 * 밥 주기가 늘 켜져 있으므로 눈금을 계속 띄워 두면 화면 위쪽에 영영 붙어 있는 띠가
 * 된다. 방금 무슨 일이 일어났는지만 알려 주고 사라지는 편이 낫다.
 */
let hudTimer = null

function flashHud() {
  refreshHud()
  hud.hidden = false
  hud.classList.remove('fading')
  clearTimeout(hudTimer)
  hudTimer = setTimeout(() => {
    hud.classList.add('fading')
    hudTimer = setTimeout(() => { hud.hidden = true }, 600)
  }, 2600)
}

function applyGameMode(on) {
  engine = setGameMode(engine, on)
  if (!on) panel.hidden = true
  flashHud()
}

bridge?.onGameMode?.((on) => applyGameMode(on))

// 셸이 패널의 열림 여부를 들고 있다 — 열 때 창이 키보드를 받아야 해서
// (별명을 타이핑해야 한다) 셸 쪽이 먼저 알아야 하기 때문이다.
bridge?.onPanel?.((open) => {
  panel.hidden = !open
  if (open && rankingOn) refreshRanking()
})

/** 셸이 저장해 둔 랭킹 스위치를 받아 온다. */
bridge?.onRanking?.((on) => applyRanking(on, false))

document.getElementById('close-panel').addEventListener('click', () => {
  // 셸이 패널 상태를 들고 있으므로(포커스를 넘겼다 돌려받아야 한다) 셸에 맡긴다.
  bridge?.closePanel?.()
  panel.hidden = true
})

document.getElementById('ranking-on').addEventListener('change', (event) => {
  applyRanking(event.target.checked, true)
})

/**
 * 랭킹을 켜고 끈다. 끄면 **아무것도 서버로 안 보낸다** — 밀린 줄도 버린다.
 * 상어는 그대로 자란다. 랭킹은 게임이 아니라 곁다리이므로 꺼도 잃는 것이 없어야 한다.
 */
function applyRanking(on, save) {
  rankingOn = !!on
  document.getElementById('ranking-on').checked = rankingOn
  panel.classList.toggle('ranking-off', !rankingOn)
  if (save) bridge?.saveRanking?.(rankingOn)
  if (rankingOn && !panel.hidden) refreshRanking()
}

// MARK: 서버 — 없어도 게임은 전부 된다

/**
 * 밀린 것을 흘려보낸다. **실패는 조용히 삼킨다** —
 * 랭킹이 안 되는 것과 게임이 안 되는 것은 다른 일이다.
 */
/**
 * 계정이 없으면 **첫 밥을 준 순간 임의 별명으로 만든다.**
 *
 * 이름부터 정하라고 하면 대부분 패널을 열지 않고, 열지 않으면 랭킹이 비어 있다.
 * 먼저 올려 두고 이름은 나중에 바꾸게 한다 — 바꿔도 같은 계정이다.
 * 실패는 조용히 삼킨다. 다음 밥에서 다시 해 본다.
 */
async function ensureAccount() {
  if (account.playerId || registering || !rankingOn) return
  registering = true
  try {
    const secret = newSecret(randomBytes)
    let nickname = defaultNickname(randomBytes)
    let playerId = null

    // 이름이 겹치면 몇 번 다시 뽑는다 — 네 자리 숫자라 드물지만 사람이 늘면 부딪힌다.
    for (let attempt = 0; attempt < 5 && !playerId; attempt += 1) {
      try {
        playerId = await registerPlayer(nickname, secret)
      } catch (error) {
        if (!error.message.includes('nickname_taken')) throw error
        nickname = defaultNickname(randomBytes)
      }
    }
    if (!playerId) return

    account = { playerId, secret, nickname }
    bridge?.saveAccount?.(account)
    showAccount()
  } catch (error) {
    console.error(`자동 등록 실패 (다음에 다시): ${error.message}`)
  } finally {
    registering = false
  }
}

async function flush() {
  if (!rankingOn || engine.pending <= 0) return
  if (!account.playerId) {
    await ensureAccount()
    return
  }

  const count = nextBatch(engine.pending)
  try {
    const rows = await feedShark(account.playerId, account.secret, count)
    engine = { ...engine, pending: dropBatch(engine.pending, count) }

    // 서버가 매긴 누적치. 오프라인에서 키운 것을 잃지 않으려고 큰 쪽을 쓴다.
    const server = Array.isArray(rows) ? rows[0]?.eaten : rows?.eaten
    const merged = mergeEaten(engine.eaten, server)
    if (merged !== engine.eaten) {
      engine = { ...engine, eaten: merged }
      saveState()
      refreshHud()
    }
  } catch (error) {
    console.error(`올리기 실패 (다음에 다시): ${error.message}`)
  }
}

setInterval(flush, 3000)

async function refreshRanking() {
  const list = document.getElementById('ranking-list')
  const mine = document.getElementById('my-rank')

  try {
    const rows = await sharkRanking(20)
    list.innerHTML = ''
    if (!rows || rows.length === 0) {
      list.innerHTML = '<li class="muted">아직 아무도 없습니다. 첫 번째가 되세요.</li>'
    }
    for (const row of rows ?? []) {
      const li = document.createElement('li')
      if (row.player_id === account.playerId) li.className = 'me'
      li.innerHTML = '<span class="rank"></span><span class="name"></span><span class="eaten"></span>'
      li.querySelector('.rank').textContent = row.rank
      li.querySelector('.name').textContent = row.nickname
      li.querySelector('.eaten').textContent = `${row.stage}단계 · ${row.eaten}점`
      list.appendChild(li)
    }

    if (account.playerId) {
      const rows2 = await myShark(account.playerId)
      const me = Array.isArray(rows2) ? rows2[0] : rows2
      mine.textContent = me && me.rank > 0 ? `— 내 순위 ${me.rank} / ${me.total_players}` : ''
    }
  } catch (error) {
    list.innerHTML = '<li class="muted">랭킹을 못 불러왔습니다.</li>'
    console.error(`랭킹 실패: ${error.message}`)
  }
}

// MARK: 계정 — 몰래 야구와 공용

function showAccount() {
  const state = document.getElementById('account-state')
  const codeBox = document.getElementById('my-code')

  if (account.playerId) {
    state.textContent = `${account.nickname} 으로 랭킹에 오릅니다. 이름은 바꿔도 됩니다.`
    document.getElementById('nickname').value = account.nickname ?? ''
    codeBox.textContent = recoveryCode(account.playerId, account.secret)
  } else {
    state.textContent = '첫 밥을 주면 이름이 자동으로 만들어집니다.'
    codeBox.textContent = ''
  }
}

document.getElementById('save-nickname').addEventListener('click', async () => {
  const input = document.getElementById('nickname')
  const nickname = input.value.trim() || defaultNickname(randomBytes)
  const state = document.getElementById('account-state')

  try {
    if (account.playerId) {
      await setNickname(account.playerId, account.secret, nickname)
      account = { ...account, nickname }
    } else {
      const secret = newSecret(randomBytes)
      const playerId = await registerPlayer(nickname, secret)
      account = { playerId, secret, nickname }
    }
    bridge?.saveAccount?.(account)
    showAccount()
    refreshRanking()
    flush()
  } catch (error) {
    state.textContent = error.message.includes('nickname_taken')
      ? '이미 쓰는 이름입니다.'
      : '저장하지 못했습니다.'
  }
})

document.getElementById('use-code').addEventListener('click', async () => {
  const state = document.getElementById('account-state')
  const parsed = parseRecoveryCode(document.getElementById('code').value)
  if (!parsed) {
    state.textContent = '코드 모양이 맞지 않습니다.'
    return
  }

  try {
    const ok = await verifyCode(parsed.playerId, parsed.secret)
    if (!ok) {
      state.textContent = '맞지 않는 코드입니다.'
      return
    }
    account = { ...parsed, nickname: account.nickname }
    // 이 계정의 상어를 받아 온다. 이 기기에서 키운 것과 큰 쪽을 쓴다.
    const rows = await myShark(parsed.playerId)
    const me = Array.isArray(rows) ? rows[0] : rows
    engine = { ...engine, eaten: mergeEaten(engine.eaten, me?.eaten) }

    bridge?.saveAccount?.(account)
    saveState()
    refreshHud()
    showAccount()
    refreshRanking()
  } catch (error) {
    state.textContent = '불러오지 못했습니다.'
  }
})

// MARK: 시작

async function start() {
  resize()

  const saved = (await bridge?.getState?.()) ?? {}
  engine = createEngine({
    eaten: saved.eaten ?? 0,
    lastFedAt: saved.lastFedAt ?? null,
    seed: (Date.now() & 0xffff) | 1,
    bounds: engine.bounds,
    now: Date.now(),
  })

  if (saved.ranking === false) applyRanking(false, false)

  if (saved.playerId && saved.secret) {
    account = { playerId: saved.playerId, secret: saved.secret, nickname: saved.nickname ?? null }
    // 서버가 더 많이 알고 있으면 받아 온다(다른 기기에서 키웠을 수 있다).
    myShark(account.playerId)
      .then((rows) => {
        const me = Array.isArray(rows) ? rows[0] : rows
        const merged = mergeEaten(engine.eaten, me?.eaten)
        if (merged !== engine.eaten) {
          engine = { ...engine, eaten: merged }
          saveState()
          refreshHud()
        }
      })
      .catch(() => {})
  }

  showAccount()
  flashHud()
  requestAnimationFrame(frame)
}

start()
