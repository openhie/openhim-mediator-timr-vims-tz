#!/bin/bash
set -e

mkdir -p targets/trusty/usr/share
rm -rf targets/trusty/usr/share/*

echo "Cloning base mediators..."
git clone https://github.com/openhie/openhim-mediator-timr-vims-tz.git targets/trusty/usr/share/openhim-mediator-timr-vims-tz
echo "Done."

#echo "Downloading module dependencies..."
#(cd targets/trusty/usr/share/openhim-mediator-timr-vims-tz/ && npm install)
#echo "Done."
