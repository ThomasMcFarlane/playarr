#!/usr/bin/env bash
set -euo pipefail

# Boots the webOS OSE emulator disk image directly under QEMU/KVM.
#
# This is NOT LG's officially documented path -- LG's own QEMU-based OSE
# emulator was deprecated in 2018, and the only currently maintained/tested
# path is VirtualBox (the `webos-emulator` Python launcher + VBoxManage,
# VirtualBox 7.0+, Intel VT-x). The disk image itself is a plain VMDK that
# QEMU reads natively though, so booting it directly works -- it's just
# unofficial and untested by LG. If it misbehaves, LG's VirtualBox path
# (https://www.webosose.org/docs/tools/sdk/emulator/virtualbox-emulator/emulator-user-guide/)
# is the documented fallback.
#
# This boots with software-rendered `-vga std` rather than LG's GL-accelerated
# virtio-gpu-gl default: this host's only GPU is a server-class ASPEED BMC
# framebuffer (`ast` driver, no /dev/dri/renderD*), so GPU passthrough isn't
# available here. Whether webOS OSE's Surface Manager/Wayland compositor
# tolerates pure software rendering is untested -- if it doesn't come up,
# that's a host limitation, not a bug in this script. On a host with a real
# GPU render node, swap in:
#   -device virtio-gpu-gl-pci -display sdl,gl=on   (drop -vga std)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./env.sh
source "$SCRIPT_DIR/env.sh"

command -v qemu-system-x86_64 >/dev/null || {
  echo "qemu-system-x86_64 not found. Install it yourself (needs sudo):" >&2
  echo "  sudo pacman -S qemu-desktop" >&2
  exit 1
}
command -v qemu-img >/dev/null || {
  echo "qemu-img not found (should ship with qemu-desktop)." >&2
  exit 1
}

image_dir="$WEBOS_OSE_EMULATOR_HOME/images"
vmdk="$image_dir/webos-image-qemux86-64.wic.vmdk"
qcow2="$image_dir/webos-image-qemux86-64.qcow2"

[ -f "$vmdk" ] || {
  echo "No emulator image at $vmdk" >&2
  echo "Run scripts/webos-sdk/install-ose-emulator.sh first." >&2
  exit 1
}

# QEMU 11's fdmon-io_uring event-loop backend needs to mlock() ring-buffer
# memory at startup -- on an account with RLIMIT_MEMLOCK capped low (8MB is
# this workstation's systemd --user default, confirmed via
# /proc/<systemd --user PID>/limits), that fails and QEMU refuses to start
# at all, even with zero drives attached. Not fixable from inside this
# script; print the fix instead of a bare crash.
print_io_uring_hint() {
  cat >&2 <<'EOF'

If the error above says "Failed to initialize io_uring: Cannot allocate memory",
this account's RLIMIT_MEMLOCK is too low for QEMU's io_uring event-loop backend
to start (confirmed on this workstation: both this login session and the
systemd --user manager itself report an 8MB hard cap). Fix (needs sudo, and a
full logout/login afterward -- systemd --user reads this at manager startup):

  sudo mkdir -p /etc/systemd/user.conf.d
  printf '[Manager]\nDefaultLimitMEMLOCK=64M\n' | sudo tee /etc/systemd/user.conf.d/50-memlock.conf

Or skip QEMU and use LG's officially supported VirtualBox path instead, which
doesn't use io_uring and is unaffected by this:
  https://www.webosose.org/docs/tools/sdk/emulator/virtualbox-emulator/emulator-user-guide/
EOF
}

if [ ! -f "$qcow2" ]; then
  echo "Converting VMDK to qcow2 (one-time; gives snapshot support + better I/O than raw vmdk under QEMU)..."
  qemu-img convert -O qcow2 "$vmdk" "$qcow2" || { print_io_uring_hint; exit 1; }
fi

echo "Booting webOS OSE emulator..."
echo "  SSH:            ssh -p 6622 root@localhost   (blank password, LG's documented fallback login)"
echo "  ares-cli:       ares-config -p ose  &&  ares-setup-device --list   (built-in 'emulator' profile, SSH-key auth)"
echo "  Web Inspector:  http://localhost:9998"
echo

qemu-system-x86_64 \
  -enable-kvm -cpu host -smp 2 -m 4096 \
  -drive file="$qcow2",format=qcow2,if=virtio \
  -vga std \
  -device virtio-net-pci,netdev=net0 \
  -netdev user,id=net0,hostfwd=tcp::6622-:22,hostfwd=tcp::9998-:9998,hostfwd=tcp::9223-:9999 \
  -usb -device usb-tablet \
  -serial mon:stdio || { print_io_uring_hint; exit 1; }
