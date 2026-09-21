import { describe, expect, it } from 'vitest'
import {
  createEngine, feedAt, feedTyped, mouthOf, setGameMode, snapshot, step,
} from '../src/game/engine.js'
import {
  DT, EAT_RADIUS, EAT_REACH, FOOD_KINDS, MAX_FOOD, TAIL_MAX_SWING, TYPE_FEED_INTERVAL,
} from '../src/game/constants.js'

const bounds = { w: 16 / 9, h: 1 }

/** 상어가 밥을 먹을 때까지 굴린다. 못 먹으면 null. */
function runUntilEaten(engine, seconds = 60) {
  let e = engine
  let now = e.now
  for (let i = 0; i < seconds * 60; i += 1) {
    now += DT * 1000
    e = step(e, now, DT)
    if (e.justAte) return e
  }
  return null
}

describe('밥을 주면 달려와서 먹는다', () => {
  it('화면 한가운데 떨어뜨리면 결국 먹는다', () => {
    // **이 게임의 핵심 약속이다.** 이게 깨지면 나머지가 다 맞아도 게임이 아니다.
    let e = createEngine({ lastFedAt: 0, seed: 3, bounds, now: 0 })
    e = feedAt(e, bounds.w / 2, 0.5)

    const eaten = runUntilEaten(e)
    expect(eaten).not.toBe(null)
    expect(eaten.total).toBe(FOOD_KINDS.big.value)
    expect(eaten.food).toHaveLength(0)
  })

  it('화면 구석에 떨어뜨려도 먹는다', () => {
    for (const [x, y] of [[0.1, 0.1], [bounds.w - 0.1, 0.1], [0.1, 0.9], [bounds.w - 0.1, 0.9]]) {
      let e = createEngine({ lastFedAt: 0, seed: 11, bounds, now: 0 })
      e = feedAt(e, x, y)
      expect(runUntilEaten(e), `(${x}, ${y})`).not.toBe(null)
    }
  })

  it('먹으면 배고픔 시계가 0 으로 돌아간다', () => {
    const start = 10 * 60 * 60 * 1000 // 굶은 지 오래
    let e = createEngine({ lastFedAt: 0, seed: 5, bounds, now: start })
    expect(snapshot(e).hunger).toBe(1)

    e = feedAt(e, bounds.w / 2, 0.5)
    const eaten = runUntilEaten(e)
    expect(eaten).not.toBe(null)
    expect(snapshot(eaten).hunger).toBe(0)
  })

  it('먹은 만큼 서버에 올릴 줄이 는다', () => {
    let e = createEngine({ lastFedAt: 0, seed: 5, bounds, now: 0 })
    expect(e.pending).toBe(0)
    e = feedAt(e, bounds.w / 2, 0.5)
    const eaten = runUntilEaten(e)
    expect(eaten.pending).toBe(FOOD_KINDS.big.value)
  })
})

describe('밥 두 종류', () => {
  it('큰 밥이 작은 밥보다 값지다 — 클릭은 일부러, 타자는 무심코', () => {
    // 값이 같으면 타이핑만으로 몇 분 만에 다 커서 키우는 일이 사라진다.
    // 열 배다. 비슷하면 타이핑만으로 다 커 버린다.
    expect(FOOD_KINDS.big.value).toBe(10)
    expect(FOOD_KINDS.small.value).toBe(1)
    expect(FOOD_KINDS.big.value / FOOD_KINDS.small.value).toBeGreaterThanOrEqual(10)
  })

  it('밥은 작다 — 바탕화면 위에 늘 떠 있어서 눈에 띄면 거슬린다', () => {
    expect(FOOD_KINDS.big.radius).toBeLessThanOrEqual(0.006)
    expect(FOOD_KINDS.small.radius).toBeLessThanOrEqual(0.003)
    expect(FOOD_KINDS.big.radius).toBeGreaterThan(FOOD_KINDS.small.radius)
  })

  it('큰 밥을 먹으면 10, 작은 밥을 먹으면 1 오른다', () => {
    for (const [kind, gain] of [['big', 10], ['small', 1]]) {
      let e = createEngine({ lastFedAt: 0, seed: 3, bounds, now: 0 })
      e = feedAt(e, bounds.w / 2, 0.5, kind)
      const eaten = runUntilEaten(e)
      expect(eaten, kind).not.toBe(null)
      expect(eaten.total, kind).toBe(gain)
    }
  })

  it('클릭은 큰 밥, 타자는 작은 밥이다', () => {
    let e = createEngine({ seed: 1, bounds, now: 0 })
    e = feedAt(e, 0.5, 0.5)
    expect(e.food[0].kind).toBe('big')

    e = feedTyped(e)
    expect(e.food[1].kind).toBe('small')
  })
})

