# 오피스 VM 이미지

Munder Office 웹 페이지가 브라우저 안에서 부팅하는 리눅스 VM입니다. 이 폴더에는 바이너리를 다시 만드는 데 필요한 설정과 스크립트를 모아 두었습니다.

| 구성 | 버전과 출처 | 라이선스 |
| --- | --- | --- |
| 에뮬레이터 | [v86](https://github.com/copy/v86) 0.5.469 (`libv86.js`, `v86.wasm`) | BSD-2-Clause |
| BIOS | SeaBIOS, VGABIOS (v86 저장소의 `bios/`) | LGPL-3.0 / LGPL-2.1 |
| 커널 | Linux v6.6 (`git tag v6.6`), i386, 설정 `kernel.config` | GPL-2.0 |
| 유저랜드 | BusyBox 1_36_1 (`git tag 1_36_1`), static musl, 설정 `busybox.config`, 패치 `busybox-fastfunc.patch` | GPL-2.0 |

## 동작 방식

- 커널에 initramfs가 내장되어 있습니다(`init`). 부팅하면 셸 3개가 시리얼 포트 ttyS0~2에 붙습니다. ttyS0은 VM 콘솔이고, ttyS1과 ttyS2는 사람이 쓰는 터미널 에이전트용입니다.
- `/home/agent`는 virtio 9p(`host9p`)로 마운트되어 페이지와 파일을 주고받습니다.
- Claude 에이전트의 명령은 9p 실행 큐로 실행됩니다. 페이지가 `.munder/run/<id>.sh`를 넣으면 VM 안의 데몬이 이를 실행하고 `<id>.out`과 `<id>.code`를 남깁니다.

## 다시 빌드하기

```bash
./build.sh            # 결과: /tmp/munder-vm-build/linux-bzimage.bin
```

빌드하면서 고친 문제:

- zig(clang)로 빌드하면 BusyBox의 i386 `regparm` 호출 규약이 깨집니다. `busybox-fastfunc.patch`로 이를 끕니다.
- `awk`는 `-Oz`에서 잘못 컴파일되어 `-O1`로 다시 빌드합니다.
- musl의 32비트 `nanosleep`이 동작하려면 `CONFIG_COMPAT_32BIT_TIME=y`가 필요합니다. 이 설정이 없으면 `sleep`이 바로 끝납니다.
- 시리얼 포트 4번(ttyS3)은 v86에서 IRQ를 공유해 응답하지 않으므로 쓰지 않습니다.
