#!/usr/bin/perl

#############################################################################
# This script will create an extension build. Usually, this script          #
# shouldn't be run directly, use make_devbuild.pl instead.                  #
#############################################################################

use strict;
use warnings;
use lib qw(. ..);
use Packager;

my $manifest = readFile("chrome.manifest");
unless ($manifest =~ /\bjar:chrome\/(\S+?)\.jar\b/)
{
  die "Could not find JAR file name in chrome.manifest";
}
my $baseName = $1;

my %params = ();

my $xpiFile = shift @ARGV || "$baseName.xpi";
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
$pkg->makeJAR("$baseName.jar", 'content', 'skin', 'locale', '-/tests', '-/mochitest', '-/.incomplete');
chdir('..');

my @files = grep {-e $_} ('components', 'defaults', 'install.js', 'install.rdf', 'chrome.manifest');

$pkg->makeXPI($xpiFile, "chrome/$baseName.jar", @files);
unlink("chrome/$baseName.jar");

sub readFile
{
  my $file = shift;

  open(local *FILE, "<", $file) || die "Could not read file '$file'";
  binmode(FILE);
  local $/;
  my $result = <FILE>;
  close(FILE);

  return $result;
}