describe('feedTyped', () => {
  it('타자 밥은 화면 안 아무 데나 떨어진다', () => {
    let e = createEngine({ seed: 7, bounds, now: 0 })
    const spots = []
    for (let i = 0; i < 20; i += 1) {
      e = feedTyped({ ...e, lastTypedAt: -Infinity })
      const last = e.food[e.food.length - 1]
      if (last) spots.push(last)
      e = { ...e, food: [] } // 자리만 보려고 비운다
    }
    expect(spots.length).toBeGreaterThan(5)
    for (const f of spots) {
      expect(f.x).toBeGreaterThan(0)
      expect(f.x).toBeLessThan(bounds.w)
      expect(f.y).toBeGreaterThan(0)
      expect(f.y).toBeLessThan(bounds.h)
    }
    // 매번 같은 자리면 「아무 데나」가 아니다.
    expect(new Set(spots.map((f) => `${f.x.toFixed(3)},${f.y.toFixed(3)}`)).size).toBeGreaterThan(5)
  })

  it(`${TYPE_FEED_INTERVAL}초에 한 번만 받는다 — 연타로 화면을 채우지 않는다`, () => {
    let e = createEngine({ seed: 1, bounds, now: 0 })
    // 같은 순간에 스무 번 친다
    for (let i = 0; i < 20; i += 1) e = feedTyped(e)
    expect(e.food).toHaveLength(1)

    // 간격이 지나면 하나 더 받는다
    e = { ...e, elapsed: TYPE_FEED_INTERVAL + 0.01 }
    e = feedTyped(e)
    expect(e.food).toHaveLength(2)
  })

  it('넘치는 입력은 줄을 세우지 않고 버린다', () => {
    // 줄을 세우면 손을 뗀 뒤에도 한참 떨어져서 「내가 친 것」이라는 느낌이 끊긴다.
    let e = createEngine({ seed: 1, bounds, now: 0 })
    for (let i = 0; i < 50; i += 1) e = feedTyped(e)
    e = { ...e, elapsed: 100 }
    e = feedTyped(e)
    expect(e.food).toHaveLength(2)
  })
})

describe('밥 주기를 끄면', () => {
  it('클릭도 타자도 밥이 안 된다 — 남이 볼 때 쓰는 기능이다', () => {
    let e = setGameMode(createEngine({ seed: 1, bounds, now: 0 }), false)
    e = feedAt(e, 0.5, 0.5)
    e = feedTyped(e)
    expect(e.food).toHaveLength(0)
  })
})

describe('feedAt', () => {
  it('가득 차면 더 안 떨어진다', () => {
    let e = createEngine({ seed: 1, bounds, now: 0 })
    for (let i = 0; i < MAX_FOOD + 3; i += 1) e = feedAt(e, 0.2 + i * 0.05, 0.5)
    expect(e.food).toHaveLength(MAX_FOOD)
  })
})

describe('mouthOf', () => {
  it('입은 몸통 앞쪽 끝이다', () => {
    const e = createEngine({ seed: 1, bounds, now: 0 })
    const half = snapshot(e).length / 2
    const mouth = mouthOf(e)
    expect(Math.hypot(mouth.x - e.swimmer.x, mouth.y - e.swimmer.y)).toBeCloseTo(half, 9)
  })

  it('입 크기는 몸 길이를 안 넘는다 — 제 몸보다 먼 밥을 삼키면 안 된다', () => {
    for (const eaten of [0, 700, 2200, 5500, 10500, 18000]) {
      const e = createEngine({ grown: { white: eaten }, bounds, now: 0 })
      const reach = Math.max(EAT_RADIUS, snapshot(e).length * EAT_REACH)
      expect(reach, `${eaten}점`).toBeLessThanOrEqual(snapshot(e).length)
    }
  })

  it('상어가 크면 입이 몸통에서 더 멀다', () => {
    const small = createEngine({ seed: 1, bounds, now: 0 })
    const big = createEngine({ grown: { white: 18000 }, seed: 1, bounds, now: 0 })
    const reach = (e) => Math.hypot(mouthOf(e).x - e.swimmer.x, mouthOf(e).y - e.swimmer.y)
    expect(reach(big)).toBeGreaterThan(reach(small))
  })
})

