#!/bin/bash

CACHE_DIR=/var/lib/system-update/packages

if [ -d $CACHE_DIR ] ; then
    rm -rf $CACHE_DIR
fi

mkdir -p $CACHE_DIR

/usr/bin/opkg --cache $CACHE_DIR upgrade --download-only
