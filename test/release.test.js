import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// 배포는 **파일 이름 하나로 이어져 있다.** 셸이 찾는 자산 이름, CI 가 만드는 이름,
// 설치본이 스스로 붙이는 이름이 전부 손으로 적혀 있어서, 하나만 바꾸면 아무 데서도
// 에러가 안 나고 「새 버전 알림이 영영 안 뜨는」 앱이 된다. 그걸 여기서 묶어 둔다.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const pkg = JSON.parse(read('package.json'))
const plist = read('mac/Info.plist')
const csproj = read('windows/DesktopShark.csproj')
const swift = read('mac/Sources/main.swift')
const cs = read('windows/Program.cs')
const workflow = read('.github/workflows/release.yml')
const iss = read('windows/installer.iss')

const REPO = 'joowon-dev/desktop-shark'

/** <key>A</key><string>B</string> 에서 B 를 꺼낸다. */
function plistValue(key) {
  const match = plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))
  return match?.[1]
}

describe('버전이 세 군데에서 같다', () => {
  // 맥 셸은 Info.plist 를, 윈도우 셸은 어셈블리 버전을 「지금 버전」으로 읽는다.
  // 하나가 낮으면 그 쪽만 매일 「새 버전이 있다」고 하고, 갈아 끼워도 또 그런다.
  it('package.json · Info.plist · csproj', () => {
    expect(plistValue('CFBundleShortVersionString')).toBe(pkg.version)
    expect(csproj).toContain(`<Version>${pkg.version}</Version>`)
  })

  it('릴리스 태그로 쓸 수 있는 모양이다', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('자동 업데이트가 찾는 자산이 실제로 올라간다', () => {
  it('맥 셸은 zip 을 찾고, CI 는 그 이름으로 만든다', () => {
    // 셸은 접미사로 고른다 — 접미사와 CI 산출물이 어긋나면 알림만 뜨고 설치는 안 된다.
    expect(swift).toContain('macAssetSuffix = "-mac.zip"')
    expect(workflow).toContain('dist/DesktopShark-mac.zip')
  })

  it('**dmg 가 아니라 zip 이다** — 마운트해서 자기를 갈아 끼우지 않는다', () => {
    expect(swift).not.toContain('macAssetSuffix = "-mac.dmg"')
  })

  it('윈도우 셸은 설치본을 찾고, Inno Setup 이 그 이름으로 만든다', () => {
    expect(cs).toContain('WinAssetSuffix = "-win-Setup.exe"')
    expect(iss).toContain('OutputBaseFilename=DesktopShark-win-Setup')
    expect(workflow).toContain('dist/DesktopShark-win-Setup.exe')
  })

  it('릴리스에 붙는 것은 zip · dmg · exe 셋 다', () => {
    for (const glob of ['*.zip', '*.dmg', '*.exe']) {
      expect(workflow, glob).toContain(`artifacts/**/${glob}`)
    }
  })
})

describe('물어보는 곳이 한 저장소다', () => {
  it('맥·윈도우가 같은 저장소를 본다', () => {
    for (const source of [swift, cs]) {
      expect(source).toContain(`https://api.github.com/repos/${REPO}/releases/latest`)
      expect(source).toContain(`https://github.com/${REPO}/releases/latest`)
    }
  })

  it('**야구 저장소가 남아 있지 않다** — 베껴 온 파일이라 제일 흔한 실수다', () => {
    for (const source of [swift, cs, iss, workflow]) {
      expect(source).not.toContain('sneaky-baseball')
      expect(source).not.toContain('SneakyBaseball')
    }
  })
})

describe('조용한 재설치가 성립한다', () => {
  it('설치본이 돌던 앱을 닫고 다시 띄운다', () => {
    // 이게 없으면 업데이트가 「상어가 사라진 것」으로 보인다.
    expect(iss).toContain('CloseApplications=yes')
    expect(iss).toContain('RestartApplications=yes')
    expect(cs).toContain('/SILENT /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /NORESTART')
  })

  it('관리자 권한을 안 쓴다 — 조용한 업데이트에 UAC 창이 뜨면 안 된다', () => {
    expect(iss).toContain('PrivilegesRequired=lowest')
  })
})
