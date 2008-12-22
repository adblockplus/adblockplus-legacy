#!/usr/bin/perl

#############################################################################
# This script will create a special development build meant only for upload #
# to Babelzilla.                                                            #
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
$params{version} = shift @ARGV;
die "Please specify version number on command line" unless $params{version};

my $xpiFile = "$baseName-$params{version}.xpi";

my $pkg = Packager->new(\%params);
$pkg->readLocales('chrome/locale', 1);

chdir('chrome');
$pkg->makeJAR("$baseName.jar", 'content', 'skin', 'locale', '-/tests', '-/mochitest', '-/.incomplete', '-/contents.rdf');
chdir('..');

my @files = grep {-e $_} ('components', 'defaults', 'install.js', 'install.rdf', 'chrome.manifest');

my $targetAppNum = 0;
$pkg->{postprocess_line} = \&postprocessInstallRDF;
$pkg->makeXPI($xpiFile, "chrome/$baseName.jar", @files);
unlink("chrome/$baseName.jar");

sub postprocessInstallRDF
{
  my ($file, $line) = @_;

  return $line unless $file eq "install.rdf";

  if ($line =~ /\btargetApplication\b/)
  {
    $targetAppNum++;
    return "" if $targetAppNum > 6;
  }

  return "" if $targetAppNum > 6 && $targetAppNum % 2 == 1;

  return $line;
}

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
