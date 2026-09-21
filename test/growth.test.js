import { describe, expect, it } from 'vitest'
import {
  GAME_MODE_ALPHA, MAX_ALPHA, MIN_ALPHA, RIPPLE_ALPHA, STAGE_THRESHOLDS, STATE_ALPHA,
  WAKE_ALPHA, WAKE_LIFE, WAKE_SPREAD, WAKE_WIDTH,
} from '../src/game/constants.js'
import { baseAlphaOf, detailOf, lengthOf, stageOf, toNextStage, visibility } from '../src/game/growth.js'

describe('단계 문턱', () => {
  it('값을 못 박는다 — 서버의 shark_stage 와 같아야 한다', () => {
    expect(STAGE_THRESHOLDS).toEqual([0, 700, 2200, 5500, 10500, 18000])
  })

  it.each([
    [0, 1], [699, 1],
    [700, 2], [2199, 2],
    [2200, 3], [5499, 3],
    [5500, 4], [10499, 4],
    [10500, 5], [17999, 5],
    [18000, 6], [999999, 6],
  ])('%i 점이면 %i단계', (grown, stage) => {
    expect(stageOf(grown)).toBe(stage)
  })

  it('다음 단계까지 남은 점수를 센다', () => {
    expect(toNextStage(0)).toBe(700)
    expect(toNextStage(699)).toBe(1)
    expect(toNextStage(700)).toBe(1500)
    // 다 큰 상어는 0 이 아니라 null 이다 — 「1 점 남았다」와 「다 컸다」는 다른 말이다.
    expect(toNextStage(18000)).toBe(null)
  })
})

describe('크기와 선명도', () => {
  it('단계가 오르면 길이가 커진다 (단조 증가)', () => {
    for (let s = 1; s < 6; s += 1) {
      expect(lengthOf(s + 1)).toBeGreaterThan(lengthOf(s))
    }
  })

  it('단계가 오르면 기본 선명도가 오른다 (단조 증가)', () => {
    for (let s = 1; s < 6; s += 1) {
      expect(baseAlphaOf(s + 1)).toBeGreaterThan(baseAlphaOf(s))
    }
  })

  it('상어는 작다 — 다 커도 화면 높이의 1/6 을 안 넘는다', () => {
    // 크면 바탕화면을 가린다. 종 배율이 제일 큰 고래상어까지 세어 본다.
    expect(lengthOf(6) * 1.45).toBeLessThan(1 / 6)
    // 그리고 아기상어가 점으로 보이면 안 된다.
    expect(lengthOf(1)).toBeGreaterThan(0.012)
  })

  it('**한 단계마다 눈에 띄게 커진다**', () => {
    // 「조금 큰 같은 상어」가 아니라 「다른 상어」로 보여야 키우는 맛이 난다.
    for (let s = 1; s < 6; s += 1) {
      const ratio = lengthOf(s + 1) / lengthOf(s)
      expect(ratio, `${s}단계 → ${s + 1}단계 가 ${ratio.toFixed(2)}배뿐이다`)
        .toBeGreaterThanOrEqual(1.3)
    }
  })

  it('1단계와 6단계가 여섯 배 넘게 차이 난다', () => {
    expect(lengthOf(6) / lengthOf(1)).toBeGreaterThan(6)
  })

  it('앞 단계일수록 더 크게 뛴다 — 처음 몇 번이 제일 신난다', () => {
    const jumps = [1, 2, 3, 4, 5].map((s) => lengthOf(s + 1) / lengthOf(s))
    for (let i = 1; i < jumps.length; i += 1) {
      expect(jumps[i], `${i + 1}번째 도약`).toBeLessThanOrEqual(jumps[i - 1])
    }
  })

  it('1단계는 흐릿하고 6단계도 바탕화면을 가리지 않는다', () => {
    expect(baseAlphaOf(1)).toBeLessThan(0.25)
    expect(baseAlphaOf(6)).toBeLessThan(0.6)
  })
})

