#!/bin/bash
# Exit on error
set -e

echo -n "Would you like to (re)download the latest mediator source from master for use in this package? [y/N] "
read UPLOAD
if [[ "$UPLOAD" == "y" || "$UPLOAD" == "Y" ]];  then
    source cp-mediators-into-pkg.sh
fi


HOME=`pwd`
AWK=/usr/bin/awk
HEAD=/usr/bin/head
DCH=/usr/bin/dch

cd $HOME/targets
TARGETS=(*)
echo "Targets: $TARGETS"
cd $HOME
echo $HOME

PKG=openhim-mediator-timr-vims-tz
PKGVER=0.6.0

echo -n "Would you like to upload the build(s) to Launchpad? [y/N] "
read UPLOAD
if [[ "$UPLOAD" == "y" || "$UPLOAD" == "Y" ]];  then
    if [ -n "$LAUNCHPADPPALOGIN" ]; then
      echo Using $LAUNCHPADPPALOGIN for Launchpad PPA login
      echo "To Change You can do: export LAUNCHPADPPALOGIN=$LAUNCHPADPPALOGIN"
    else
      echo -n "Enter your launchpad login for the ppa and press [ENTER]: "
      read LAUNCHPADPPALOGIN
      echo "You can do: export LAUNCHPADPPALOGIN=$LAUNCHPADPPALOGIN to avoid this step in the future"
    fi

    if [ -n "${DEB_SIGN_KEYID}" ]; then
      echo Using ${DEB_SIGN_KEYID} for Launchpad PPA login
      echo "To Change You can do: export DEB_SIGN_KEYID=${DEB_SIGN_KEYID}"
      echo "For unsigned you can do: export DEB_SIGN_KEYID="
    else
      echo "No DEB_SIGN_KEYID key has been set.  Will create an unsigned"
      echo "To set a key for signing do: export DEB_SIGN_KEYID=<KEYID>"
      echo "Use gpg --list-keys to see the available keys"
    fi

    echo -n "Enter the name of the PPA: "
    read PPA
fi

BUILDDIR=$HOME/builds
echo -n "Clearing out previous builds... "
rm -rf $BUILDDIR
echo "Done."

for TARGET in "${TARGETS[@]}"
do
    TARGETDIR=$HOME/targets/$TARGET
    RLS=`$HEAD -1 $TARGETDIR/debian/changelog | $AWK '{print $2}' | $AWK -F~ '{print $1}' | $AWK -F\( '{print $2}'`
    BUILDNO=$((${RLS##*-}+1))

    if [ -z "$BUILDNO" ]; then
        BUILDNO=1
    fi

    BUILD=${PKG}_${PKGVER}-${BUILDNO}~${TARGET}
    echo "Building $BUILD ..."

    # Update changelog
    cd $TARGETDIR
    echo "Updating changelog for build ..."
    $DCH -Mv "${PKGVER}-${BUILDNO}~${TARGET}" --distribution "${TARGET}" "Release Debian Build ${PKGVER}-${BUILDNO}."

    # Clear and create packaging directory
    PKGDIR=${BUILDDIR}/${BUILD}
    rm -fr $PKGDIR
    mkdir -p $PKGDIR
    cp -R $TARGETDIR/* $PKGDIR

    cd $PKGDIR
    if [[ "$UPLOAD" == "y" || "$UPLOAD" == "Y" ]] && [[ -n "${DEB_SIGN_KEYID}" && -n "{$LAUNCHPADLOGIN}" ]]; then
      echo "Uploading to PPA ${LAUNCHPADPPALOGIN}/${PPA}"
      CHANGES=${BUILDDIR}/${BUILD}_source.changes
    	DPKGCMD="dpkg-buildpackage -k${DEB_SIGN_KEYID} -S -sa "
    	$DPKGCMD
    	DPUTCMD="dput ppa-sftp:$LAUNCHPADPPALOGIN/$PPA $CHANGES"
    	$DPUTCMD
    else
    	echo "Not uploading to launchpad"
    	DPKGCMD="dpkg-buildpackage -uc -us"
    	$DPKGCMD
    fi
done
