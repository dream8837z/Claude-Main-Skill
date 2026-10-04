#!/usr/bin/env bash
# Rebuild the office VM image (vm/linux-bzimage.bin): Linux 6.6 i386 with an
# embedded BusyBox 1.36.1 initramfs, for the v86 emulator in Munder Office.
# Needs: git, make, gcc (with -m32), flex, bison, bc, python3, pip (for the zig toolchain).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${WORK:-/tmp/munder-vm-build}"
mkdir -p "$WORK" && cd "$WORK"

# 1. zig provides a static i386 musl C toolchain for BusyBox
if [ ! -x zig/ziglang/zig ]; then
  pip download ziglang==0.13.0 --no-deps -d zigwhl -q
  python3 -m zipfile -e zigwhl/ziglang-*.whl zig && chmod +x zig/ziglang/zig
fi
sed "s|/tmp/zig/x/ziglang/zig|$WORK/zig/ziglang/zig|" "$HERE/zcc" > zcc && chmod +x zcc
printf '#!/bin/sh\nexec %s ar "$@"\n' "$WORK/zig/ziglang/zig" > zar && chmod +x zar

# 2. BusyBox (static, i386). awk is built at -O1: clang miscompiles it at -Oz.
[ -d busybox ] || git clone -q --depth 1 --branch 1_36_1 https://github.com/mirror/busybox.git busybox
cd busybox
git apply --check "$HERE/busybox-fastfunc.patch" 2>/dev/null && git apply "$HERE/busybox-fastfunc.patch"
cp "$HERE/busybox.config" .config
make -j"$(nproc)" CC="$WORK/zcc" AR="$WORK/zar" HOSTCC=gcc STRIP=true busybox || true
rm -f editors/awk.o
make CC="$WORK/zcc" AR="$WORK/zar" HOSTCC=gcc STRIP=true EXTRA_CFLAGS=-O1 busybox || true
test -x busybox_unstripped
cd ..

# 3. initramfs root
rm -rf vmroot && mkdir -p vmroot/{bin,sbin,usr/bin,usr/sbin,proc,sys,dev,tmp,etc,root,home/agent,mnt}
cp busybox/busybox_unstripped vmroot/bin/busybox
for a in $(vmroot/bin/busybox --list); do [ "$a" = busybox ] || ln -sf /bin/busybox "vmroot/bin/$a"; done
cp "$HERE/init" vmroot/init && chmod +x vmroot/init
printf 'agent:x:0:0:agent:/home/agent:/bin/sh\nroot:x:0:0:root:/root:/bin/sh\n' > vmroot/etc/passwd
sudo mknod -m 600 vmroot/dev/console c 5 1 2>/dev/null || mknod -m 600 vmroot/dev/console c 5 1
sudo mknod -m 666 vmroot/dev/null c 1 3 2>/dev/null || mknod -m 666 vmroot/dev/null c 1 3

# 4. kernel with the initramfs embedded
[ -d linux ] || git clone -q --depth 1 --branch v6.6 https://github.com/torvalds/linux.git linux
cd linux
sed "s|^CONFIG_INITRAMFS_SOURCE=.*|CONFIG_INITRAMFS_SOURCE=\"$WORK/vmroot\"|" "$HERE/kernel.config" > .config
make ARCH=i386 olddefconfig
make ARCH=i386 -j"$(nproc)" bzImage
cp arch/x86/boot/bzImage "$WORK/linux-bzimage.bin"
echo "built $WORK/linux-bzimage.bin"
