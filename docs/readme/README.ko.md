<div align="center">

# SubTandem

**IINA를 위한 실시간 이중 언어 자막 번역**

[![Release](https://img.shields.io/github/v/release/janwee-sha/SubTandem?label=release)](https://github.com/janwee-sha/SubTandem/releases)
[![IINA](https://img.shields.io/badge/IINA-1.4%2B-8c5cff)](https://iina.io/)
[![macOS](https://img.shields.io/badge/macOS-12%2B-000000)](https://www.apple.com/macos/)

[English](../../README.md) · [简体中文](README.zh-CN.md) · **한국어** · [日本語](README.ja.md) · [Русский](README.ru.md) · [العربية](README.ar.md) · [Français](README.fr.md)

</div>

---

SubTandem는 [IINA](https://iina.io/)에서 현재 선택한 로컬 영상의 내장 텍스트 자막 또는 외부 SRT/ASS 자막을 번역해 독립 오버레이에 직접 표시합니다. 재생 위치 가까이만 제한된 묶음으로 번역하며, 지연되거나 실패해도 원본 자막 선택과 영상 재생은 계속됩니다.

## ✨ 주요 기능

- **실시간 이중 언어 자막:** 원본 자막은 IINA에서 그대로 유지하고 SubTandem가 다른 자막 트랙을 차지하지 않은 채 선택한 세로 위치에 번역문을 가로 중앙 정렬로 표시합니다.
- **내장 및 외부 텍스트 자막:** 로컬 Matroska SubRip/ASS/SSA, MOV/MP4 `mov_text`, 외부 SRT/ASS를 지원합니다. extractor가 포함되어 외부 `ffmpeg`나 `ffprobe`가 필요하지 않습니다.
- **번역 서비스 선택:** OpenAI Chat Completions 계약과 호환되는 endpoint 또는 로컬/원격 Ollama 서버를 사용할 수 있습니다.
- **재생 우선 동작:** 번역 작업 때문에 영상이 일시 정지되거나 원본 자막이 숨겨지지 않습니다.
- **제한된 요청:** 재생 위치 주변의 자막만 번역하고 플레이어 창마다 동시 작업을 제한하며, 성공한 결과는 현재 영상 세션에만 캐시합니다.
- **여러 Profile:** 번역 서비스 Profile을 저장하고 테스트한 뒤, 자막 텍스트를 받을 정확한 endpoint를 명시적으로 선택할 수 있습니다.
- **프록시 제어:** Profile별로 macOS 프록시 설정을 사용하거나 직접 연결을 선택할 수 있습니다.

## ✅ 요구 사항

- macOS 12 이상
- IINA 1.4.0 이상
- 지원되는 로컬 내장 텍스트 자막 또는 읽을 수 있는 외부 SRT/ASS/SSA 자막
- 다음 번역 서비스 중 하나:
  - OpenAI endpoint, Model ID, 그리고 서비스에서 요구하는 경우 API key
  - 호환 모델이 이미 설치된 Ollama 서버

SubTandem는 번역 모델을 다운로드하거나 실행하지 않습니다.

## 🚀 설치

IINA를 열고 **환경설정 → 플러그인**으로 이동합니다. 플러그인 관리 화면에서는 다음 두 가지 설치 방법을 사용할 수 있습니다.

<div align="center">

![GitHub에서 설치 및 패키지 설치 버튼이 표시된 IINA 플러그인 관리 화면](assets/plugin-manager.webp)

</div>

### GitHub에서 설치(권장)

1. **깃허브에서 설치…**를 클릭합니다.
2. `user/repo` 입력란에 `janwee-sha/SubTandem`를 입력하고 설치를 확인합니다.
3. 설치된 플러그인 목록에 SubTandem가 나타날 때까지 기다립니다.

SubTandem v0.1.0에는 IINA 업데이트 메타데이터가 포함되어 있습니다. GitHub 또는 다운로드한 패키지로 설치하면 IINA에서 이후 버전을 확인하고 설치할 수 있습니다.

### 다운로드한 패키지 설치

1. [Releases](https://github.com/janwee-sha/SubTandem/releases) 페이지에서 최신 `SubTandem-X.Y.Z.iinaplgz` 패키지를 다운로드합니다.
2. **환경설정 → 플러그인**으로 돌아가 **패키지 설치…**를 클릭합니다.
3. 다운로드한 `.iinaplgz` 파일을 선택하고 설치를 확인합니다.

어느 방법을 사용하든 권한 요청이 표시되면 승인하고 SubTandem 옆의 체크상자가 활성화되어 있는지 확인한 다음 IINA를 다시 시작합니다. 이후 영상을 재생하고 IINA 사이드바를 연 뒤 **SubTandem** 탭을 선택합니다.

## 🌍 빠른 시작

1. 로컬 영상을 열고 지원되는 내장 텍스트 자막 또는 외부 SRT/ASS를 IINA 주 자막으로 선택합니다.
2. **Languages**에서 모국어를 선택합니다. IINA가 자막 언어를 식별하지 못하면 직접 확인한 뒤 언어 설정을 저장합니다.
3. **Translation service**에서 OpenAI 또는 Ollama Profile을 만듭니다. 인증이 필요하면 API key를 입력한 뒤 모델 목록을 수동으로 새로 고칩니다. 반환된 모델을 선택하거나 정확한 사용자 지정 Model ID를 입력합니다.
4. Profile을 저장하고 테스트한 다음 **Select**를 클릭합니다. Profile 선택은 화면에 표시된 endpoint로 재생 위치 주변의 자막 텍스트를 전송하도록 SubTandem에 명시적으로 허용하는 동작입니다.
5. **Translate**를 켭니다. 원본 자막은 IINA에서 계속 표시되고 번역된 cue는 SubTandem 오버레이에 나타납니다. **Languages**의 **Translation position**으로 오버레이를 위쪽(`0`)에서 아래쪽(`100`)까지 옮길 수 있습니다.

Endpoint, 모델, API key 또는 네트워크 경로가 바뀌면 Profile을 다시 저장하고 번역 전에 다시 선택해야 합니다.

## ⚙️ 번역 서비스

### OpenAI

- 완전한 `/chat/completions` URL이 아니라 `https://example.com/v1`과 같은 API root를 입력합니다.
- SubTandem가 `/chat/completions`를 덧붙이고 최종 요청 URL을 사이드바에 미리 표시합니다.
- 서비스가 제공하는 정확한 모델 식별자를 입력합니다.
- Endpoint가 인증 없는 요청을 허용하는 경우에만 Bearer API key를 생략할 수 있습니다. 저장 후 key 입력란은 쓰기 전용이며 다시 표시되지 않습니다.
- 원격 endpoint는 HTTPS를 사용해야 합니다.

### Ollama

- 기본 서버 root는 `http://127.0.0.1:11434`입니다.
- `translategemma:12b` 또는 `qwen3:14b`처럼 설치된 모델의 정확한 tag를 입력합니다.
- Ollama 서버가 인증 없는 요청을 허용하면 Bearer API key는 선택 사항이며 저장 후에는 쓰기 전용입니다.
- 연결 테스트에서 서버, 설치된 tag, structured-output chat 지원 여부를 확인합니다.

어느 서비스를 사용하든 먼저 **Use macOS proxy settings**를 권장합니다. 구성된 시스템 프록시 때문에 서비스에 접근할 수 없을 때만 **Connect directly**를 선택하세요.

## 🔒 개인정보, 자격 증명 및 비용

- SubTandem는 명시적으로 선택한 Profile에만 재생 위치 주변의 자막 텍스트, 언어 방향, 불투명한 cue ID와 소량의 인접 문맥을 보냅니다. 영상이나 오디오 내용은 보내지 않습니다.
- `video-overlay` 권한은 현재 번역을 로컬 비대화형 Overlay에 표시하는 데만 사용됩니다. Overlay는 입력이나 영상 위 드래그를 받지 않고 네트워크 또는 WebView 저장소를 사용하지 않으며 재생 세션과 함께 지워집니다.
- OpenAI 및 Ollama API key는 플러그인 전용 `credentials.json` 파일에 로컬 평문으로 저장됩니다. 디렉터리는 `0700`, 파일은 `0600` 권한을 사용합니다. Key는 IINA preferences, 로그, 진단, Sidebar 상태 또는 플러그인 패키지에 기록되지 않으며 저장 후 다시 표시되지 않습니다.
- 파일 권한은 다른 macOS 계정과 일반적인 우발적 접근으로부터 key를 보호하지만, 현재 macOS 사용자 권한으로 파일을 읽을 수 있는 프로세스로부터는 보호하지 못합니다.
- 번들 transport helper는 임시 `127.0.0.1` 포트에서만 수신합니다. 저장했거나 편집 중인 endpoint는 Select 전에 자막 없는 모델 목록 요청을 받을 수 있으며, 선택한 Profile만 번역용 자막 텍스트를 받습니다.
- 번역 결과는 현재 영상 세션에만 캐시되며 영상 변경, 재생 종료 또는 창 닫기 시 삭제됩니다.
- 번역 Provider는 요청 비용을 청구하고 자체 데이터 및 콘텐츠 정책을 적용할 수 있습니다. 묶음 처리와 캐시는 호출 횟수를 줄이지만 최대 비용을 보장하지 않습니다.

## 📌 현재 지원 범위

SubTandem는 오디오 전사, 이미지 기반 자막 OCR/추출, 원격 미디어 내장 자막 추출, 전체 영상 사전 번역, 내보내기, 클라우드 동기화, 영구 캐시를 제공하지 않습니다. 임시 추출 데이터는 분석, 취소, 시간 초과 또는 종료 후 삭제됩니다.

## 🛠️ 문제 해결

- **Select a supported text subtitle:** 로컬 내장 SubRip/ASS/SSA/`mov_text` 또는 외부 SRT/ASS를 주 자막으로 선택하세요. 이미지 기반 및 원격 내장 자막은 지원하지 않으며, 상태 안내에 따라 다시 선택하거나 준비 실패 후 Retry하세요.
- **Confirm the subtitle language:** `en-US`와 같은 BCP 47 언어 tag를 입력하고 언어 설정을 저장하세요.
- **Translation service unavailable:** Profile을 테스트하고 endpoint, 모델, API key, 네트워크 경로 또는 Ollama 프로세스를 확인하세요. 영상과 원본 자막은 계속 정상 재생됩니다.
- **Credential could not be saved:** 불완전한 개발 사본 대신 Release 패키지를 설치하고 플러그인 데이터 디렉터리가 쓰기 가능한지 확인한 뒤 IINA를 완전히 종료하고 다시 시작하세요.
- **번역문이 표시되지 않음:** Profile을 테스트하고 선택했는지, 원본 언어와 모국어가 다른지, **Translate**가 켜져 있는지, 재생 위치가 번역된 cue의 시간 범위 안에 있는지 확인하세요.
- **프록시가 서비스를 차단함:** 먼저 기본 macOS 프록시 경로를 사용하세요. 프록시가 서비스를 거부하면 해당 Profile을 **Connect directly**로 바꾸고 저장한 뒤 다시 Select/Test하세요.

## ☕ SubLingo 후원하기

SubLingo가 도움이 되었다면 [Afdian](https://www.ifdian.net/item/ea1ff37a97ed11f19a9f52540025c377?utm_source=copylink&utm_medium=link) 또는 [Ko-fi](https://ko-fi.com/ianhsia)에서 자발적으로 제작자에게 커피 한 잔을 사 주세요.

SubLingo는 누구에게나 무료이며 모든 기능을 제공합니다. 후원으로 추가 기능, 우선 번역 또는 전용 빌드가 잠금 해제되지 않으며 번역 서비스 API 크레딧도 포함되지 않습니다. 선택한 Provider는 자체 약관과 콘텐츠 정책에 따라 별도로 요금을 부과할 수 있습니다.
