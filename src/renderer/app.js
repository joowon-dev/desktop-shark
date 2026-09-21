// 캔버스·브리지·루프. **게임 규칙은 여기 없다** — src/game/ 에 있다.
//
// 여기는 순수 모듈이 못 하는 것만 한다: 벽시계를 읽고, 화면 크기를 재고, 클릭을 받고,
// 셸과 이야기하고, 서버에 올린다.

import { DT } from '../game/constants.js'
import {
  createEngine, feedAt, setBounds, setGameMode, snapshot, step,
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
    refreshHud()
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
    left === null ? '다 컸다' : `다음까지 ${left}`

  bridge?.setStatus?.({ stage: snap.stage, hunger: hungerLabel(snap.hunger), eaten: snap.eaten })
}

// MARK: 저장

function saveState() {
  bridge?.saveState?.({ eaten: engine.eaten, lastFedAt: engine.lastFedAt })
}

// MARK: 밥 주기

/**
 * 게임모드에서만 클릭이 여기까지 온다 — 그 밖에는 셸이 창째로 클릭을 통과시켜서
 * 이 핸들러가 아예 안 불린다. 그래도 한 번 더 확인한다: 패널을 연 채로 누른 클릭이
 * 밥이 되면 안 된다.
 */
canvas.addEventListener('pointerdown', (event) => {
  if (!engine.gameMode) return
  engine = feedAt(engine, event.clientX / view.scale, event.clientY / view.scale)
})

// MARK: 셸이 부르는 것

function applyGameMode(on) {
  engine = setGameMode(engine, on)
  hud.hidden = !on
  if (!on) panel.hidden = true
  refreshHud()
}

bridge?.onGameMode?.((on) => applyGameMode(on))

// 셸이 패널의 열림 여부를 들고 있다 — 열 때 창이 키보드를 받아야 해서
// (별명을 타이핑해야 한다) 셸 쪽이 먼저 알아야 하기 때문이다.
bridge?.onPanel?.((open) => {
  panel.hidden = !open
  if (open) refreshRanking()
})

// MARK: 서버 — 없어도 게임은 전부 된다

/**
 * 밀린 것을 흘려보낸다. **실패는 조용히 삼킨다** —
 * 랭킹이 안 되는 것과 게임이 안 되는 것은 다른 일이다.
 */
async function flush() {
  if (!account.playerId || engine.pending <= 0) return

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
      li.querySelector('.eaten').textContent = `${row.stage}단계 · ${row.eaten}개`
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
    state.textContent = `${account.nickname} 으로 랭킹에 오릅니다.`
    document.getElementById('nickname').value = account.nickname ?? ''
    codeBox.textContent = recoveryCode(account.playerId, account.secret)
  } else {
    state.textContent = '계정이 없습니다. 랭킹에 올리려면 이름을 정하세요.'
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
  refreshHud()
  requestAnimationFrame(frame)
}

start()