describe('visibility', () => {
  it('**상어는 절대 사라지지 않는다**', () => {
    // 처음에는 「숨음」이 알파 0 이라 20~45 초 동안 통째로 없어졌다. 바탕화면에서
    // 같이 사는 앱에서는 그게 그냥 없어지는 것으로 보인다. 흐린 것과 없는 것은 다르다.
    for (const state of ['lurk', 'cruise', 'prowl', 'dash', 'eat', 'sated']) {
      for (let stage = 1; stage <= 6; stage += 1) {
        for (const mode of [true, false]) {
          expect(visibility(stage, state, mode), `${stage}단계 ${state}`)
            .toBeGreaterThanOrEqual(MIN_ALPHA)
        }
      }
    }
  })

  it('모르는 상태가 와도 사라지지 않는다 — 저장값이 낡아도 안 깨진다', () => {
    expect(visibility(1, '없는상태', false)).toBeGreaterThanOrEqual(MIN_ALPHA)
  })

  it('어슬렁거릴 때가 제일 흐리다', () => {
    for (const state of ['cruise', 'prowl', 'dash', 'eat', 'sated']) {
      expect(visibility(4, 'lurk', false), state)
        .toBeLessThanOrEqual(visibility(4, state, false))
    }
  })

  it('같은 상태라면 단계가 높을수록 진하다', () => {
    for (let s = 1; s < 6; s += 1) {
      expect(visibility(s + 1, 'cruise', false)).toBeGreaterThan(visibility(s, 'cruise', false))
    }
  })

  it('받침에 걸리는 조합이 실제로 있다 — 없으면 MIN_ALPHA 는 죽은 코드다', () => {
    expect(baseAlphaOf(1) * STATE_ALPHA.lurk).toBeLessThan(MIN_ALPHA)
    expect(visibility(1, 'lurk', false)).toBe(MIN_ALPHA)
  })

  it('돌진이 순찰보다 진하다 — 달려올 때 제일 잘 보인다', () => {
    expect(visibility(3, 'dash', false)).toBeGreaterThan(visibility(3, 'cruise', false))
  })

  it('에워쌀 때가 순찰보다 진하다 — 보채는 것이 보여야 한다', () => {
    expect(visibility(3, 'prowl', false)).toBeGreaterThan(visibility(3, 'cruise', false))
  })

  it(`게임모드에서 ${GAME_MODE_ALPHA}배 진해진다`, () => {
    // **위아래 받침에 안 걸리는 가운데에서 재야** 배율이 드러난다.
    // 1 단계는 아래 받침(MIN_ALPHA)에, 6 단계 돌진은 위 상한에 걸린다.
    const off = visibility(3, 'cruise', false)
    const on = visibility(3, 'cruise', true)
    expect(off).toBeGreaterThan(MIN_ALPHA)
    expect(on).toBeLessThan(MAX_ALPHA)
    expect(on / off).toBeCloseTo(GAME_MODE_ALPHA, 6)
  })

  it(`아무리 진해도 ${MAX_ALPHA} 를 안 넘는다`, () => {
    expect(visibility(6, 'dash', true)).toBeLessThanOrEqual(MAX_ALPHA)
    // 그리고 실제로 상한에 걸리는 조합이 있다 — 안 걸리면 이 상한은 죽은 코드다.
    expect(baseAlphaOf(6) * 1.8 * GAME_MODE_ALPHA).toBeGreaterThan(MAX_ALPHA)
  })
})

describe('detailOf', () => {
  it('커질수록 붙는 것이 늘기만 한다', () => {
    let previous = 0
    for (let s = 1; s <= 6; s += 1) {
      const count = Object.values(detailOf(s)).filter(Boolean).length
      expect(count).toBeGreaterThanOrEqual(previous)
      previous = count
    }
  })

  it('1단계는 등지느러미와 꼬리뿐이고 6단계는 전부 있다', () => {
    expect(detailOf(1)).toEqual({
      dorsalFin: true, tailFin: true, pectoralFins: false,
      secondDorsal: false, gills: false, teeth: false, scars: false,
    })
    expect(Object.values(detailOf(6)).every(Boolean)).toBe(true)
  })
})


describe('물자국', () => {
  it('**가장 흐린 상어보다도 흐리다**', () => {
    // 이게 이 값들의 존재 이유다. 자국이 상어보다 눈에 띄면 바탕화면에 흰 줄이
    // 그어진 것으로 보이고, 그 순간 「상어가 지나갔다」가 아니라 「뭐가 묻었다」가 된다.
    const 가장진한자국 = MAX_ALPHA * WAKE_ALPHA
    expect(가장진한자국).toBeLessThan(baseAlphaOf(1))
  })

  it('값을 못 박는다', () => {
    expect(WAKE_ALPHA).toBe(0.05)
    expect(WAKE_LIFE).toBe(0.85)
    expect(WAKE_WIDTH).toBe(0.06)
    expect(WAKE_SPREAD).toBe(0.24)
  })

  it('짧게 남는다 — 길게 끌면 화면에 선이 쌓인다', () => {
    expect(WAKE_LIFE).toBeLessThan(1)
  })

  it('선이 몸보다 훨씬 가늘다 — 어느 단계에서나', () => {
    // 몸 길이 대비 값이라 단계와 상관없이 같은 비율로 가늘다. 화면 대비로 뒀을 때는
    // 아기상어가 제 몸보다 굵은 자국을 남겼다.
    expect(WAKE_WIDTH).toBeLessThan(1 / 8)
    expect(WAKE_SPREAD).toBeLessThan(1)
  })

  it('먹은 자리의 동심원도 자국만큼 흐리다', () => {
    expect(RIPPLE_ALPHA).toBeLessThan(baseAlphaOf(1))
  })
})
