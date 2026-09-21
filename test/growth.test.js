import { describe, expect, it } from 'vitest'
import { GAME_MODE_ALPHA, MAX_ALPHA, STAGE_THRESHOLDS } from '../src/game/constants.js'
import { baseAlphaOf, detailOf, lengthOf, stageOf, toNextStage, visibility } from '../src/game/growth.js'

describe('단계 문턱', () => {
  it('값을 못 박는다 — 서버의 shark_stage 와 같아야 한다', () => {
    expect(STAGE_THRESHOLDS).toEqual([0, 30, 100, 250, 550, 1000])
  })

  it.each([
    [0, 1], [29, 1],
    [30, 2], [99, 2],
    [100, 3], [249, 3],
    [250, 4], [549, 4],
    [550, 5], [999, 5],
    [1000, 6], [99999, 6],
  ])('%i 점이면 %i단계', (eaten, stage) => {
    expect(stageOf(eaten)).toBe(stage)
  })

  it('다음 단계까지 남은 점수를 센다', () => {
    expect(toNextStage(0)).toBe(30)
    expect(toNextStage(29)).toBe(1)
    expect(toNextStage(30)).toBe(70)
    // 다 큰 상어는 0 이 아니라 null 이다 — 「1 점 남았다」와 「다 컸다」는 다른 말이다.
    expect(toNextStage(1000)).toBe(null)
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

  it('1단계는 흐릿하고 6단계도 바탕화면을 가리지 않는다', () => {
    expect(baseAlphaOf(1)).toBeLessThan(0.25)
    expect(baseAlphaOf(6)).toBeLessThan(0.6)
  })
})

describe('visibility', () => {
  it('숨어 있으면 단계가 아무리 높아도 안 보인다', () => {
    expect(visibility(6, 'hidden', true)).toBe(0)
    expect(visibility(1, 'hidden', false)).toBe(0)
  })

  it('같은 상태라면 단계가 높을수록 진하다', () => {
    for (let s = 1; s < 6; s += 1) {
      expect(visibility(s + 1, 'cruise', false)).toBeGreaterThan(visibility(s, 'cruise', false))
    }
  })

  it('돌진이 순찰보다 진하다 — 달려올 때 제일 잘 보인다', () => {
    expect(visibility(3, 'dash', false)).toBeGreaterThan(visibility(3, 'cruise', false))
  })

  it('에워쌀 때가 순찰보다 진하다 — 보채는 것이 보여야 한다', () => {
    expect(visibility(3, 'prowl', false)).toBeGreaterThan(visibility(3, 'cruise', false))
  })

  it(`게임모드에서 ${GAME_MODE_ALPHA}배 진해진다`, () => {
    // 상한에 안 걸리는 낮은 단계에서 재야 배율이 드러난다.
    const off = visibility(1, 'cruise', false)
    const on = visibility(1, 'cruise', true)
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
