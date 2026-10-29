#!/bin/sh
# Copyright (c) 2026 Herman van Hazendonk
# SPDX-License-Identifier: Apache-2.0
#
# jshint over the service and its tests (.jshintrc: Node 22, as the messaging service has it),
# and shellcheck over the shell scripts.
#
# Neither tool is vendored, so this reports what it could not run rather than failing over a
# missing tool. The syntax check below runs either way: node parses every module.
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
TOP=$(cd "$HERE/.." && pwd)
fail=0

JSHINT=${JSHINT:-$(command -v jshint || true)}
if [ -n "$JSHINT" ]; then
	if "$JSHINT" --config "$TOP/.jshintrc" "$TOP/service" "$TOP/tests"; then
		echo "PASS jshint"
	else
		echo "FAIL jshint"; fail=1
	fi
else
	echo "SKIP jshint (not installed; npm i -g jshint, or set JSHINT)"
fi

if command -v shellcheck >/dev/null 2>&1; then
	# service/*.sh are the old scripts, unchanged (run-update.sh runs in the update boot): its
	# findings are style ones and are left; see README.md.
	if shellcheck "$HERE"/*.sh "$TOP"/service/start-update.sh "$TOP"/service/download-updates.sh; then
		echo "PASS shellcheck"
	else
		echo "FAIL shellcheck"; fail=1
	fi
else
	echo "SKIP shellcheck (not installed)"
fi

# Every module parses. node --check only parses, so nothing in them runs.
n=0
for f in "$TOP/service/service.js" "$TOP"/service/lib/*.js "$HERE"/*.js; do
	node --check "$f" || { echo "FAIL parse $f"; fail=1; }
	n=$((n + 1))
done
echo "PASS parse ($n modules)"

exit $fail
