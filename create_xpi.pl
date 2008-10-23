#!/usr/bin/perl

#############################################################################
# This script will create an extension build. Usually, this script          #
# shouldn't be run directly, use make_devbuild.pl instead.                  #
#############################################################################

use strict;
use warnings;
use Packager;

my %params = ();

my $xpiFile = shift @ARGV || "adblockplus.xpi";
if (@ARGV && $ARGV[0] =~ /^\+/)
{
  $params{devbuild} = $ARGV[0];
  shift @ARGV;
}

$params{locales} = \@ARGV if @ARGV;

my $pkg = Packager->new(\%params);
$pkg->readVersion('version');
$pkg->readLocales('chrome/locale') unless exists $params{locales};

chdir('chrome');
$pkg->makeJAR('adblockplus.jar', 'content', 'skin', 'locale', '-/tests', '-/mochitest');
chdir('..');

$pkg->makeXPI($xpiFile, 'chrome/adblockplus.jar', 'components', 'defaults', 'install.js', 'install.rdf', 'chrome.manifest');
unlink('chrome/adblockplus.jar');
