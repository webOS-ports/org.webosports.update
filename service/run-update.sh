#!/bin/sh

CACHE_DIR=/var/lib/system-update/packages
OPKG_FLAGS=""

if [ ! -d ${CACHE_DIR} ] ; then
	echo "NOTE: No updates available. Rebooting now"
	reboot
fi

echo "NOTE: Starting system update"

NUM_PACKAGES=`ls -alh ${CACHE_DIR} | wc -l`

echo "NOTE: Installing ${NUM_PACKAGES} packages"

opkg $OPKG_FLAGS --cache=${CACHE_DIR} upgrade

echo "NOTE: All packages are installed now"

echo "NOTE: Cleaning up"

rm -rf ${CACHE_DIR}
rm -f /system-update

echo "NOTE: Rebooting system"

reboot
