#!/bin/sh

# Create indicator for systemd to boot into system update mode
ln -sf /var/lib/system-update /system-update

# We have to use the webOS system to reboot the device to make sure all activities are
# correctly stopped (which isn't true yet but might be in the future)
luna-send -n 1 -f luna://com.palm.sleep/shutdown/machineReboot '{"reason":"system update"}'