describe('snapshot', () => {
  it('밥 주기를 켜면 더 진해진다', () => {
    let e = createEngine({ grown: { white: 20 }, lastFedAt: 0, seed: 1, bounds, now: 0 })
    // 숨어 있으면 배율이 0 이라 차이가 안 난다. 순찰로 옮겨 놓고 잰다.
    e = { ...e, brain: { ...e.brain, state: 'cruise' } }
    const off = snapshot(setGameMode(e, false)).alpha
    const on = snapshot(setGameMode(e, true)).alpha
    expect(on).toBeGreaterThan(off)
  })

  it('기본은 켜짐이다 — 앱을 띄우면 늘 상어가 먹고 있다', () => {
    expect(createEngine({ bounds, now: 0 }).gameMode).toBe(true)
  })

  it('키운 점수가 단계로 이어진다', () => {
    expect(snapshot(createEngine({ bounds, now: 0 })).stage).toBe(1)
    expect(snapshot(createEngine({ grown: { white: 5500 }, bounds, now: 0 })).stage).toBe(4)
  })
})

describe('상어는 화면 밖으로 안 나간다', () => {
  // **이게 이 게임의 전제다.** 나가 버리면 「바탕화면에 산다」가 아니라 「가끔
  // 지나간다」가 되고, 밥을 줘도 한참을 기다려야 한다. 오래 굴려서 확인한다.
  it.each([
    ['가로로 넓은 화면', { w: 16 / 9, h: 1 }],
    ['세로로 긴 화면', { w: 1, h: 16 / 9 }],
    ['정사각 화면', { w: 1, h: 1 }],
    ['아주 넓은 화면', { w: 3.2, h: 1 }],
  ])('%s — 10분 동안 한 번도 안 나간다', (_label, screen) => {
    for (const seed of [1, 7, 42, 1234]) {
      let e = createEngine({ lastFedAt: 0, seed, bounds: screen, now: 0 })
      let now = 0
      let worst = { x: 0, y: 0, out: 0 }

      for (let i = 0; i < 60 * 600; i += 1) {
        now += DT * 1000
        e = step(e, now, DT)
        const out = Math.max(
          -e.swimmer.x, e.swimmer.x - screen.w,
          -e.swimmer.y, e.swimmer.y - screen.h,
        )
        if (out > worst.out) worst = { x: e.swimmer.x, y: e.swimmer.y, out }
      }

      // 몸 길이의 절반쯤은 코가 걸칠 수 있다. 통째로 나가면 안 된다.
      expect(worst.out, `seed ${seed} 에서 (${worst.x.toFixed(2)}, ${worst.y.toFixed(2)})`)
        .toBeLessThan(0.1)
    }
  })

  it('**밥을 쫓는 동안에도 화면 안이다** — 가라앉는 밥을 따라 내려가지 않는다', () => {
    // 실제로 겪은 것이다: 밥이 화면 밖까지 가라앉는데 돌진에는 벽 보정이 없어서
    // 상어가 안 보이는 아래까지 따라 내려갔다. 타자를 계속 치는 상황을 흉내 낸다.
    const screen = { w: 16 / 9, h: 1 }
    let e = createEngine({ lastFedAt: 0, seed: 21, bounds: screen, now: 0 })
    let now = 0
    let lowest = 0

    for (let i = 0; i < 60 * 600; i += 1) {
      now += DT * 1000
      // 0.6 초마다 한 번씩 타자 밥이 떨어진다 — 쉬지 않고 치는 사람.
      if (i % 36 === 0) e = feedTyped(e)
      if (i % 600 === 0) e = feedAt(e, screen.w * 0.5, 0.5)
      e = step(e, now, DT)
      lowest = Math.max(lowest, e.swimmer.y - screen.h)
    }

    expect(lowest, `화면 아래로 ${lowest.toFixed(3)} 만큼 내려갔다`).toBeLessThan(0.05)
  })

  it('밥이 화면 밖으로 가라앉지 않는다', () => {
    const screen = { w: 16 / 9, h: 1 }
    let e = createEngine({ lastFedAt: 0, seed: 8, bounds: screen, now: 0 })
    let now = 0
    for (let i = 0; i < 60 * 300; i += 1) {
      now += DT * 1000
      if (i % 40 === 0) e = feedTyped(e)
      e = step(e, now, DT)
      for (const f of e.food) expect(f.y).toBeLessThanOrEqual(screen.h)
    }
  })

  it('**테두리를 클릭해도** 상어가 화면 밖으로 안 밀려난다', () => {
    // 돌진한 상어는 목표를 지나친다. 테두리에 딱 붙은 밥을 먹으면 그만큼 밖으로
    // 나가므로, 밥을 조금 안쪽으로 당겨 둬야 한다(FOOD_INSET).
    const screen = { w: 16 / 9, h: 1 }
    const edges = [
      [0, 0], [screen.w, 0], [0, screen.h], [screen.w, screen.h],
      [screen.w / 2, 0], [screen.w / 2, screen.h], [0, screen.h / 2], [screen.w, screen.h / 2],
    ]

    for (const [ex, ey] of edges) {
      let e = createEngine({ lastFedAt: 0, seed: 17, bounds: screen, now: 0 })
      let now = 0
      let worst = 0
      for (let i = 0; i < 60 * 90; i += 1) {
        now += DT * 1000
        // 그 구석만 계속 클릭한다.
        if (i % 120 === 0) e = feedAt(e, ex, ey)
        e = step(e, now, DT)
        worst = Math.max(worst,
          -e.swimmer.x, e.swimmer.x - screen.w, -e.swimmer.y, e.swimmer.y - screen.h)
      }
      expect(worst, `(${ex.toFixed(2)}, ${ey.toFixed(2)}) 에서 ${worst.toFixed(3)} 만큼 나갔다`)
        .toBeLessThan(0.06)
    }
  })

  it('밖에 있는 채로 시작해도 돌아온다 — 화면이 바뀌면 밖에 남을 수 있다', () => {
    // 모니터를 바꾸거나 해상도가 줄면 상어가 새 화면 밖에 있게 된다. 밥을 쫓는
    // 중이어도 일단 화면 안으로 돌아와야 한다.
    const screen = { w: 16 / 9, h: 1 }
    let e = createEngine({ lastFedAt: 0, seed: 2, bounds: screen, now: 0 })
    e = { ...e, swimmer: { x: screen.w + 0.6, y: screen.h + 0.6, heading: 0.4, speed: 0.2 } }
    e = feedAt(e, screen.w * 0.5, screen.h * 0.5)

    let now = 0
    let came = false
    for (let i = 0; i < 60 * 30 && !came; i += 1) {
      now += DT * 1000
      e = step(e, now, DT)
      came = e.swimmer.x < screen.w && e.swimmer.y < screen.h
        && e.swimmer.x > 0 && e.swimmer.y > 0
    }
    expect(came, '30초 안에 화면 안으로 못 돌아왔다').toBe(true)
  })

  it('굶어서 에워싸는 동안에도 화면 안이다', () => {
    const screen = { w: 16 / 9, h: 1 }
    let e = createEngine({ lastFedAt: null, seed: 5, bounds: screen, now: 0 })
    let now = 0
    for (let i = 0; i < 60 * 300; i += 1) {
      now += DT * 1000
      e = step(e, now, DT)
      expect(e.swimmer.x).toBeGreaterThan(-0.1)
      expect(e.swimmer.x).toBeLessThan(screen.w + 0.1)
      expect(e.swimmer.y).toBeGreaterThan(-0.1)
      expect(e.swimmer.y).toBeLessThan(screen.h + 0.1)
    }
  })

  it('처음부터 화면 안에 있다 — 밖에서 들어오길 기다리지 않는다', () => {
    const e = createEngine({ bounds, now: 0 })
    expect(e.swimmer.x).toBeGreaterThan(0)
    expect(e.swimmer.x).toBeLessThan(bounds.w)
    expect(e.swimmer.y).toBeGreaterThan(0)
    expect(e.swimmer.y).toBeLessThan(bounds.h)
  })
})

