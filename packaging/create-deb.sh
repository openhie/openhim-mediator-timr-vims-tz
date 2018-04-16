#!/bin/bash
#Exit on error
set -e


PPA=release
CPDIRS=("config" "terminologies" )
CPFILES=("README.md" "despatchAdviceBaseMessage.xml" "despatchAdviceLineItem.xml" "gs1RequestMessage.xml" "index.js" "openinfoman.js" "package.json" "rapidpro.js" "send_email.js" "smsAggregator.js" "start.js" "timr.js" "utils.js" "vims.js")

#Don't edit below

HOME=`pwd`
BUILD=$HOME/builds
AWK=/usr/bin/awk
HEAD=/usr/bin/head
GIT=/usr/bin/git
SORT=/usr/bin/sort
DCH=/usr/bin/dch
PR=/usr/bin/pr 
SED=/bin/sed
FMT=/usr/bin/fmt
PR=/usr/bin/pr
XARGS=/usr/bin/xargs
SH=/bin/bash
CURL=/usr/bin/curl
USERNAME=openhim
USERADD=/usr/sbin/useradd
ADDGROUP=/usr/sbin/addgroup
ADDUSER=/usr/sbin/adduser

#get a user who is running this script
WHOAMI=`who am i | awk '{print $1}'`

#create openhim user and group
if ! getent group $USERNAME >/dev/null; then
  echo "group $USERNAME does not exits,add it with command $ADDGROUP --quiet --system $USERNAME"
  exit 1
fi


if id -u $USERNAME >/dev/null 2>&1; then
  echo "user $USERNAME found"
else
  echo "user $USERNAME does not exist. add with command $USERADD  $USERNAME -g $USERNAME -m -s /bin/bash"
  exit 1
fi

cd $HOME/targets
TARGETS=(*)
echo $TARGETS
cd $HOME


LASTVERS=`$GIT tag -l '1.*.*' | $SORT -rV | $HEAD -1`
VERS="${LASTVERS%.*}.$((${LASTVERS##*.}+1))"
echo Current tagged verison is $LASTVERS.  
$GIT status
#echo Should we update changelogs, commit under packacing everything and increment to $VERS? [y/n]
#read INCVERS 
INCVERS='y'


if [[ "$INCVERS" == "y" || "$INCVERS" == "Y" ]];  then
    COMMITMSG="Release Version $VERS"
    WIDTH=68
    URL=$($GIT config --get remote.origin.url | $SED 's/\.git//' | $SED 's/$/\/commmit\//')




    LOGLINES=$($GIT log --oneline $LASTVERS.. | $AWK '{printf " -%s\n --'$URL'%s\n" , $0, $1}')

    FULLCOMMITMSG=$(echo "$COMMITMSG 
$LOGLINES" |  $XARGS -0 | $AWK '{printf "%-'"$WIDTH.$WIDTH"'s\n" , $0}')


    for TARGET in "${TARGETS[@]}"
    do
  cd $HOME/targets/$TARGET
  $DCH -Mv "${VERS}~$TARGET" --distribution "${TARGET}" "${FULLCOMMITMSG}"
    done
    cd $HOME

    $GIT  --no-pager diff
    $GIT add .

    echo "Incrementing version"
    $GIT commit ./ -m "\"${COMMITMSG}\""
    $GIT tag $VERS
elif  [[ "$INCVERS" == "n" || "$INCVERS" == "N" ]];  then
    echo "Not incremementing version"
else
    echo "Don't know what' to do"
    exit 1
fi



if [ -n "$LAUNCHPADPPALOGIN" ]; then
  echo Using $LAUNCHPADPPALOGIN for Launchpad PPA login
  echo "To Change You can do: export LAUNCHPADPPALOGIN=$LAUNCHPADPPALOGIN"
else
  if [ "$1" != "--local" ]; then
      echo -n "Enter your launchpad login for the ppa and press [ENTER]: "
      read LAUNCHPADPPALOGIN
      echo "You can do: export LAUNCHPADPPALOGIN=$LAUNCHPADPPALOGIN to avoid this step in the future"
  else
      LAUNCHPADLOGIN=""
  fi
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

#install node packages
cd /home/$USERNAME
$CURL -o- https://raw.githubusercontent.com/creationix/nvm/v0.32.1/install.sh | $SH > /dev/null
source /home/openhim/.nvm/nvm.sh && nvm install --lts && nvm use --lts
for TARGET in "${TARGETS[@]}"
do
    TARGETDIR=$HOME/targets/$TARGET
    RLS=`$HEAD -1 $TARGETDIR/debian/changelog | $AWK '{print $2}' | $AWK -F~ '{print $1}' | $AWK -F\( '{print $2}'`
    PKG=`$HEAD -1 $TARGETDIR/debian/changelog | $AWK '{print $1}'`
    PKGDIR=${BUILD}/${PKG}-${RLS}~${TARGET}
    SRCDIR=${PKGDIR}/tmp-src
    MEDDIR=$PKGDIR/usr/share/openhim-mediator-timr-vims-tz
    chown -R $WHOAMI:$WHOAMI $MEDDIR
    cd $MEDDIR
    npm install
done


for TARGET in "${TARGETS[@]}"
do
    TARGETDIR=$HOME/targets/$TARGET
    echo "$HEAD -1 $TARGETDIR/debian/changelog | $AWK '{print $2}' | $AWK -F~ '{print $1}' | $AWK -F\( '{print $2}'"
    RLS=`$HEAD -1 $TARGETDIR/debian/changelog | $AWK '{print $2}' | $AWK -F~ '{print $1}' | $AWK -F\( '{print $2}'`
    PKG=`$HEAD -1 $TARGETDIR/debian/changelog | $AWK '{print $1}'`
    PKGDIR=${BUILD}/${PKG}-${RLS}~${TARGET}
    SRCDIR=${PKGDIR}/tmp-src
    CHANGES=${BUILD}/${PKG}_${RLS}~${TARGET}_source.changes
    MEDDIR=$PKGDIR/usr/share/openhim-mediator-timr-vims-tz

    echo  "echo Building Package $PKG  on Release $RLS for Target $TARGET"

    rm -fr $PKGDIR
    mkdir -p $MEDDIR
    mkdir -p $SRCDIR
    #git clone https://github.com/openhie/$PKG.git  $SRCDIR
    git clone $HOME/..  $SRCDIR
    for CPDIR in "${CPDIRS[@]}"
    do
  if [ -d "$SRCDIR/$CPDIR" ]; then
      cp -R $SRCDIR/$CPDIR $MEDDIR
  fi
    done
    for CPFILE in "${CPFILES[@]}"
    do
  if [ -e "$SRCDIR/$CPFILE" ]; then
      cp  $SRCDIR/$CPFILE $MEDDIR
  fi
    done

    cp  -R $TARGETDIR/* $PKGDIR

    cd $PKGDIR  

    if [[ -n "${DEB_SIGN_KEYID}" && -n "{$LAUNCHPADLOGIN}" ]]; then
  DPKGCMD="dpkg-buildpackage -k${DEB_SIGN_KEYID}  -S -sa "
  $DPKGCMD
  DPUTCMD="dput ppa:$LAUNCHPADPPALOGIN/$PPA  $CHANGES"
  $DPUTCMD
    else
  echo "Not uploading to launchpad"
  DPKGCMD="dpkg-buildpackage -uc -us"
  $DPKGCMD

    fi
done


cd $HOME

if [ "$1" != "--local" ]; then
  git push
  git push --tags
fi

