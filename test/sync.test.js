import { describe, expect, it } from 'vitest'
import {
  defaultNickname, dropBatch, enqueueFeed, MAX_BATCH, MAX_PENDING, mergeEaten,
  newSecret, nextBatch, parseRecoveryCode, recoveryCode,
} from '../src/game/sync.js'

/** 0,1,2,... 를 주는 가짜 난수. 결정론이라 값을 못 박을 수 있다. */
const counting = (length) => Uint8Array.from({ length }, (_, i) => i)

describe('밀린 줄', () => {
  it('먹을 때마다 하나씩 는다', () => {
    expect(enqueueFeed(0)).toBe(1)
    expect(enqueueFeed(7)).toBe(8)
  })

  it(`${MAX_PENDING} 에서 멈춘다 — 부풀지 않는다`, () => {
    expect(enqueueFeed(MAX_PENDING)).toBe(MAX_PENDING)
    expect(enqueueFeed(MAX_PENDING - 1, 100)).toBe(MAX_PENDING)
  })

  it(`한 번에 ${MAX_BATCH} 까지만 보낸다 — 서버의 p_count 상한과 같다`, () => {
    expect(MAX_BATCH).toBe(20)
    expect(nextBatch(0)).toBe(0)
    expect(nextBatch(3)).toBe(3)
    expect(nextBatch(500)).toBe(MAX_BATCH)
  })

  it('보낸 만큼 줄에서 뺀다', () => {
    expect(dropBatch(50, 20)).toBe(30)
    expect(dropBatch(5, 20)).toBe(0)
  })

  it('쌓인 것을 다 흘려보내면 0 이 된다', () => {
    let pending = 137
    let rounds = 0
    while (pending > 0 && rounds < 1000) {
      pending = dropBatch(pending, nextBatch(pending))
      rounds += 1
    }
    expect(pending).toBe(0)
    expect(rounds).toBe(Math.ceil(137 / MAX_BATCH))
  })
})

describe('mergeEaten', () => {
  it('오프라인에서 키운 것을 잃지 않는다', () => {
    // 서버 값을 그대로 받아 적으면 비행기에서 먹인 서른이 사라진다.
    expect(mergeEaten(50, 20)).toBe(50)
    expect(mergeEaten(20, 50)).toBe(50)
    expect(mergeEaten(0, null)).toBe(0)
    expect(mergeEaten(null, 7)).toBe(7)
  })
})

describe('신분', () => {
  it('비밀은 24자이고 헷갈리는 글자를 안 쓴다', () => {
    const secret = newSecret(counting)
    expect(secret).toHaveLength(24)
    // l·o·0·1 은 옮겨 적을 때 틀린다. 알파벳에 아예 없다.
    expect(secret).not.toMatch(/[lo01]/)
  })

  it('기본 별명은 「상어」 + 네 자리 숫자다', () => {
    expect(defaultNickname(counting)).toBe('상어0001')
  })

  it('짧다 — 랭킹 한 줄에 실루엣·계급·점수가 같이 들어간다', () => {
    expect(defaultNickname(counting).length).toBeLessThanOrEqual(6)
  })

  it('복구 코드는 id 와 비밀을 점으로 잇는다', () => {
    const id = '0f9c1a2b-3d4e-5f60-7a8b-9c0d1e2f3a4b'
    expect(recoveryCode(id, 'abcdefghijklmnop')).toBe(`${id}.abcdefghijklmnop`)
    expect(recoveryCode(null, 'x')).toBe('')
  })

  it('복구 코드를 도로 가른다', () => {
    const id = '0f9c1a2b-3d4e-5f60-7a8b-9c0d1e2f3a4b'
    expect(parseRecoveryCode(` ${id}.abcdefghijklmnop `)).toEqual({
      playerId: id, secret: 'abcdefghijklmnop',
    })
  })

  it('모양이 틀리면 null — 오타를 조용히 받아들이지 않는다', () => {
    expect(parseRecoveryCode('')).toBe(null)
    expect(parseRecoveryCode('점이없다')).toBe(null)
    expect(parseRecoveryCode('not-a-uuid.abcdefghijklmnop')).toBe(null)
    // 비밀이 16자 미만
    expect(parseRecoveryCode('0f9c1a2b-3d4e-5f60-7a8b-9c0d1e2f3a4b.short')).toBe(null)
  })

  it('몰래 야구의 복구 코드가 그대로 통한다 — 같은 계정이다', () => {
    // 야구의 parseRecoveryCode 와 같은 규칙이어야 한다. 규칙이 갈라지면
    // 야구에서 쓰던 코드를 상어에 넣었을 때 「모양이 틀렸다」가 된다.
    const fromBaseball = '0f9c1a2b-3d4e-5f60-7a8b-9c0d1e2f3a4b.wqmzkhtrvbnpdxsc2345'
    expect(parseRecoveryCode(fromBaseball)).not.toBe(null)
  })
})