describe('결정론', () => {
  it('같은 씨앗·같은 입력이면 같은 결과다', () => {
    const run = () => {
      let e = createEngine({ lastFedAt: 0, seed: 42, bounds, now: 0 })
      e = feedAt(e, 1.0, 0.3)
      let now = 0
      for (let i = 0; i < 600; i += 1) {
        now += DT * 1000
        e = step(e, now, DT)
      }
      return { x: e.swimmer.x, y: e.swimmer.y, total: e.total, state: e.brain.state }
    }
    expect(run()).toEqual(run())
  })
})

describe('꼬리', () => {
  // **이게 「빠르게 헤엄칠 때 꼬리가 부자연스럽다」의 정체였다.**
  // 예전에는 위상을 `elapsed * (6 + speed * 30)` 으로 구했다. 속력이 바뀌면 지나간
  // 시간 전체의 위상이 한꺼번에 다시 계산되어 꼬리가 순간이동한다.
  it('속력이 갑자기 바뀌어도 위상이 튀지 않는다', () => {
    let e = createEngine({ lastFedAt: 0, seed: 3, bounds, now: 0 })
    let now = 0

    // 한참 느리게 헤엄치게 둔다 — 튐은 「지나간 시간」이 길수록 커진다.
    for (let i = 0; i < 60 * 120; i += 1) {
      now += DT * 1000
      e = step(e, now, DT)
    }

    // 여기서 돌진시킨다.
    e = feedAt(e, bounds.w * 0.5, 0.5)

    let previous = e.tailPhase
    let biggest = 0
    for (let i = 0; i < 60 * 10; i += 1) {
      now += DT * 1000
      e = step(e, now, DT)
      biggest = Math.max(biggest, Math.abs(e.tailPhase - previous))
      previous = e.tailPhase
    }

    // 한 프레임에 젓는 각도는 제일 빨라도 (5.5 + 0.22×26) / 60 ≈ 0.19 라디안이다.
    // 0.4 를 넘으면 위상이 건너뛴 것이다.
    expect(biggest, `한 프레임에 ${biggest.toFixed(2)} 라디안이나 건너뛰었다`)
      .toBeLessThan(0.4)
  })

  it('위상은 뒤로 가지 않는다', () => {
    let e = createEngine({ lastFedAt: null, seed: 9, bounds, now: 0 })
    let now = 0
    let previous = e.tailPhase
    for (let i = 0; i < 60 * 60; i += 1) {
      now += DT * 1000
      e = step(e, now, DT)
      expect(e.tailPhase).toBeGreaterThanOrEqual(previous)
      previous = e.tailPhase
    }
  })

  it('빠를수록 자주, 크게 젓는다', () => {
    const slow = { ...createEngine({ bounds, now: 0 }), swimmer: { x: 0.5, y: 0.5, heading: 0, speed: 0.02 } }
    const fast = { ...createEngine({ bounds, now: 0 }), swimmer: { x: 0.5, y: 0.5, heading: 0, speed: 0.22 } }
    expect(snapshot(fast).tailSwing).toBeGreaterThan(snapshot(slow).tailSwing)

    const after = (e) => step(e, 1000, DT).tailPhase
    expect(after(fast)).toBeGreaterThan(after(slow))
  })

  it('젓는 폭에 상한이 있다 — 아무리 빨라도 몸이 접히면 안 된다', () => {
    const crazy = { ...createEngine({ bounds, now: 0 }), swimmer: { x: 0.5, y: 0.5, heading: 0, speed: 99 } }
    expect(snapshot(crazy).tailSwing).toBe(TAIL_MAX_SWING)
  })
})

describe('밥을 빙글빙글 돌기만 하지 않는다', () => {
  // **실제로 겪은 증상이다.** 돌진 속력을 선회 속도로 나눈 것이 최소 선회 반경인데,
  // 그게 먹힘 반경보다 크면 상어는 제 선회 원 안쪽의 밥에 영원히 못 닿는다.
  // 밥 둘레를 돌다가 수명이 다해 사라질 때까지 못 먹는다.
  it.each([1, 3, 6])('%i단계 — 어느 방향에서 시작해도 먹는다', (stage) => {
    const grown = { white: [0, 700, 2200, 5500, 10500, 18000][stage - 1] }
    const failures = []

    for (let angle = 0; angle < 12; angle += 1) {
      for (const distance of [0.05, 0.12, 0.3]) {
        const heading = (angle / 12) * Math.PI * 2
        let e = createEngine({ grown, lastFedAt: 0, seed: 4, bounds, now: 0 })
        // 밥을 코앞 옆쪽에 두고 전속력으로 지나가게 만든다 — 제일 어려운 경우다.
        e = {
          ...e,
          swimmer: { x: bounds.w / 2, y: 0.5, heading: 0, speed: 0.22 },
        }
        e = feedAt(e,
          bounds.w / 2 + Math.cos(heading) * distance,
          0.5 + Math.sin(heading) * distance)

        let now = 0
        let ate = false
        // 밥 수명(20초) 안에 먹어야 한다.
        for (let i = 0; i < 60 * 19 && !ate; i += 1) {
          now += DT * 1000
          e = step(e, now, DT)
          if (e.justAte) ate = true
        }
        if (!ate) failures.push(`${(heading * 180 / Math.PI).toFixed(0)}° / ${distance}`)
      }
    }

    expect(failures, `못 먹은 경우: ${failures.join(', ')}`).toEqual([])
  })
})

describe('밥 곁에서 맴돌기만 하지 않는다', () => {
  /**
   * **실제로 겪은 증상이다** — 상어가 밥 둘레를 빙글빙글 돌다가 밥이 수명을 다해
   * 사라질 때까지 못 먹었다.
   *
   * 원인이 셋이었다.
   *  1. 먹는 것은 **입**으로 재는데 헤엄치는 것은 **몸 중심**이라, 중심을 밥에 맞추면
   *     입은 몸 절반만큼 지나쳐 있다. 3 단계부터는 몸 절반이 먹힘 반경보다 커서
   *     중심을 정확히 맞춰도 입이 안 닿는다.
   *  2. 전속력의 선회 반경이 먹힘 반경보다 커서 제 선회 원 안쪽에 못 닿는다.
   *  3. 밥이 여럿이면 매 프레임 목표가 뒤바뀌어 그 사이를 맴돈다.
   *
   * 한 개만 놓고 보면 어느 경우든 결국 먹어서 안 드러난다. **곁에 오래 있었는데도
   * 못 먹었는가**로 봐야 잡힌다.
   */
  it('상어가 곁에 오래 있었으면 반드시 먹는다', () => {
    const screen = { w: 16 / 9, h: 1 }
    let orbited = 0

    for (const stage of [1, 3, 6]) {
      for (const seed of [3, 11, 29]) {
        let e = createEngine({
          grown: { white: [0, 700, 2200, 5500, 10500, 18000][stage - 1] },
          lastFedAt: 0, seed, bounds: screen, now: 0,
        })
        let now = 0
        const near = new Map()

        for (let i = 0; i < 60 * 240; i += 1) {
          now += DT * 1000
          if (i % 36 === 0) e = feedTyped(e)
          if (i % 600 === 0) e = feedAt(e, 0.3 + (i % 5) * 0.25, 0.3 + (i % 3) * 0.2)

          const before = e.food.map((f) => f.id)
          e = step(e, now, DT)

          for (const f of e.food) {
            if (Math.hypot(f.x - e.swimmer.x, f.y - e.swimmer.y) < 0.12) {
              near.set(f.id, (near.get(f.id) ?? 0) + 1)
            }
          }
          for (const id of before) {
            if (e.food.some((g) => g.id === id) || e.justAte) continue
            // 수명이 다해 사라졌다. 상어가 6초 넘게 곁에 있었다면 맴돌기만 한 것이다.
            if ((near.get(id) ?? 0) / 60 > 6) orbited += 1
          }
        }
      }
    }

    expect(orbited, `${orbited} 개를 곁에 두고도 못 먹었다`).toBe(0)
  })


})
